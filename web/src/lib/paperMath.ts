/**
 * Client-side paper-trading math for the order-ticket PREVIEW only. The server is the
 * source of truth and recomputes everything on fill; these formulas mirror
 * services/api-service/src/paperMath.ts (taker fee 0.04%, maintenance 0.5%, isolated margin).
 */
export type Side = 'LONG' | 'SHORT';

export const TAKER_FEE_RATE = 0.0004;
export const MAINTENANCE_RATE = 0.005;
export const MIN_NOTIONAL_USD = 10;
export const MAX_LEVERAGE = 50;
export const MAX_POSITIONS = 5;

export function round8(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  const r = Math.round(n * 1e8) / 1e8;
  return r === 0 ? 0 : r;
}

export function liquidationPrice(side: Side, entry: number, leverage: number): number {
  const p = side === 'LONG' ? entry * (1 - 1 / leverage + MAINTENANCE_RATE) : entry * (1 + 1 / leverage - MAINTENANCE_RATE);
  return round8(Math.max(p, 0));
}

export function unrealizedPnl(side: Side, entry: number, mark: number, qty: number): number {
  return round8((side === 'LONG' ? mark - entry : entry - mark) * qty);
}

/** Leveraged return on margin, in percent. Gross, fees excluded. */
export function roePct(uPnl: number, margin: number): number {
  return margin > 0 ? round8((uPnl / margin) * 100) : 0;
}

/** Largest notional whose margin + open fee fits in `pct`% of the available balance. */
export function notionalForBalancePct(available: number, pct: number, leverage: number): number {
  if (!(available > 0) || !(pct > 0) || !(leverage >= 1)) return 0;
  const budget = (available * Math.min(pct, 100)) / 100;
  // floor to cents so margin + fee never exceeds the budget
  return Math.floor((budget / (1 / leverage + TAKER_FEE_RATE)) * 100) / 100;
}

/** Converts a percent distance from `entry` to an absolute SL/TP price on the correct side. */
export function priceFromPercent(side: Side, entry: number, kind: 'sl' | 'tp', pct: number): number | null {
  if (!(entry > 0) || !Number.isFinite(pct) || pct <= 0) return null;
  const down = (side === 'LONG') === (kind === 'sl');
  const p = entry * (down ? 1 - pct / 100 : 1 + pct / 100);
  return p > 0 ? round8(p) : null;
}

/** Percent distance of `price` from `entry` (positive when on the correct side). */
export function percentFromPrice(side: Side, entry: number, kind: 'sl' | 'tp', price: number): number | null {
  if (!(entry > 0) || !(price > 0)) return null;
  const down = (side === 'LONG') === (kind === 'sl');
  return round8(((down ? entry - price : price - entry) / entry) * 100);
}

export function validateSlTp(side: Side, ref: number, sl: number | null, tp: number | null): string | null {
  if (sl !== null) {
    if (!(sl > 0) || !Number.isFinite(sl)) return 'Stop loss must be a positive price.';
    if (side === 'LONG' && !(sl < ref)) return 'Stop loss must be below the price for a long.';
    if (side === 'SHORT' && !(sl > ref)) return 'Stop loss must be above the price for a short.';
  }
  if (tp !== null) {
    if (!(tp > 0) || !Number.isFinite(tp)) return 'Take profit must be a positive price.';
    if (side === 'LONG' && !(tp > ref)) return 'Take profit must be above the price for a long.';
    if (side === 'SHORT' && !(tp < ref)) return 'Take profit must be below the price for a short.';
  }
  return null;
}

export interface PreviewInput {
  side: Side;
  price: number | null;
  notional: number;
  leverage: number;
  available: number;
  sl: number | null;
  tp: number | null;
  openPositions: number;
}
export interface Preview {
  ok: boolean;
  /** First blocking problem, if any (already user-facing). */
  error: string | null;
  qty: number;
  margin: number;
  openFee: number;
  required: number;
  liqPrice: number | null;
  /** Loss at SL incl. both fees (positive number), null without SL. */
  maxLoss: number | null;
  /** Profit at TP net of both fees, null without TP. */
  maxProfit: number | null;
  /** maxProfit / maxLoss, null unless both SL and TP are set. */
  riskReward: number | null;
}

export function previewOrder(i: PreviewInput): Preview {
  const empty: Preview = { ok: false, error: null, qty: 0, margin: 0, openFee: 0, required: 0, liqPrice: null, maxLoss: null, maxProfit: null, riskReward: null };
  if (i.price === null || !(i.price > 0)) return { ...empty, error: 'Waiting for a live price…' };
  if (!(i.notional > 0) || !Number.isFinite(i.notional)) return { ...empty, error: 'Enter an order size.' };
  const qty = Math.floor((i.notional / i.price) * 1e8) / 1e8;
  const notional = round8(qty * i.price);
  const margin = round8(notional / i.leverage);
  const openFee = round8(notional * TAKER_FEE_RATE);
  const required = round8(margin + openFee);
  const liq = liquidationPrice(i.side, i.price, i.leverage);
  const netAt = (exit: number) => {
    const gross = unrealizedPnl(i.side, i.price as number, exit, qty);
    return round8(gross - openFee - round8(qty * exit * TAKER_FEE_RATE));
  };
  const maxLoss = i.sl !== null ? Math.min(required, Math.max(0, -netAt(i.sl))) : null;
  const maxProfit = i.tp !== null ? Math.max(0, netAt(i.tp)) : null;
  const rr = maxLoss !== null && maxProfit !== null && maxLoss > 0 ? round8(maxProfit / maxLoss) : null;
  let error: string | null = null;
  if (notional < MIN_NOTIONAL_USD) error = `Minimum order size is $${MIN_NOTIONAL_USD}.`;
  else if (i.openPositions >= MAX_POSITIONS) error = `You can hold at most ${MAX_POSITIONS} open positions.`;
  else if (required > i.available) error = 'Not enough available balance for this size.';
  else error = validateSlTp(i.side, i.price, i.sl, i.tp);
  return { ok: error === null, error, qty, margin, openFee, required, liqPrice: liq, maxLoss, maxProfit, riskReward: rr };
}

/** Parses a user-typed decimal; returns null for empty/invalid/non-positive input. */
export function parsePositive(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Signed money, e.g. +$12.34 / -$5.00. */
export function formatPnl(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}$${abs}`;
}
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function formatSignedPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}
