import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { sendInvalidInput, uuidSchema } from '../validation';
import { TICKER_SYMBOLS } from '../marketData';
import { MAX_LEVERAGE, MAX_NOTIONAL_USD } from '../paperMath';
import {
  closePosition,
  getAccountView,
  getHistory,
  getLeaderboard,
  PaperError,
  placeOrder,
  resetAccount,
  updateSlTp,
} from '../paperService';

// Paper trading: virtual funds, REAL Binance prices (from the shared cached ticker source).
// No real orders are ever placed. Mounted at /paper; the gateway maps /api/paper/ -> /paper/.
export const paperRouter = Router();

paperRouter.use(requireAuth);

function limit(kind: 'read' | 'write', max: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rl = await hitRateLimit(`rl:paper:${kind}:${req.user!.sub}`, max, 60);
      if (rl.allowed) return next();
      const sec = Math.ceil(rl.retryAfterMs / 1000);
      res.setHeader('Retry-After', String(sec));
      return res
        .status(429)
        .json({ error: 'rate_limited', message: `Too many requests. Try again in ${sec}s.`, retryAfterMs: rl.retryAfterMs });
    } catch (err) {
      next(err);
    }
  };
}
const readLimit = limit('read', 120);
const writeLimit = limit('write', 30);

function handle(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PaperError) {
        if (err.status >= 500) logger.warn({ code: err.code }, `paper: ${what} rejected`);
        if (err.extra.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(Number(err.extra.retryAfterMs) / 1000)));
        return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
      }
      logger.error({ err, userId: req.user?.sub }, `paper: ${what} failed`);
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  };
}

const price = z.number({ invalid_type_error: 'must be a number' }).finite().positive('must be positive').max(1e9);

const orderSchema = z
  .object({
    symbol: z.enum(TICKER_SYMBOLS, { errorMap: () => ({ message: `symbol must be one of ${TICKER_SYMBOLS.join(', ')}` }) }),
    side: z.enum(['LONG', 'SHORT'], { errorMap: () => ({ message: 'side must be LONG or SHORT' }) }),
    notionalUsd: z.number().finite().positive().max(MAX_NOTIONAL_USD).optional(),
    qty: z.number().finite().positive().max(1e9).optional(),
    leverage: z.number().int('leverage must be an integer').min(1).max(MAX_LEVERAGE),
    slPrice: price.optional(),
    tpPrice: price.optional(),
  })
  .strict()
  .refine((v) => (v.notionalUsd === undefined) !== (v.qty === undefined), {
    message: 'provide exactly one of notionalUsd or qty',
    path: ['notionalUsd'],
  });

const patchSchema = z
  .object({ slPrice: price.nullable().optional(), tpPrice: price.nullable().optional() })
  .strict()
  .refine((v) => v.slPrice !== undefined || v.tpPrice !== undefined, { message: 'provide slPrice and/or tpPrice (null clears)' });

const historySchema = z.object({
  cursor: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(300).optional()),
  limit: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z.number().int().min(1).max(50).default(20)
  ),
});

const resetSchema = z.object({ closeOpen: z.boolean().optional() }).strict();

function parseId(req: Request, res: Response): string | undefined {
  const p = uuidSchema.safeParse(req.params.id);
  if (!p.success) {
    res.status(400).json({ error: 'invalid_input', message: `id: ${p.error.issues[0].message}` });
    return undefined;
  }
  return p.data;
}

// GET /paper/account -> balance, equity, open positions with live uPnL/ROE, live prices.
// Also evaluates this user's SL/TP/liquidation first so results are never stale.
paperRouter.get('/account', readLimit, handle('account', async (req, res) => {
  res.json(await getAccountView(req.user!.sub));
}));

// POST /paper/orders -> 201 { position }  (market order at the current cached Binance price)
paperRouter.post('/orders', writeLimit, handle('order', async (req, res) => {
  const parsed = orderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const position = await placeOrder(req.user!.sub, parsed.data);
  res.status(201).json({ position });
}));

// PATCH /paper/positions/:id { slPrice?, tpPrice? } (null clears) -> { position }
paperRouter.patch('/positions/:id', writeLimit, handle('update sl/tp', async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  res.json({ position: await updateSlTp(req.user!.sub, id, parsed.data) });
}));

// POST /paper/positions/:id/close -> { trade }
paperRouter.post('/positions/:id/close', writeLimit, handle('close', async (req, res) => {
  const id = parseId(req, res);
  if (!id) return;
  res.json({ trade: await closePosition(req.user!.sub, id) });
}));

// GET /paper/history?cursor=&limit= -> { trades, nextCursor }
paperRouter.get('/history', readLimit, handle('history', async (req, res) => {
  const parsed = historySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  res.json(await getHistory(req.user!.sub, parsed.data.cursor, parsed.data.limit));
}));

// POST /paper/reset { closeOpen? } -> { balance, closedPositions }. Max once per hour.
paperRouter.post('/reset', writeLimit, handle('reset', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  res.json(await resetAccount(req.user!.sub, parsed.data.closeOpen === true));
}));

// GET /paper/leaderboard -> top 20 by realized PnL % over the last 7 days (display names only)
paperRouter.get('/leaderboard', readLimit, handle('leaderboard', async (req, res) => {
  res.json(await getLeaderboard(req.user!.sub));
}));
