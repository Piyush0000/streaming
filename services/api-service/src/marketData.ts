/** Pure parsing/mapping helpers for the /market routes (no I/O, unit-tested). */

export const TICKER_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
] as const;

export interface Ticker {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
}

export interface Signal {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'NEUTRAL';
  price: number | null;
  confidence: number | null;
  strategy: string | null;
  source: string | null;
  createdAt: string;
  ageSeconds: number;
  stale: boolean;
}

export const SIGNAL_STALE_AFTER_SECONDS = 24 * 3600;

/** Finite number from number|numeric-string, else null. */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Maps Binance 24hr rows; rows with missing/invalid price are dropped (never defaulted to 0). */
export function parseBinanceTickers(raw: unknown): Ticker[] {
  if (!Array.isArray(raw)) return [];
  const bySymbol = new Map<string, Ticker>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.symbol !== 'string') continue;
    const price = toNum(r.lastPrice);
    const changePct = toNum(r.priceChangePercent);
    const high = toNum(r.highPrice);
    const low = toNum(r.lowPrice);
    const volume = toNum(r.volume);
    if (price === null || price <= 0 || changePct === null || high === null || low === null || volume === null) continue;
    bySymbol.set(r.symbol, { symbol: r.symbol, price, changePct, high, low, volume });
  }
  // Stable, requested order.
  return TICKER_SYMBOLS.map((s) => bySymbol.get(s)).filter((t): t is Ticker => !!t);
}

export function mapSignals(raw: unknown, nowMs: number, limit = 20): Signal[] {
  const list = raw && typeof raw === 'object' ? (raw as { signals?: unknown }).signals : undefined;
  if (!Array.isArray(list)) return [];
  const out: Signal[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const symbol = typeof s.symbol === 'string' ? s.symbol.trim().toUpperCase().slice(0, 20) : '';
    if (!symbol) continue;
    const actionRaw = typeof s.action === 'string' ? s.action.trim().toUpperCase() : '';
    const action = actionRaw === 'BUY' || actionRaw === 'SELL' ? actionRaw : 'NEUTRAL';
    const when = [s.timestamp, s.createdAt]
      .map((v) => (typeof v === 'string' ? Date.parse(v) : NaN))
      .find((t) => Number.isFinite(t));
    if (when === undefined) continue; // cannot state an age honestly -> skip
    const ageSeconds = Math.max(0, Math.floor((nowMs - when) / 1000));
    const id = typeof s._id === 'string' ? s._id : typeof s.id === 'string' ? s.id : `${symbol}-${when}`;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
    out.push({
      id,
      symbol,
      action,
      price: toNum(s.price),
      confidence: toNum(s.confidence),
      strategy: str(s.strategy),
      source: str(s.source),
      createdAt: new Date(when).toISOString(),
      ageSeconds,
      stale: ageSeconds > SIGNAL_STALE_AFTER_SECONDS,
    });
  }
  out.sort((a, b) => a.ageSeconds - b.ageSeconds);
  return out.slice(0, limit);
}
