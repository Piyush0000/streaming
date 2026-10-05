/** Pure market helpers (no DOM / env access) so they can be unit-tested with tsx. */

export interface PositionInput {
  balance: number;
  riskPct: number;
  entry: number;
  stop: number;
}

export type PositionResult =
  | {
      ok: true;
      side: 'long' | 'short';
      riskAmount: number;
      stopDistance: number;
      stopDistancePct: number;
      /** Units of the asset to buy/sell. */
      positionSize: number;
      /** Position value in quote currency (units * entry). */
      notional: number;
      /** notional / balance; > 1 means leverage is required. */
      leverage: number;
    }
  | { ok: false; errors: Partial<Record<keyof PositionInput, string>> };

/** Parses a user-typed number; accepts a decimal comma. Returns NaN when blank/invalid. */
export function parseInputNumber(raw: string): number {
  const s = raw.trim().replace(',', '.');
  if (s === '') return NaN;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
}

export function calcPosition(input: PositionInput): PositionResult {
  const errors: Partial<Record<keyof PositionInput, string>> = {};
  const { balance, riskPct, entry, stop } = input;
  if (!Number.isFinite(balance) || balance <= 0) errors.balance = 'Enter a balance above 0.';
  if (!Number.isFinite(riskPct) || riskPct <= 0) errors.riskPct = 'Enter a risk % above 0.';
  else if (riskPct > 100) errors.riskPct = 'Risk cannot exceed 100%.';
  if (!Number.isFinite(entry) || entry <= 0) errors.entry = 'Enter an entry price above 0.';
  if (!Number.isFinite(stop) || stop <= 0) errors.stop = 'Enter a stop price above 0.';
  if (!errors.entry && !errors.stop && entry === stop) errors.stop = 'Stop must differ from entry.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const riskAmount = (balance * riskPct) / 100;
  const stopDistance = Math.abs(entry - stop); // > 0 guaranteed above
  const positionSize = riskAmount / stopDistance;
  const notional = positionSize * entry;
  if (![riskAmount, positionSize, notional].every(Number.isFinite)) {
    return { ok: false, errors: { entry: 'Values are out of range.' } };
  }
  return {
    ok: true,
    side: stop < entry ? 'long' : 'short',
    riskAmount,
    stopDistance,
    stopDistancePct: (stopDistance / entry) * 100,
    positionSize,
    notional,
    leverage: notional / balance,
  };
}

/** Adaptive precision: big prices get 2dp, sub-dollar coins get more significant digits. */
export function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  const abs = Math.abs(p);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  return p.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, dp), maximumFractionDigits: dp });
}

export function formatChangePct(c: number): string {
  if (!Number.isFinite(c)) return '—';
  return `${c > 0 ? '+' : ''}${c.toFixed(2)}%`;
}

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

/** "just now", "5m ago", "3h ago", "12d ago". */
export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Strips the quote asset for display: BTCUSDT -> BTC. */
export function baseSymbol(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

/** Polling delay with exponential backoff on consecutive failures (capped). */
export function nextPollDelay(baseMs: number, failures: number, maxMs = 120_000): number {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 10));
}
