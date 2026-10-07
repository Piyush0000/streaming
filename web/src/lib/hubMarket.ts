/** Client for the public news + market-data API used by the Hub. All parsing is defensive. */

// `?.` keeps this module importable from node-run unit tests (no Vite env there).
const API = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ?? '/api';

export type NewsCategory = 'all' | 'crypto' | 'markets' | 'world';

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  category: string;
  publishedAt: string | null;
  summary: string | null;
}
export interface NewsSource {
  name: string;
  ok: boolean;
}
export interface NewsPage {
  fetchedAt: string | null;
  stale: boolean;
  sources: NewsSource[];
  items: NewsItem[];
  nextCursor: string | null;
}
export interface MarketSymbol {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
}
export interface SymbolsResponse {
  updatedAt: string | null;
  stale: boolean;
  count: number;
  symbols: MarketSymbol[];
}
export interface MarketOverview {
  updatedAt: string | null;
  fearGreed: { value: number; label: string; updatedAt: string | null } | null;
  global: {
    totalMarketCapUsd: number | null;
    btcDominancePct: number | null;
    marketCapChangePct24h: number | null;
    activeCryptos: number | null;
  } | null;
}
export interface Movers {
  gainers: MarketSymbol[];
  losers: MarketSymbol[];
  volume: MarketSymbol[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Only http(s) links are ever rendered as hrefs. */
export function safeUrl(u: unknown): string | null {
  const s = str(u);
  if (!s) return null;
  try {
    const p = new URL(s);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : null;
  } catch {
    return null;
  }
}

export function parseNewsItem(raw: unknown): NewsItem | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title);
  const url = safeUrl(raw.url);
  if (!title || !url) return null;
  return {
    id: str(raw.id) ?? url,
    title,
    url,
    source: str(raw.source) ?? 'Unknown',
    category: str(raw.category) ?? 'all',
    publishedAt: str(raw.publishedAt),
    summary: str(raw.summary),
  };
}

export function parseNewsItems(raw: unknown): NewsItem[] {
  return Array.isArray(raw) ? raw.map(parseNewsItem).filter((x): x is NewsItem => x !== null) : [];
}

export function parseNewsPage(raw: unknown): NewsPage {
  const o = isObj(raw) ? raw : {};
  return {
    fetchedAt: str(o.fetchedAt),
    stale: o.stale === true,
    sources: Array.isArray(o.sources)
      ? o.sources.filter(isObj).map((s) => ({ name: str(s.name) ?? 'source', ok: s.ok === true }))
      : [],
    items: parseNewsItems(o.items),
    nextCursor: str(o.nextCursor),
  };
}

export function parseSymbol(raw: unknown): MarketSymbol | null {
  if (!isObj(raw)) return null;
  const symbol = str(raw.symbol);
  const price = num(raw.price);
  if (!symbol || price === null) return null;
  return {
    symbol,
    base: str(raw.base) ?? symbol.replace(/(USDT|USDC|BUSD|USD)$/, ''),
    quote: str(raw.quote) ?? 'USDT',
    price,
    changePct: num(raw.changePct) ?? 0,
    high: num(raw.high) ?? price,
    low: num(raw.low) ?? price,
    volume: num(raw.volume) ?? 0,
    quoteVolume: num(raw.quoteVolume) ?? 0,
  };
}

export function parseSymbols(raw: unknown): MarketSymbol[] {
  return Array.isArray(raw) ? raw.map(parseSymbol).filter((x): x is MarketSymbol => x !== null) : [];
}

export function parseSymbolsResponse(raw: unknown): SymbolsResponse {
  const o = isObj(raw) ? raw : {};
  const symbols = parseSymbols(o.symbols);
  return { updatedAt: str(o.updatedAt), stale: o.stale === true, count: num(o.count) ?? symbols.length, symbols };
}

export function parseOverview(raw: unknown): MarketOverview {
  const o = isObj(raw) ? raw : {};
  const fg = isObj(o.fearGreed) ? o.fearGreed : null;
  const g = isObj(o.global) ? o.global : null;
  const fgValue = fg ? num(fg.value) : null;
  return {
    updatedAt: str(o.updatedAt),
    fearGreed:
      fg && fgValue !== null
        ? { value: Math.min(100, Math.max(0, fgValue)), label: str(fg.label) ?? '', updatedAt: str(fg.updatedAt) }
        : null,
    global: g
      ? {
          totalMarketCapUsd: num(g.totalMarketCapUsd),
          btcDominancePct: num(g.btcDominancePct),
          marketCapChangePct24h: num(g.marketCapChangePct24h),
          activeCryptos: num(g.activeCryptos),
        }
      : null,
  };
}

export function parseMovers(raw: unknown): Movers {
  const o = isObj(raw) ? raw : {};
  return { gainers: parseSymbols(o.gainers), losers: parseSymbols(o.losers), volume: parseSymbols(o.volume) };
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { signal });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? 'Too many requests, slowing down.'
        : res.status === 503
          ? 'Data is temporarily unavailable.'
          : `Request failed (${res.status})`
    );
  }
  return body;
}

export async function fetchNews(
  p: { category: NewsCategory; q?: string; limit?: number; cursor?: string | null },
  signal?: AbortSignal
): Promise<NewsPage> {
  const qs = new URLSearchParams({ category: p.category, limit: String(p.limit ?? 20) });
  if (p.q?.trim()) qs.set('q', p.q.trim());
  if (p.cursor) qs.set('cursor', p.cursor);
  return parseNewsPage(await getJson(`/news?${qs}`, signal));
}
export async function fetchHeadlines(signal?: AbortSignal): Promise<NewsItem[]> {
  const body = await getJson('/news/headlines', signal);
  return parseNewsItems(isObj(body) ? body.items : null);
}
export async function fetchSymbols(
  p: { limit?: number; sort?: 'volume' | 'gainers' | 'losers' | 'name'; q?: string } = {},
  signal?: AbortSignal
): Promise<SymbolsResponse> {
  const qs = new URLSearchParams({ limit: String(Math.min(200, p.limit ?? 200)), sort: p.sort ?? 'volume' });
  if (p.q?.trim()) qs.set('q', p.q.trim());
  return parseSymbolsResponse(await getJson(`/market/symbols?${qs}`, signal));
}
export async function fetchOverview(signal?: AbortSignal): Promise<MarketOverview> {
  return parseOverview(await getJson('/market/overview', signal));
}
export async function fetchMovers(signal?: AbortSignal): Promise<Movers> {
  return parseMovers(await getJson('/market/movers', signal));
}

export const hubMarketPath = {
  news: '/elonixhub/news',
  markets: '/elonixhub/markets',
  marketsFor: (symbol: string) => `/elonixhub/markets?q=${encodeURIComponent(symbol)}`,
};

/** Safe relative time for possibly-missing ISO strings. */
export function safeRelative(iso: string | null, rel: (iso: string) => string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return rel(iso);
}
