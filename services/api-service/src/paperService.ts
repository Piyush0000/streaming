import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from './db';
import { logger } from './logger';
import { getTickers } from './tickerSource';
import { TICKER_SYMBOLS } from './marketData';
import {
  computeClose,
  computeOpen,
  equity as calcEquity,
  evaluateTrigger,
  ExitReason,
  liquidationPrice,
  MAX_OPEN_POSITIONS,
  roePct,
  round8,
  Side,
  STARTING_BALANCE,
  unrealizedPnl,
  validateSlTp,
} from './paperMath';

/** Prices older than this are never traded on. */
export const PRICE_MAX_AGE_MS = 60_000;
export const RESET_COOLDOWN_MS = 60 * 60_000;
const ENGINE_INTERVAL_MS = 3000;
const ENGINE_LOCK_KEY = 7_700_101;

export class PaperError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const pricesUnavailable = () =>
  new PaperError(503, 'prices_unavailable', 'Live prices are temporarily unavailable. Try again shortly.');

// ---------- prices ----------

export interface PriceBook {
  at: number;
  prices: Map<string, number>;
}

/** Cached Binance prices no older than PRICE_MAX_AGE_MS, else throws 503. Never invents a price. */
export async function getPriceBook(maxAgeMs = PRICE_MAX_AGE_MS): Promise<PriceBook> {
  let snap;
  try {
    snap = await getTickers();
  } catch {
    throw pricesUnavailable();
  }
  if (Date.now() - snap.at > maxAgeMs) throw pricesUnavailable();
  const prices = new Map<string, number>();
  for (const t of snap.tickers) if (t.price > 0 && Number.isFinite(t.price)) prices.set(t.symbol, t.price);
  if (prices.size === 0) throw pricesUnavailable();
  return { at: snap.at, prices };
}

function priceFor(book: PriceBook, symbol: string): number {
  const p = book.prices.get(symbol);
  if (p === undefined) throw pricesUnavailable();
  return p;
}

// ---------- rows ----------

interface PosRow {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  qty: string;
  leverage: number;
  entry_price: string;
  margin: string;
  sl_price: string | null;
  tp_price: string | null;
  opened_at: Date;
  closed_at: Date | null;
  exit_price: string | null;
  exit_reason: ExitReason | null;
  realized_pnl: string | null;
  fee: string;
  cursor_ts?: string;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));
const money = (n: number) => n.toFixed(8);

interface Pos {
  id: string;
  userId: string;
  symbol: string;
  side: Side;
  qty: number;
  leverage: number;
  entryPrice: number;
  margin: number;
  slPrice: number | null;
  tpPrice: number | null;
  openedAt: Date;
  fee: number;
}

function toPos(r: PosRow): Pos {
  return {
    id: r.id,
    userId: r.user_id,
    symbol: r.symbol,
    side: r.side,
    qty: Number(r.qty),
    leverage: r.leverage,
    entryPrice: Number(r.entry_price),
    margin: Number(r.margin),
    slPrice: num(r.sl_price),
    tpPrice: num(r.tp_price),
    openedAt: r.opened_at,
    fee: Number(r.fee),
  };
}

function openDto(p: Pos, mark: number | null) {
  const uPnl = mark === null ? null : unrealizedPnl(p.side, p.entryPrice, mark, p.qty);
  return {
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    qty: p.qty,
    leverage: p.leverage,
    entryPrice: p.entryPrice,
    notional: round8(p.qty * p.entryPrice),
    margin: p.margin,
    slPrice: p.slPrice,
    tpPrice: p.tpPrice,
    liqPrice: liquidationPrice(p.side, p.entryPrice, p.leverage),
    fee: p.fee,
    openedAt: p.openedAt.toISOString(),
    markPrice: mark,
    uPnl,
    roePct: uPnl === null ? null : roePct(uPnl, p.margin),
  };
}

function closedDto(r: PosRow) {
  const p = toPos(r);
  const realized = Number(r.realized_pnl ?? 0);
  return {
    id: p.id,
    symbol: p.symbol,
    side: p.side,
    qty: p.qty,
    leverage: p.leverage,
    entryPrice: p.entryPrice,
    margin: p.margin,
    exitPrice: num(r.exit_price),
    exitReason: r.exit_reason,
    realizedPnl: realized,
    roePct: roePct(realized, p.margin),
    fee: p.fee,
    openedAt: p.openedAt.toISOString(),
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
  };
}

