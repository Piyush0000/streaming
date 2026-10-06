// Pure toast batching / dedupe for the "someone joined" feed.

export interface JoinEvent {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  avatarPreset?: string | null;
  source: string;
  createdAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  reddit: 'Reddit',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  google: 'Google',
};

export function sourceLabel(source: string): string | null {
  return SOURCE_LABEL[source] ?? null;
}

const MAX_NAMES = 3;
const MAX_NAME_LEN = 24;

function shortName(e: JoinEvent): string {
  const n = (e.displayName || e.username || 'Someone').trim() || 'Someone';
  return n.length > MAX_NAME_LEN ? n.slice(0, MAX_NAME_LEN - 1) + '…' : n;
}

export interface JoinPlan {
  /** Events to announce, oldest first. */
  fresh: JoinEvent[];
  /** Cursor to persist (ISO). Never moves backwards. */
  cursor: string | null;
  message: string | null;
}

/**
 * Decides what to toast. `cursor` is the newest createdAt already handled; with
 * no cursor (first ever poll in this browser) nothing is announced - we just
 * establish a baseline so a page reload never replays history. `seenIds` guards
 * against same-timestamp duplicates.
 */
export function planJoinToast(
  events: JoinEvent[],
  cursor: string | null,
  viewerId: string | null,
  seenIds: ReadonlySet<string> = new Set()
): JoinPlan {
  const valid = events.filter((e) => e && e.id && Number.isFinite(Date.parse(e.createdAt)));
  const newest = valid.reduce<string | null>(
    (acc, e) => (acc === null || Date.parse(e.createdAt) > Date.parse(acc) ? e.createdAt : acc),
    null
  );
  const nextCursor =
    cursor && newest ? (Date.parse(newest) > Date.parse(cursor) ? newest : cursor) : cursor ?? newest;
  if (!cursor) return { fresh: [], cursor: nextCursor, message: null };
  const c = Date.parse(cursor);
  const fresh = valid
    .filter((e) => Date.parse(e.createdAt) > c && !seenIds.has(e.id) && e.userId !== viewerId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { fresh, cursor: nextCursor, message: joinMessage(fresh) };
}

export function joinMessage(fresh: JoinEvent[]): string | null {
  if (fresh.length === 0) return null;
  if (fresh.length === 1) {
    const e = fresh[0];
    const label = sourceLabel(e.source);
    return `${shortName(e)} just joined Elonix Stream${label ? ` via ${label}` : ''}`;
  }
  const names = fresh.slice(0, MAX_NAMES).map(shortName);
  const extra = fresh.length - names.length;
  const who =
    extra > 0
      ? `${names.join(', ')} and ${extra} other${extra > 1 ? 's' : ''}`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${who} joined Elonix Stream`;
}
