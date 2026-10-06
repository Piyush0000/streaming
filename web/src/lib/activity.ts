import { apiRequest } from './api';
import type { JoinEvent } from './joinToasts';

export async function postJoined(token: string, source: string): Promise<{ recorded: boolean }> {
  return apiRequest(token, 'POST', '/activity/joined', { source });
}

export async function fetchRecentJoins(token: string, since?: string | null, limit = 20): Promise<JoinEvent[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (since) q.set('since', since);
  const body = await apiRequest<{ events: JoinEvent[] }>(token, 'GET', `/activity/recent?${q.toString()}`);
  return Array.isArray(body.events) ? body.events : [];
}
