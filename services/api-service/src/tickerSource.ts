import { logger } from './logger';
import { parseBinanceTickers, TICKER_SYMBOLS, Ticker } from './marketData';

/**
 * Single cached source of Binance 24hr tickers, shared by /market and /paper.
 * One upstream request per TICKER_TTL_MS at most (in-flight requests are
 * de-duplicated); callers never hit Binance directly.
 */
const TICKER_TTL_MS = 10_000;
const TICKER_FETCH_TIMEOUT_MS = 3000;
const TICKER_MAX_STALE_MS = 5 * 60_000;
const BINANCE_HOSTS = ['https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];

export async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`upstream ${new URL(url).host} responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let tickerCache: { at: number; tickers: Ticker[] } | null = null;
let tickerInflight: Promise<Ticker[]> | null = null;

async function loadTickers(): Promise<Ticker[]> {
  const query = encodeURIComponent(JSON.stringify(TICKER_SYMBOLS));
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      const raw = await fetchJson(`${host}/api/v3/ticker/24hr?symbols=${query}`, TICKER_FETCH_TIMEOUT_MS);
      const tickers = parseBinanceTickers(raw);
      if (tickers.length === 0) throw new Error('no valid tickers in upstream response');
      return tickers;
    } catch (err) {
      lastErr = err;
      logger.warn({ err, host }, 'market: binance fetch failed');
    }
  }
  throw lastErr;
}

export interface TickerSnapshot {
  /** Epoch ms when the data was fetched from Binance. */
  at: number;
  tickers: Ticker[];
  /** true when served from an expired cache because the refresh failed. */
  stale: boolean;
}

/** Fresh-or-cached tickers; falls back to a cache up to 5 min old (stale=true); throws when nothing usable. */
export async function getTickers(): Promise<TickerSnapshot> {
  if (tickerCache && Date.now() - tickerCache.at < TICKER_TTL_MS) {
    return { at: tickerCache.at, tickers: tickerCache.tickers, stale: false };
  }
  try {
    tickerInflight ??= loadTickers().finally(() => {
      tickerInflight = null;
    });
    const tickers = await tickerInflight;
    tickerCache = { at: Date.now(), tickers };
    return { at: tickerCache.at, tickers, stale: false };
  } catch (err) {
    logger.error({ err }, 'market: all binance hosts failed');
    if (tickerCache && Date.now() - tickerCache.at <= TICKER_MAX_STALE_MS) {
      return { at: tickerCache.at, tickers: tickerCache.tickers, stale: true };
    }
    throw err;
  }
}
