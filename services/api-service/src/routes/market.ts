import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { mapSignals, parseBinanceTickers, TICKER_SYMBOLS, Ticker } from '../marketData';

export const marketRouter = Router();

const TICKER_TTL_MS = 10_000;
const TICKER_FETCH_TIMEOUT_MS = 3000;
const TICKER_MAX_STALE_MS = 5 * 60_000;
const SIGNALS_TTL_MS = 60_000;
const SIGNALS_FETCH_TIMEOUT_MS = 4000;
const SIGNALS_MAX_STALE_MS = 60 * 60_000;
const PER_MINUTE_LIMIT = 60;

const BINANCE_HOSTS = ['https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const DEFAULT_SIGNALS_URL = 'https://api.lr21.org/api/signals/recent';

function signalsUrl(): string {
  const v = (process.env.LR21_SIGNALS_URL ?? '').trim();
  return v || DEFAULT_SIGNALS_URL;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
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

/** Per-IP limiter; fails open (loudly) via hitRateLimit if Redis is down. */
async function allowed(req: Request, res: Response): Promise<boolean> {
  // The gateway overwrites X-Real-IP with the real client address.
  const hdr = req.headers['x-real-ip'];
  const ip = (typeof hdr === 'string' && hdr) || req.ip || 'unknown';
  const rl = await hitRateLimit(`rl:market:${ip}`, PER_MINUTE_LIMIT, 60);
  if (rl.allowed) return true;
  const sec = Math.ceil(rl.retryAfterMs / 1000);
  res.setHeader('Retry-After', String(sec));
  res.status(429).json({ error: 'rate_limited', message: `Too many requests. Try again in ${sec}s.`, retryAfterMs: rl.retryAfterMs });
  return false;
}

// ---- tickers ----
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

marketRouter.get('/tickers', async (req: Request, res: Response) => {
  if (!(await allowed(req, res))) return;
  if (tickerCache && Date.now() - tickerCache.at < TICKER_TTL_MS) {
    return res.json({ updatedAt: new Date(tickerCache.at).toISOString(), stale: false, tickers: tickerCache.tickers });
  }
  try {
    tickerInflight ??= loadTickers().finally(() => {
      tickerInflight = null;
    });
    const tickers = await tickerInflight;
    tickerCache = { at: Date.now(), tickers };
    return res.json({ updatedAt: new Date(tickerCache.at).toISOString(), stale: false, tickers });
  } catch (err) {
    logger.error({ err }, 'market: all binance hosts failed');
    if (tickerCache && Date.now() - tickerCache.at <= TICKER_MAX_STALE_MS) {
      return res.json({ updatedAt: new Date(tickerCache.at).toISOString(), stale: true, tickers: tickerCache.tickers });
    }
    return res.status(503).json({ error: 'market_unavailable' });
  }
});

// ---- signals ----
let signalsCache: { at: number; raw: unknown } | null = null;
let signalsInflight: Promise<unknown> | null = null;

marketRouter.get('/signals', async (req: Request, res: Response) => {
  if (!(await allowed(req, res))) return;
  const respond = (raw: unknown, at: number, upstreamStale: boolean) =>
    res.json({ fetchedAt: new Date(at).toISOString(), upstreamStale, signals: mapSignals(raw, Date.now()) });
  if (signalsCache && Date.now() - signalsCache.at < SIGNALS_TTL_MS) return respond(signalsCache.raw, signalsCache.at, false);
  try {
    signalsInflight ??= fetchJson(signalsUrl(), SIGNALS_FETCH_TIMEOUT_MS).finally(() => {
      signalsInflight = null;
    });
    const raw = await signalsInflight;
    signalsCache = { at: Date.now(), raw };
    return respond(raw, signalsCache.at, false);
  } catch (err) {
    logger.error({ err }, 'market: signals upstream failed');
    if (signalsCache && Date.now() - signalsCache.at <= SIGNALS_MAX_STALE_MS) {
      return respond(signalsCache.raw, signalsCache.at, true);
    }
    return res.status(503).json({ error: 'signals_unavailable' });
  }
});
