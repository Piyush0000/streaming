import { toNum } from './marketData';

/** All-USDT-symbols market data + overview widgets. Pure helpers first (unit-tested), I/O + caches below. */

export interface SymbolRow {
  symbol: string;
  base: string;
  quote: 'USDT';
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
}

const STABLES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDD', 'USD1', 'USDE', 'USDS', 'BFUSD', 'RLUSD', 'PYUSD',
  'AEUR', 'EUR', 'EURI', 'GBP', 'TRY', 'BRL', 'USTC', 'UST', 'XUSD', 'USDX', 'FRAX', 'LUSD', 'GUSD', 'SUSD',
]);
const LEVERAGED = /^(.+?)(UP|DOWN|BULL|BEAR)$/;
const MIN_QUOTE_VOLUME_MOVERS = 5_000_000;

/** Parses Binance /ticker/24hr (all symbols) into USDT spot rows; invalid / leveraged / stable / zero-volume rows are dropped. */
export function parseAllUsdtTickers(raw: unknown): SymbolRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: SymbolRow[] = [];
  const bases = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const sym = (row as Record<string, unknown>).symbol;
    if (typeof sym === 'string' && sym.endsWith('USDT')) bases.add(sym.slice(0, -4));
  }
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.symbol !== 'string' || !r.symbol.endsWith('USDT')) continue;
    const base = r.symbol.slice(0, -4);
    if (!/^[A-Z0-9]{1,15}$/.test(base)) continue;
    if (STABLES.has(base)) continue;
    const lev = LEVERAGED.exec(base);
    if (lev && bases.has(lev[1])) continue; // BTCUP/BTCDOWN-style; JUP/SYRUP stay (no "J"/"SYR" market)
    const price = toNum(r.lastPrice);
    const changePct = toNum(r.priceChangePercent);
    const high = toNum(r.highPrice);
    const low = toNum(r.lowPrice);
    const volume = toNum(r.volume);
    const quoteVolume = toNum(r.quoteVolume);
    if (price === null || price <= 0 || changePct === null || high === null || low === null) continue;
    if (volume === null || volume <= 0 || quoteVolume === null || quoteVolume <= 0) continue;
    rows.push({ symbol: r.symbol, base, quote: 'USDT', price, changePct, high, low, volume, quoteVolume });
  }
  return rows;
}

export type SymbolSort = 'volume' | 'gainers' | 'losers' | 'name';

export function sortSymbols(rows: SymbolRow[], sort: SymbolSort): SymbolRow[] {
  const out = [...rows];
  switch (sort) {
    case 'gainers': out.sort((a, b) => b.changePct - a.changePct); break;
    case 'losers': out.sort((a, b) => a.changePct - b.changePct); break;
    case 'name': out.sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0)); break;
    default: out.sort((a, b) => b.quoteVolume - a.quoteVolume);
  }
  return out;
}

export function querySymbols(rows: SymbolRow[], opts: { sort: SymbolSort; q?: string; limit: number }): { count: number; symbols: SymbolRow[] } {
  const q = (opts.q ?? '').trim().toUpperCase().slice(0, 20);
  const filtered = q ? rows.filter((r) => r.symbol.includes(q)) : rows;
  return { count: filtered.length, symbols: sortSymbols(filtered, opts.sort).slice(0, opts.limit) };
}

export function computeMovers(rows: SymbolRow[], n = 8) {
  const liquid = rows.filter((r) => r.quoteVolume >= MIN_QUOTE_VOLUME_MOVERS);
  return {
    gainers: sortSymbols(liquid, 'gainers').slice(0, n),
    losers: sortSymbols(liquid, 'losers').slice(0, n),
    volume: sortSymbols(rows, 'volume').slice(0, n),
  };
}

export interface FearGreed { value: number; label: string; updatedAt: string }
export interface GlobalStats { totalMarketCapUsd: number; btcDominancePct: number; marketCapChangePct24h: number; activeCryptos: number }

export function parseFearGreed(raw: unknown): FearGreed | null {
  const d = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : undefined;
  const first = Array.isArray(d) ? d[0] : undefined;
  if (!first || typeof first !== 'object') return null;
  const f = first as Record<string, unknown>;
  const value = toNum(f.value);
  const ts = toNum(f.timestamp);
  if (value === null || value < 0 || value > 100 || ts === null || ts <= 0) return null;
  const label = typeof f.value_classification === 'string' ? f.value_classification.trim().slice(0, 40) : '';
  if (!label) return null;
  return { value: Math.round(value), label, updatedAt: new Date(ts * 1000).toISOString() };
}

export function parseGlobal(raw: unknown): GlobalStats | null {
  const d = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : undefined;
  if (!d || typeof d !== 'object') return null;
  const g = d as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const totalMarketCapUsd = toNum(g.total_market_cap?.usd);
  const btcDominancePct = toNum(g.market_cap_percentage?.btc);
  const marketCapChangePct24h = toNum(g.market_cap_change_percentage_24h_usd);
  const activeCryptos = toNum(g.active_cryptocurrencies);
  if (totalMarketCapUsd === null || totalMarketCapUsd <= 0 || btcDominancePct === null || marketCapChangePct24h === null || activeCryptos === null) return null;
  return { totalMarketCapUsd, btcDominancePct, marketCapChangePct24h, activeCryptos };
}

