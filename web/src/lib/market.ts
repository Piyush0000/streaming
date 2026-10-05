const MARKET_BASE = `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/market`;

export interface MarketTicker {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
}
export interface TickersResponse {
  updatedAt: string;
  stale: boolean;
  tickers: MarketTicker[];
}
export interface MarketSignal {
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
export interface SignalsResponse {
  fetchedAt: string;
  upstreamStale: boolean;
  signals: MarketSignal[];
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${MARKET_BASE}${path}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? 'Too many requests — slowing down.'
        : res.status === 503
          ? 'Market data is temporarily unavailable.'
          : (body as { message?: string }).message ?? `Request failed (${res.status})`
    );
  }
  return body as T;
}

export const fetchTickers = (signal?: AbortSignal) => getJson<TickersResponse>('/tickers', signal);
export const fetchSignals = (signal?: AbortSignal) => getJson<SignalsResponse>('/signals', signal);
