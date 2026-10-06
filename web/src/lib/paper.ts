import { apiRequest } from './api';
import type { Side } from './paperMath';

export type ExitReason = 'MANUAL' | 'SL' | 'TP' | 'LIQUIDATED';

export interface PaperPosition {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  leverage: number;
  entryPrice: number;
  notional: number;
  margin: number;
  slPrice: number | null;
  tpPrice: number | null;
  liqPrice: number;
  fee: number;
  openedAt: string;
  markPrice: number | null;
  uPnl: number | null;
  roePct: number | null;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: Side;
  qty: number;
  leverage: number;
  entryPrice: number;
  margin: number;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  realizedPnl: number;
  roePct: number;
  fee: number;
  openedAt: string;
  closedAt: string | null;
}

export interface TriggeredClose {
  id: string;
  symbol: string;
  side: Side;
  reason: ExitReason;
  exitPrice: number;
  realizedPnl: number;
}

export interface PaperAccount {
  paper: true;
  startingBalance: number;
  balance: number;
  equity: number | null;
  unrealizedPnl: number | null;
  usedMargin: number;
  resetCount: number;
  resetAvailableAt: string | null;
  positions: PaperPosition[];
  closedByEngine: TriggeredClose[];
  pricesOk: boolean;
  pricesAt: string | null;
  prices: Record<string, number>;
  limits: { symbols: string[]; maxPositions: number; minNotionalUsd: number; maxLeverage: number; takerFeeRate: number };
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  pnl: number;
  pnlPct: number;
  trades: number;
  me: boolean;
}

export interface OrderRequest {
  symbol: string;
  side: Side;
  notionalUsd: number;
  leverage: number;
  slPrice?: number;
  tpPrice?: number;
}

export const paperApi = {
  account: (token: string, signal?: AbortSignal) => apiRequest<PaperAccount>(token, 'GET', '/paper/account', undefined, signal),
  order: (token: string, body: OrderRequest) => apiRequest<{ position: PaperPosition }>(token, 'POST', '/paper/orders', body),
  patch: (token: string, id: string, body: { slPrice?: number | null; tpPrice?: number | null }) =>
    apiRequest<{ position: PaperPosition }>(token, 'PATCH', `/paper/positions/${id}`, body),
  close: (token: string, id: string) => apiRequest<{ trade: PaperTrade }>(token, 'POST', `/paper/positions/${id}/close`),
  history: (token: string, cursor?: string | null, signal?: AbortSignal) =>
    apiRequest<{ trades: PaperTrade[]; nextCursor: string | null }>(
      token,
      'GET',
      `/paper/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      undefined,
      signal
    ),
  reset: (token: string, closeOpen: boolean) =>
    apiRequest<{ balance: number; closedPositions: number }>(token, 'POST', '/paper/reset', { closeOpen }),
  leaderboard: (token: string, signal?: AbortSignal) =>
    apiRequest<{ windowDays: number; basis: string; entries: LeaderboardEntry[] }>(token, 'GET', '/paper/leaderboard', undefined, signal),
};

export const REASON_LABEL: Record<ExitReason, string> = {
  MANUAL: 'Closed',
  SL: 'Stop loss',
  TP: 'Take profit',
  LIQUIDATED: 'Liquidated',
};