// ---------- core transactional pieces ----------

async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Creates the account on first use; then locks it (serialises all of a user's trading actions). */
async function lockAccount(c: PoolClient, userId: string) {
  await c.query('INSERT INTO paper_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const { rows } = await c.query<{ balance: string; reset_count: number; last_reset_at: Date | null; created_at: Date }>(
    'SELECT balance, reset_count, last_reset_at, created_at FROM paper_accounts WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  return rows[0];
}

/**
 * Idempotently closes one position and credits the account. Returns the closed row, or
 * null if it was already closed by someone else (UPDATE ... WHERE closed_at IS NULL).
 * Caller must hold the account lock and be inside a transaction.
 */
async function closeOne(c: PoolClient, row: PosRow, price: number, reason: ExitReason): Promise<PosRow | null> {
  const p = toPos(row);
  const calc = computeClose({ ...p, openFee: p.fee }, price);
  const upd = await c.query<PosRow>(
    `UPDATE paper_positions
        SET closed_at = now(), exit_price = $2, exit_reason = $3, realized_pnl = $4, fee = $5
      WHERE id = $1 AND closed_at IS NULL
      RETURNING *`,
    [p.id, money(price), reason, money(calc.realizedPnl), money(calc.totalFee)]
  );
  if (!upd.rows[0]) return null;
  await c.query('UPDATE paper_accounts SET balance = balance + $2::numeric WHERE user_id = $1', [p.userId, money(calc.credit)]);
  return upd.rows[0];
}

export interface Triggered {
  id: string;
  symbol: string;
  side: Side;
  reason: ExitReason;
  exitPrice: number;
  realizedPnl: number;
}

/** Closes every position of `userId` whose SL/TP/liquidation fired at the given prices. */
export async function evaluateUser(userId: string, book: PriceBook): Promise<Triggered[]> {
  const { rows } = await pool.query<PosRow>('SELECT * FROM paper_positions WHERE user_id = $1 AND closed_at IS NULL', [userId]);
  const fires = rows.some((r) => {
    const price = book.prices.get(r.symbol);
    return price !== undefined && evaluateTrigger(toPos(r), price) !== null;
  });
  if (!fires) return [];
  return withTx(async (c) => {
    await lockAccount(c, userId);
    // Re-read under the lock: the user may have edited SL/TP or closed it meanwhile.
    const fresh = await c.query<PosRow>(
      'SELECT * FROM paper_positions WHERE user_id = $1 AND closed_at IS NULL FOR UPDATE',
      [userId]
    );
    const out: Triggered[] = [];
    for (const r of fresh.rows) {
      const price = book.prices.get(r.symbol);
      if (price === undefined) continue;
      const hit = evaluateTrigger(toPos(r), price);
      if (!hit) continue;
      const closed = await closeOne(c, r, hit.exitPrice, hit.reason);
      if (closed) {
        out.push({
          id: closed.id,
          symbol: closed.symbol,
          side: closed.side,
          reason: hit.reason,
          exitPrice: hit.exitPrice,
          realizedPnl: Number(closed.realized_pnl),
        });
        logger.info({ userId, positionId: closed.id, reason: hit.reason, price: hit.exitPrice }, 'paper: position closed by engine');
      }
    }
    return out;
  });
}

// ---------- public operations ----------

export async function getAccountView(userId: string) {
  let book: PriceBook | null = null;
  let closedNow: Triggered[] = [];
  try {
    book = await getPriceBook();
    closedNow = await evaluateUser(userId, book);
  } catch (err) {
    if (!(err instanceof PaperError)) logger.error({ err, userId }, 'paper: evaluate on account read failed');
  }
  await pool.query('INSERT INTO paper_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const [acc, pos] = await Promise.all([
    pool.query<{ balance: string; reset_count: number; last_reset_at: Date | null }>(
      'SELECT balance, reset_count, last_reset_at FROM paper_accounts WHERE user_id = $1',
      [userId]
    ),
    pool.query<PosRow>('SELECT * FROM paper_positions WHERE user_id = $1 AND closed_at IS NULL ORDER BY opened_at, id', [userId]),
  ]);
  const balance = Number(acc.rows[0].balance);
  const positions = pos.rows.map((r) => {
    const p = toPos(r);
    return openDto(p, book ? (book.prices.get(p.symbol) ?? null) : null);
  });
  const complete = positions.every((p) => p.uPnl !== null);
  const uPnl = complete ? round8(positions.reduce((s, p) => s + (p.uPnl ?? 0), 0)) : null;
  const eq = complete ? calcEquity(balance, positions.map((p) => ({ margin: p.margin, uPnl: p.uPnl ?? 0 }))) : null;
  const lastReset = acc.rows[0].last_reset_at;
  const resetAvailableAt = lastReset ? new Date(lastReset.getTime() + RESET_COOLDOWN_MS) : null;
  return {
    paper: true,
    startingBalance: STARTING_BALANCE,
    balance,
    equity: eq,
    unrealizedPnl: uPnl,
    usedMargin: round8(positions.reduce((s, p) => s + p.margin, 0)),
    resetCount: acc.rows[0].reset_count,
    resetAvailableAt: resetAvailableAt && resetAvailableAt.getTime() > Date.now() ? resetAvailableAt.toISOString() : null,
    positions,
    closedByEngine: closedNow,
    pricesOk: book !== null,
    pricesAt: book ? new Date(book.at).toISOString() : null,
    prices: book ? Object.fromEntries(book.prices) : {},
    limits: {
      symbols: [...TICKER_SYMBOLS],
      maxPositions: MAX_OPEN_POSITIONS,
      minNotionalUsd: 10,
      maxLeverage: 50,
      takerFeeRate: 0.0004,
    },
  };
}

export interface OrderInput {
  symbol: string;
  side: Side;
  notionalUsd?: number;
  qty?: number;
  leverage: number;
  slPrice?: number;
  tpPrice?: number;
}

export async function placeOrder(userId: string, input: OrderInput) {
  const book = await getPriceBook();
  const price = priceFor(book, input.symbol);
  const calc = computeOpen({
    side: input.side,
    price,
    leverage: input.leverage,
    notionalUsd: input.notionalUsd,
    qty: input.qty,
  });
  if (!calc.ok) throw new PaperError(400, 'invalid_order', calc.error);
  const slTpErr = validateSlTp(input.side, price, input.slPrice, input.tpPrice);
  if (slTpErr) throw new PaperError(400, 'invalid_sl_tp', slTpErr, { entryPrice: price });

  return withTx(async (c) => {
    const acc = await lockAccount(c, userId);
    const open = await c.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM paper_positions WHERE user_id = $1 AND closed_at IS NULL',
      [userId]
    );
    if (open.rows[0].n >= MAX_OPEN_POSITIONS) {
      throw new PaperError(409, 'too_many_positions', `You can hold at most ${MAX_OPEN_POSITIONS} open positions.`);
    }
    const balance = Number(acc.balance);
    if (calc.requiredBalance > balance) {
      throw new PaperError(
        409,
        'insufficient_balance',
        `Not enough available balance: need $${calc.requiredBalance.toFixed(2)} (margin + fee), have $${balance.toFixed(2)}.`
      );
    }
    const id = crypto.randomUUID();
    const ins = await c.query<PosRow>(
      `INSERT INTO paper_positions (id, user_id, symbol, side, qty, leverage, entry_price, margin, sl_price, tp_price, fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        id,
        userId,
        input.symbol,
        input.side,
        money(calc.qty),
        input.leverage,
        money(price),
        money(calc.margin),
        input.slPrice === undefined ? null : money(input.slPrice),
        input.tpPrice === undefined ? null : money(input.tpPrice),
        money(calc.openFee),
      ]
    );
    await c.query('UPDATE paper_accounts SET balance = balance - $2::numeric WHERE user_id = $1', [
      userId,
      money(calc.requiredBalance),
    ]);
    logger.info({ userId, positionId: id, symbol: input.symbol, side: input.side, price }, 'paper: position opened');
    return openDto(toPos(ins.rows[0]), price);
  });
}

export async function updateSlTp(
  userId: string,
  positionId: string,
  patch: { slPrice?: number | null; tpPrice?: number | null }
) {
  const book = await getPriceBook();
  return withTx(async (c) => {
    await lockAccount(c, userId);
    const cur = await c.query<PosRow>(
      'SELECT * FROM paper_positions WHERE id = $1 AND user_id = $2 AND closed_at IS NULL FOR UPDATE',
      [positionId, userId]
    );
    if (!cur.rows[0]) throw new PaperError(404, 'position_not_found', 'That position is not open (it may have just closed).');
    const p = toPos(cur.rows[0]);
    const sl = patch.slPrice === undefined ? p.slPrice : patch.slPrice;
    const tp = patch.tpPrice === undefined ? p.tpPrice : patch.tpPrice;
    const mark = priceFor(book, p.symbol);
    // Only validate the values being changed, against the current price (so a stop can trail into profit,
    // but can never be set where it would trigger instantly).
    const err = validateSlTp(
      p.side,
      mark,
      patch.slPrice === undefined ? undefined : patch.slPrice,
      patch.tpPrice === undefined ? undefined : patch.tpPrice
    );
    if (err) throw new PaperError(400, 'invalid_sl_tp', err, { markPrice: mark });
    const upd = await c.query<PosRow>(
      'UPDATE paper_positions SET sl_price = $2, tp_price = $3 WHERE id = $1 AND closed_at IS NULL RETURNING *',
      [positionId, sl === null ? null : money(sl), tp === null ? null : money(tp)]
    );
    return openDto(toPos(upd.rows[0]), mark);
  });
}

export async function closePosition(userId: string, positionId: string) {
  const book = await getPriceBook();
  return withTx(async (c) => {
    await lockAccount(c, userId);
    const cur = await c.query<PosRow>(
      'SELECT * FROM paper_positions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [positionId, userId]
    );
    const row = cur.rows[0];
    if (!row) throw new PaperError(404, 'position_not_found', 'Position not found.');
    if (row.closed_at) throw new PaperError(409, 'already_closed', 'That position is already closed.', { position: closedDto(row) });
    const price = priceFor(book, row.symbol);
    const closed = await closeOne(c, row, price, 'MANUAL');
    if (!closed) throw new PaperError(409, 'already_closed', 'That position is already closed.');
    return closedDto(closed);
  });
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const i = raw.lastIndexOf('|');
    if (i < 1) return null;
    const ts = raw.slice(0, i);
    const id = raw.slice(i + 1);
    if (!UUID_RE.test(id) || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export async function getHistory(userId: string, cursor: string | undefined, limit: number) {
  let cur: { ts: string; id: string } | null = null;
  if (cursor) {
    cur = decodeCursor(cursor);
    if (!cur) throw new PaperError(400, 'invalid_input', 'cursor: invalid cursor');
  }
  const params: unknown[] = [userId, limit + 1];
  let cursorSql = '';
  if (cur) {
    params.push(cur.ts, cur.id);
    cursorSql = 'AND (closed_at, id) < ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await pool.query<PosRow>(
    `SELECT *, to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
       FROM paper_positions
      WHERE user_id = $1 AND closed_at IS NOT NULL ${cursorSql}
      ORDER BY closed_at DESC, id DESC
      LIMIT $2`,
    params
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    trades: page.map(closedDto),
    nextCursor: rows.length > limit && last?.cursor_ts ? encodeCursor(last.cursor_ts, last.id) : null,
  };
}

/**
 * Resets the balance to the starting balance (max once per hour).
 * Open positions are NOT silently discarded: without `closeOpen` the request is rejected (409);
 * with `closeOpen` they are first closed at market (reason MANUAL, fees applied, history kept).
 */
export async function resetAccount(userId: string, closeOpen: boolean) {
  const needsBook = await pool.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM paper_positions WHERE user_id = $1 AND closed_at IS NULL',
    [userId]
  );
  const hasOpen = needsBook.rows[0].n > 0;
  if (hasOpen && !closeOpen) {
    throw new PaperError(409, 'open_positions', 'Close your open positions first, or reset with “close all”.');
  }
  const book = hasOpen ? await getPriceBook() : null;
  return withTx(async (c) => {
    const acc = await lockAccount(c, userId);
    if (acc.last_reset_at) {
      const wait = acc.last_reset_at.getTime() + RESET_COOLDOWN_MS - Date.now();
      if (wait > 0) {
        throw new PaperError(429, 'reset_cooldown', `You can reset once per hour. Try again in ${Math.ceil(wait / 60000)} min.`, {
          retryAfterMs: wait,
        });
      }
    }
    const open = await c.query<PosRow>(
      'SELECT * FROM paper_positions WHERE user_id = $1 AND closed_at IS NULL FOR UPDATE',
      [userId]
    );
    if (open.rows.length > 0) {
      if (!closeOpen) throw new PaperError(409, 'open_positions', 'Close your open positions first, or reset with “close all”.');
      if (!book) throw pricesUnavailable();
      for (const r of open.rows) await closeOne(c, r, priceFor(book, r.symbol), 'MANUAL');
    }
    await c.query(
      `UPDATE paper_accounts
          SET balance = $2::numeric, reset_count = reset_count + 1, last_reset_at = now()
        WHERE user_id = $1`,
      [userId, money(STARTING_BALANCE)]
    );
    logger.info({ userId, closedPositions: open.rows.length }, 'paper: account reset');
    return { balance: STARTING_BALANCE, closedPositions: open.rows.length };
  });
}

// ---------- leaderboard ----------

interface BoardRow {
  user_id: string;
  name: string | null;
  pnl: string;
  trades: number;
}
let boardCache: { at: number; rows: BoardRow[] } | null = null;
const BOARD_TTL_MS = 15_000;

export async function getLeaderboard(viewerId: string) {
  if (!boardCache || Date.now() - boardCache.at > BOARD_TTL_MS) {
    const { rows } = await pool.query<BoardRow>(
      `SELECT p.user_id,
              COALESCE(NULLIF(btrim(up.display_name), ''), u.username) AS name,
              SUM(p.realized_pnl) AS pnl,
              COUNT(*)::int AS trades
         FROM paper_positions p
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN user_profiles up ON up.user_id = p.user_id
        WHERE p.closed_at >= now() - interval '7 days'
        GROUP BY p.user_id, u.username, up.display_name
        ORDER BY SUM(p.realized_pnl) DESC, COUNT(*) DESC
        LIMIT 20`
    );
    boardCache = { at: Date.now(), rows };
  }
  return {
    windowDays: 7,
    basis: `Realized PnL as % of the $${STARTING_BALANCE.toLocaleString('en-US')} starting balance`,
    entries: boardCache.rows.map((r, i) => ({
      rank: i + 1,
      name: r.name && r.name.trim() ? r.name : 'Trader',
      pnl: Number(r.pnl),
      pnlPct: round8((Number(r.pnl) / STARTING_BALANCE) * 100),
      trades: r.trades,
      me: r.user_id === viewerId,
    })),
  };
}

// ---------- background engine ----------

let sweeping = false;
let lastPriceErrLogAt = 0;

export async function sweepOnce(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  let lockClient: PoolClient | null = null;
  let locked = false;
  try {
    const users = await pool.query<{ user_id: string }>('SELECT DISTINCT user_id FROM paper_positions WHERE closed_at IS NULL');
    if (users.rows.length === 0) return; // nothing open: do not even touch the price cache
    lockClient = await pool.connect();
    const got = await lockClient.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [ENGINE_LOCK_KEY]);
    locked = got.rows[0]?.ok === true;
    if (!locked) return; // another instance is sweeping
    let book: PriceBook;
    try {
      book = await getPriceBook();
    } catch (err) {
      if (Date.now() - lastPriceErrLogAt > 30_000) {
        lastPriceErrLogAt = Date.now();
        logger.error({ err }, 'PAPER ENGINE: no fresh prices, SL/TP/liquidation NOT being evaluated');
      }
      return;
    }
    for (const u of users.rows) {
      try {
        await evaluateUser(u.user_id, book);
      } catch (err) {
        logger.error({ err, userId: u.user_id }, 'PAPER ENGINE: evaluating user failed');
      }
    }
  } catch (err) {
    logger.error({ err }, 'PAPER ENGINE: sweep failed');
  } finally {
    if (lockClient) {
      try {
        if (locked) await lockClient.query('SELECT pg_advisory_unlock($1)', [ENGINE_LOCK_KEY]);
        lockClient.release();
      } catch (err) {
        logger.error({ err }, 'PAPER ENGINE: failed to release advisory lock; discarding connection');
        lockClient.release(err instanceof Error ? err : new Error('unlock failed'));
      }
    }
    sweeping = false;
  }
}

export function startPaperEngine(): void {
  const timer = setInterval(() => {
    sweepOnce().catch((err) => logger.error({ err }, 'PAPER ENGINE: unexpected sweep error'));
  }, ENGINE_INTERVAL_MS);
  timer.unref();
  logger.info('paper engine started');
}
