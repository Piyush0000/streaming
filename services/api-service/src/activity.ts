// Pure helpers for the join-activity feed (no env/db imports; unit tested).
export const JOIN_SOURCES = ['x', 'facebook', 'instagram', 'youtube', 'reddit', 'telegram', 'whatsapp', 'google', 'direct', 'other'] as const;
export type JoinSource = (typeof JOIN_SOURCES)[number];

/** Unknown / malformed values become 'other'. */
export function normalizeJoinSource(v: unknown): JoinSource {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (JOIN_SOURCES as readonly string[]).includes(s) ? (s as JoinSource) : 'other';
}

export const NEW_ACCOUNT_WINDOW_MS = 24 * 3600_000;
export const FEED_WINDOW_MS = 24 * 3600_000;
export const FEED_DEFAULT_LIMIT = 20;
export const FEED_MAX_LIMIT = 50;

export function isNewAccount(createdAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t <= NEW_ACCOUNT_WINDOW_MS && t <= now + 60_000;
}

export function parseFeedLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return FEED_DEFAULT_LIMIT;
  return Math.min(n, FEED_MAX_LIMIT);
}

/** Lower bound for the feed query: `since` clamped into the last 24h; invalid -> the 24h floor. */
export function feedSince(raw: unknown, now = Date.now()): Date {
  const floor = now - FEED_WINDOW_MS;
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return new Date(Number.isFinite(t) ? Math.min(Math.max(t, floor), now) : floor);
}
