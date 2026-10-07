import { Router, Request, Response } from 'express';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { mapSignals } from '../marketData';
import { fetchJson, getTickers } from '../tickerSource';
import { computeMovers, getAllSymbols, getOverview, querySymbols, SymbolSort } from '../marketAll';

export const marketRouter = Router();

const SIGNALS_TTL_MS = 60_000;
const SIGNALS_FETCH_TIMEOUT_MS = 4000;
const SIGNALS_MAX_STALE_MS = 60 * 60_000;
const PER_MINUTE_LIMIT = 60;

const DEFAULT_SIGNALS_URL = 'https://api.lr21.org/api/signals/recent';

function signalsUrl(): string {
  const v = (process.env.LR21_SIGNALS_URL ?? '').trim();
  return v || DEFAULT_SIGNALS_URL;
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

// ---- tickers ---- (cache + upstream fetch live in ../tickerSource, shared with /paper)
marketRouter.get('/tickers', async (req: Request, res: Response) => {
  if (!(await allowed(req, res))) return;
  try {
    const t = await getTickers();
    return res.json({ updatedAt: new Date(t.at).toISOString(), stale: t.stale, tickers: t.tickers });
  } catch {
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

// ---- all USDT symbols (one cached Binance all-symbols call, 5s) ----
const SORTS = new Set(['volume', 'gainers', 'losers', 'name']);

marketRouter.get('/symbols', async (req: Request, res: Response) => {
  if (!(await allowed(req, res))) return;
  const sort = typeof req.query.sort === 'string' && req.query.sort ? req.query.sort : 'volume';
  if (!SORTS.has(sort)) return res.status(400).json({ error: 'invalid_sort' });
  let limit = 100;
  if (typeof req.query.limit === 'string' && req.query.limit) {
    const n = Number(req.query.limit);
    if (!Number.isInteger(n) || n < 1 || n > 200) return res.status(400).json({ error: 'invalid_limit' });
    limit = n;
  }
  try {
    const snap = await getAllSymbols();
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const r = querySymbols(snap.rows, { sort: sort as SymbolSort, q, limit });
    return res.json({ updatedAt: new Date(snap.at).toISOString(), stale: snap.stale, count: r.count, symbols: r.symbols });
  } catch {
    return res.status(503).json({ error: 'market_unavailable' });
  }
});

marketRouter.get('/movers', async (req: Request, res: Response) => {
  if (!(await allowed(req, res))) return;
  try {
    const snap = await getAllSymbols();
    return res.json({ updatedAt: new Date(snap.at).toISOString(), stale: snap.stale, ...computeMovers(snap.rows) });
  } catch {
    return res.status(503).json({ error: 'market_unavailable' });
  }
});

marketRouter.get('/overview', async (req: Request, res: Response) => {
  if (!(await allowed(req, res))) return;
  try {
    return res.json(await getOverview());
  } catch {
    return res.status(503).json({ error: 'market_unavailable' });
  }
});
