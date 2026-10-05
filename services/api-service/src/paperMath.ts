/**
 * Pure paper-trading math (no I/O). All money values are rounded to 8 decimal
 * places (`round8`) at every step so results are deterministic and match the
 * NUMERIC(24,8) columns they are stored in.
 *
 * Model (Binance USDT-M perpetual style, isolated margin):
 *  - open fee  = notional * 0.04%, charged at open (deducted from free balance together with margin)
 *  - close fee = exitNotional * 0.04%, deducted from the amount returned at close
 *  - uPnL (gross) = (mark - entry) * qty for LONG, (entry - mark) * qty for SHORT
 *  - ROE% = uPnL / margin * 100 (fees excluded, same as Binance's display)
 *  - liquidation when loss >= margin - maintenance, maintenance = 0.5% of entry notional
 *  - triggers fill at the CURRENT price (not the level): a gap through a level is filled at the
 *    observed price, never at a better price than the market offered.
 *  - the amount returned to the account at close is clamped at >= 0 (isolated margin: you cannot
 *    lose more than the margin).
 */

export type Side = 'LONG' | 'SHORT';
export type ExitReason = 'MANUAL' | 'SL' | 'TP' | 'LIQUIDATED';

export const TAKER_FEE_RATE = 0.0004;
export const MAINTENANCE_RATE = 0.005;
export const MAX_LEVERAGE = 50;
export const MIN_NOTIONAL_USD = 10;
export const MAX_NOTIONAL_USD = 10_000_000;
export const MAX_OPEN_POSITIONS = 5;
export const STARTING_BALANCE = 10_000;

export function round8(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  const r = Math.round((n + Math.sign(n) * Number.EPSILON * Math.abs(n)) * 1e8) / 1e8;
  return r === 0 ? 0 : r; // normalise -0
}

export function fee(notional: number): number {
  return round8(notional * TAKER_FEE_RATE);
}

export function unrealizedPnl(side: Side, entry: number, mark: number, qty: number): number {
  const diff = side === 'LONG' ? mark - entry : entry - mark;
  return round8(diff * qty);
}

export function roePct(uPnl: number, margin: number): number {
  if (!(margin > 0)) return 0;
  return round8((uPnl / margin) * 100);
}

/** Liquidation price for an isolated position opened at `entry` with `leverage`. */
export function liquidationPrice(side: Side, entry: number, leverage: number): number {
  const p =
    side === 'LONG'
      ? entry * (1 - 1 / leverage + MAINTENANCE_RATE)
      : entry * (1 + 1 / leverage - MAINTENANCE_RATE);
  return round8(Math.max(p, 0));
}

export interface OpenInput {
  side: Side;
  price: number;
  leverage: number;
  /** Exactly one of these. */
  notionalUsd?: number;
  qty?: number;
}

export type OpenCalc =
  | { ok: true; qty: number; notional: number; margin: number; openFee: number; liqPrice: number; requiredBalance: number }
  | { ok: false; error: string };

/** Sizes an order. qty is rounded DOWN to 8dp so margin never exceeds what was asked for. */
export function computeOpen(input: OpenInput): OpenCalc {
  const { price, leverage } = input;
  if (!(price > 0) || !Number.isFinite(price)) return { ok: false, error: 'invalid price' };
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
    return { ok: false, error: `leverage must be an integer between 1 and ${MAX_LEVERAGE}` };
  }
  const hasN = input.notionalUsd !== undefined;
  const hasQ = input.qty !== undefined;
  if (hasN === hasQ) return { ok: false, error: 'provide exactly one of notionalUsd or qty' };
  let qty: number;
  if (hasN) {
    const n = input.notionalUsd as number;
    if (!(n > 0) || !Number.isFinite(n)) return { ok: false, error: 'notionalUsd must be positive' };
    qty = Math.floor((n / price) * 1e8) / 1e8;
  } else {
    const q = input.qty as number;
    if (!(q > 0) || !Number.isFinite(q)) return { ok: false, error: 'qty must be positive' };
    qty = Math.floor(q * 1e8) / 1e8;
  }
  if (!(qty > 0)) return { ok: false, error: 'size is too small' };
  const notional = round8(qty * price);
  if (notional < MIN_NOTIONAL_USD) return { ok: false, error: `minimum order size is $${MIN_NOTIONAL_USD}` };
  if (notional > MAX_NOTIONAL_USD) return { ok: false, error: `maximum order size is $${MAX_NOTIONAL_USD.toLocaleString('en-US')}` };
  const margin = round8(notional / leverage);
  if (!(margin > 0)) return { ok: false, error: 'size is too small' };
  const openFee = fee(notional);
  return {
    ok: true,
    qty,
    notional,
    margin,
    openFee,
    liqPrice: liquidationPrice(input.side, price, leverage),
    requiredBalance: round8(margin + openFee),
  };
}

