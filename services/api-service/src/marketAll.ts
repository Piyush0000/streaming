import { logger } from './logger';
import { BINANCE_HOSTS, fetchJson } from './tickerSource';
import { FearGreed, GlobalStats, SymbolRow, parseAllUsdtTickers, parseFearGreed, parseGlobal } from './marketAllParse';

export * from './marketAllParse';

// ---------- all-symbols cache (one upstream call per 5s) ----------
const SYMBOLS_TTL_MS = 5000;
const SYMBOLS_TIMEOUT_MS = 6000;
const SYMBOLS_MAX_STALE_MS = 5 * 60_000;

let symCache: { at: number; rows: SymbolRow[] } | null = null;
let symInflight: Promise<SymbolRow[]> | null = null;

async function loadAllSymbols(): Promise<SymbolRow[]> {
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const rows = parseAllUsdtTickers(await fetchJson(`${host}/api/v3/ticker/24hr`, SYMBOLS_TIMEOUT_MS));
      if (rows.length === 0) throw new Error('no valid USDT rows in upstream response');
      return rows;
    } catch (err) {
      lastErr = err;
      logger.warn({ err, host }, 'market: binance all-symbols fetch failed');
    }
  }
  throw lastErr;
}

export interface SymbolsSnapshot { at: number; rows: SymbolRow[]; stale: boolean }

/** Fresh-or-cached; stale (<=5 min) on upstream failure; throws when nothing usable. */
export async function getAllSymbols(): Promise<SymbolsSnapshot> {
  if (symCache && Date.now() - symCache.at < SYMBOLS_TTL_MS) return { ...symCache, stale: false };
  try {
    symInflight ??= loadAllSymbols().finally(() => {
      symInflight = null;
    });
    const rows = await symInflight;
    symCache = { at: Date.now(), rows };
    return { ...symCache, stale: false };
  } catch (err) {
    logger.error({ err }, 'market: all binance hosts failed (all-symbols)');
    if (symCache && Date.now() - symCache.at <= SYMBOLS_MAX_STALE_MS) return { ...symCache, stale: true };
    throw err;
  }
}

// ---------- overview parts: independent caches, null on failure ----------
interface Part<T> { at: number; value: T }

function makePart<T>(url: string, parse: (raw: unknown) => T | null, ttlMs: number, maxStaleMs: number, timeoutMs: number, name: string) {
  let cache: Part<T> | null = null;
  let inflight: Promise<void> | null = null;
  let lastFailAt = 0;
  const FAIL_COOLDOWN_MS = 60_000; // also covers CoinGecko 429s
  return async (): Promise<Part<T> | null> => {
    const now = Date.now();
    const fresh = cache && now - cache.at < ttlMs;
    if (!fresh && now - lastFailAt >= FAIL_COOLDOWN_MS) {
      inflight ??= (async () => {
        try {
          const v = parse(await fetchJson(url, timeoutMs));
          if (v === null) throw new Error('unparseable upstream response');
          cache = { at: Date.now(), value: v };
        } catch (err) {
          lastFailAt = Date.now();
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, `market: ${name} fetch failed`);
        }
      })().finally(() => {
        inflight = null;
      });
      await inflight;
    } else if (inflight) {
      await inflight;
    }
    return cache && Date.now() - cache.at <= maxStaleMs ? cache : null;
  };
}

const getFearGreedPart = makePart<FearGreed>('https://api.alternative.me/fng/?limit=1', parseFearGreed, 10 * 60_000, 6 * 3600_000, 4000, 'fear&greed');
const getGlobalPart = makePart<GlobalStats>('https://api.coingecko.com/api/v3/global', parseGlobal, 5 * 60_000, 3600_000, 4000, 'coingecko global');

export async function getOverview() {
  const [fg, gl] = await Promise.all([getFearGreedPart(), getGlobalPart()]);
  const at = Math.max(fg?.at ?? 0, gl?.at ?? 0) || Date.now();
  return {
    updatedAt: new Date(at).toISOString(),
    fearGreed: fg?.value ?? null,
    global: gl?.value ?? null,
  };
}
