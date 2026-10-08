/**
 * One shared map of machine-readable error codes -> friendly, user-facing text,
 * plus classification of join/connect failures (transient vs fatal ...).
 * Pure: no DOM / import.meta access, so it is unit testable and importable anywhere.
 */

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';
export const OFFLINE_MESSAGE = "Can't reach Elonix right now. Retrying…";

export const SHARED_ERRORS: Record<string, string> = {
  // auth
  invalid_token: SESSION_EXPIRED_MESSAGE,
  token_expired: SESSION_EXPIRED_MESSAGE,
  missing_token: SESSION_EXPIRED_MESSAGE,
  unauthorized: SESSION_EXPIRED_MESSAGE,
  // generic
  forbidden: 'You do not have permission to do that.',
  internal_error: 'Something went wrong on our side. Please try again.',
  rate_limited: 'You are doing that too fast. Please wait a moment.',
  network_error: "Can't reach Elonix right now. Check your connection and try again.",
  timeout: 'Elonix is taking too long to respond. Please try again.',
  service_unavailable: 'Elonix is temporarily unavailable. Please try again in a moment.',
  access_unavailable: "We couldn't verify your access right now. Please try again in a moment.",
  // streams / rooms
  stream_not_found: 'This stream could not be found. It may have been removed.',
  stream_already_ended: 'This stream has already ended.',
  stream_ended: 'This stream has ended.',
  room_full: 'This room is full. Try again in a moment.',
  banned: 'You are banned from this stream.',
  removed: 'You were removed from this room.',
  kicked: 'You were removed from this room by a moderator.',
  not_eligible: "You can't host streams yet. Check the requirements and try again later.",
  already_live: 'You already have a live stream.',
  guidelines_not_accepted: 'Please accept the community guidelines to continue.',
  speak_cooldown: 'Please wait a little before asking to speak again.',
  speak_request_pending: 'You already have a pending request to speak.',
  // channels / invites
  channel_not_found: 'This channel was deleted, is private, or you do not have access to it.',
  not_member: 'You need to be a member of this channel to do that.',
  unsupported_channel_kind: 'Stream channels are managed from the Live section, not here.',
  channel_name_taken: 'A channel with that name already exists.',
  owner_cannot_leave: 'The owner cannot leave the channel. Delete it instead.',
  cannot_remove_owner: 'The channel owner cannot be removed.',
  cannot_change_owner: "The owner's role cannot be changed.",
  member_not_found: 'That user is not a member of this channel.',
  already_member: 'That user is already a member.',
  channel_full: 'This channel has reached its member limit.',
  too_many_invites: 'This channel has too many active invites. Revoke one first.',
  invite_not_found: 'This invite link is not valid.',
  invite_expired: 'This invite link has expired. Ask for a new one.',
  invite_revoked: 'This invite link was revoked. Ask for a new one.',
  invite_exhausted: 'This invite link has reached its maximum number of uses. Ask for a new one.',
  user_not_found: 'That user no longer exists.',
  // hub
  unsupported_image: 'That image type is not supported. Use PNG, JPG, WebP or GIF.',
  payload_too_large: 'That image is too large (max 5MB).',
  not_found: 'That no longer exists.',
  slug_taken: 'That community name is already taken.',
  community_not_found: 'That community no longer exists.',
};

/** "Try again in 5s" style text for a rate-limit wait. */
export function rateLimitMessage(retryAfterMs?: number): string {
  if (!retryAfterMs || retryAfterMs <= 0) return SHARED_ERRORS.rate_limited;
  return `You are doing that too fast. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`;
}

export function roomFullMessage(capacity?: { current: number; max: number }): string {
  return capacity
    ? `This room is full (${capacity.current}/${capacity.max}). Try again in a moment.`
    : SHARED_ERRORS.room_full;
}

interface ErrorLike {
  name?: string;
  message?: string;
  code?: unknown;
  status?: unknown;
  retryAfterMs?: unknown;
  capacity?: { current: number; max: number };
}

export type JoinFailureKind =
  | 'transient' // network / 5xx / timeout: auto-retry with backoff
  | 'auth' // token rejected: refresh once, then retry
  | 'full' // room full: user-driven Retry
  | 'rate_limited' // wait out the countdown, then Retry
  | 'fatal' // banned, ended, deleted, no access: nothing to retry
  | 'permission' // mic / screen permission denied
  | 'other';

export interface JoinFailure {
  kind: JoinFailureKind;
  message: string;
  retryAfterMs?: number;
}

const FATAL_CODES = new Set([
  'forbidden',
  'banned',
  'removed',
  'kicked',
  'stream_ended',
  'stream_already_ended',
  'stream_not_found',
  'channel_not_found',
  'not_member',
  'not_eligible',
  'invite_not_found',
  'invite_expired',
  'invite_revoked',
  'invite_exhausted',
]);

const NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|connection closed|failed to connect|websocket|timed? ?out|socket/i;

/** Maps any join/connect failure to a kind + friendly text. Never returns raw codes or stack text. */
export function classifyJoinFailure(err: unknown): JoinFailure {
  const e = (err ?? {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const retryAfterMs = typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined;

  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
    return { kind: 'permission', message: 'Microphone access was blocked. Allow it in your browser settings, then try again.' };
  }
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
    return { kind: 'permission', message: 'No microphone was found. Connect one and try again.' };
  }
  if (code === 'room_full') return { kind: 'full', message: roomFullMessage(e.capacity) };
  if (code === 'rate_limited' || code === 'speak_cooldown' || status === 429) {
    return { kind: 'rate_limited', message: rateLimitMessage(retryAfterMs), retryAfterMs };
  }
  if (code === 'invalid_token' || code === 'token_expired' || code === 'missing_token' || code === 'unauthorized' || status === 401) {
    return { kind: 'auth', message: SESSION_EXPIRED_MESSAGE };
  }
  if (code && FATAL_CODES.has(code)) {
    return { kind: 'fatal', message: SHARED_ERRORS[code] ?? 'You cannot join this right now.' };
  }
  if (
    code === 'network_error' ||
    code === 'access_unavailable' ||
    code === 'timeout' ||
    code === 'service_unavailable' ||
    status === 0 ||
    (status !== undefined && status >= 500) ||
    (!code && typeof e.message === 'string' && NETWORK_MESSAGE.test(e.message))
  ) {
    return { kind: 'transient', message: OFFLINE_MESSAGE };
  }
  if (code && SHARED_ERRORS[code]) return { kind: 'other', message: SHARED_ERRORS[code] };
  return { kind: 'other', message: 'Could not join. Please try again.' };
}