/** SL/TP must sit on the correct side of `ref` (entry at open, mark price when editing). */
export function validateSlTp(
  side: Side,
  ref: number,
  sl: number | null | undefined,
  tp: number | null | undefined
): string | null {
  if (sl !== null && sl !== undefined) {
    if (!(sl > 0) || !Number.isFinite(sl)) return 'stop loss must be a positive price';
    if (side === 'LONG' && !(sl < ref)) return 'stop loss must be below the price for a long';
    if (side === 'SHORT' && !(sl > ref)) return 'stop loss must be above the price for a short';
  }
  if (tp !== null && tp !== undefined) {
    if (!(tp > 0) || !Number.isFinite(tp)) return 'take profit must be a positive price';
    if (side === 'LONG' && !(tp > ref)) return 'take profit must be above the price for a long';
    if (side === 'SHORT' && !(tp < ref)) return 'take profit must be below the price for a short';
  }
  return null;
}

export interface PositionLike {
  side: Side;
  qty: number;
  leverage: number;
  entryPrice: number;
  margin: number;
  slPrice: number | null;
  tpPrice: number | null;
}

/** Which exit (if any) fires at `price`. Precedence: liquidation, then stop loss, then take profit. */
export function evaluateTrigger(p: PositionLike, price: number): { reason: ExitReason; exitPrice: number } | null {
  if (!(price > 0) || !Number.isFinite(price)) return null;
  const loss = -unrealizedPnl(p.side, p.entryPrice, price, p.qty);
  const maintenance = round8(p.entryPrice * p.qty * MAINTENANCE_RATE);
  if (loss >= round8(p.margin - maintenance)) return { reason: 'LIQUIDATED', exitPrice: price };
  if (p.slPrice !== null) {
    if (p.side === 'LONG' ? price <= p.slPrice : price >= p.slPrice) return { reason: 'SL', exitPrice: price };
  }
  if (p.tpPrice !== null) {
    if (p.side === 'LONG' ? price >= p.tpPrice : price <= p.tpPrice) return { reason: 'TP', exitPrice: price };
  }
  return null;
}

export interface CloseCalc {
  grossPnl: number;
  closeFee: number;
  totalFee: number;
  /** Amount credited back to the account (margin + pnl - close fee), never below 0. */
  credit: number;
  /** Net realized PnL: credit - margin - openFee (i.e. includes both fees). */
  realizedPnl: number;
}

export function computeClose(p: PositionLike & { openFee: number }, exitPrice: number): CloseCalc {
  const grossPnl = unrealizedPnl(p.side, p.entryPrice, exitPrice, p.qty);
  const closeFee = fee(round8(p.qty * exitPrice));
  const credit = Math.max(0, round8(p.margin + grossPnl - closeFee));
  const realizedPnl = round8(credit - p.margin - p.openFee);
  return { grossPnl, closeFee, totalFee: round8(p.openFee + closeFee), credit, realizedPnl };
}

/** Equity = free balance + sum(margin + uPnL) over open positions. */
export function equity(balance: number, open: { margin: number; uPnl: number }[]): number {
  return round8(open.reduce((s, p) => s + p.margin + p.uPnl, balance));
}
