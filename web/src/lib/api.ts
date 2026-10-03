import type { Channel, MessageAttachment } from '@streaming/shared-types';

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL ?? '/api/auth';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const UPLOADS_BASE_URL = import.meta.env.VITE_UPLOADS_BASE_URL ?? '/api/uploads';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

export interface AuthTokens {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

async function parseJsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Prefer the specific, field-level message the backend already computes
    // (zod issues formatted as "field: reason") over the bare error code —
    // a generic "invalid_input" tells the user nothing about what to fix.
    throw new Error(body?.message ?? body?.error ?? `request failed with status ${res.status}`);
  }
  return body;
}

export async function signup(username: string, email: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${AUTH_BASE_URL}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  return parseJsonOrThrow(res);
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${AUTH_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return parseJsonOrThrow(res);
}

export async function loginWithGoogle(idToken: string): Promise<AuthTokens> {
  const res = await fetch(`${AUTH_BASE_URL}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  return parseJsonOrThrow(res);
}

export async function refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(`${AUTH_BASE_URL}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  return parseJsonOrThrow(res);
}

export async function listChannels(accessToken: string): Promise<Channel[]> {
  const res = await fetch(`${API_BASE_URL}/channels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await parseJsonOrThrow(res);
  return body.channels;
}

/**
 * `attachment.url` (as stored/returned by chat-service) is that service's
 * own route, e.g. "/uploads/<file>" — not necessarily where it's publicly
 * reachable (in prod the gateway proxies it under /api/uploads/ instead).
 * Resolve the actual browser-fetchable URL from UPLOADS_BASE_URL + filename
 * so this works both hitting chat-service directly (dev) and through the
 * gateway (prod) without the backend needing to know which.
 */
export function resolveAttachmentUrl(attachment: MessageAttachment): string {
  const filename = attachment.url.split('/').pop();
  return `${UPLOADS_BASE_URL}/${filename}`;
}

/** Thrown by uploads when the server answers HTTP 429 (`{error:'rate_limited', retryAfterMs}` + Retry-After). */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`You are doing that too fast. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

export async function uploadFile(accessToken: string, file: File): Promise<MessageAttachment> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(UPLOADS_BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const header = Number(res.headers.get('Retry-After'));
    const retryAfterMs =
      typeof body?.retryAfterMs === 'number' ? body.retryAfterMs : Number.isFinite(header) && header > 0 ? header * 1000 : 5000;
    throw new RateLimitedError(retryAfterMs);
  }
  const body = await parseJsonOrThrow(res);
  return body.attachment;
}

// ---------------------------------------------------------------------------
// Authenticated JSON helper used by the live-stream features. Unlike
// parseJsonOrThrow it preserves the HTTP status and the machine-readable
// `error` code (and the whole body) so callers can branch on e.g.
// `already_live` / `not_eligible` / `guidelines_not_accepted`.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, message: string, body: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const FRIENDLY_ERRORS: Record<string, string> = {
  stream_not_found: 'This stream could not be found.',
  stream_already_ended: 'This stream has already ended.',
  stream_ended: 'This stream has ended.',
  forbidden: 'You do not have permission to do that.',
  internal_error: 'Something went wrong on our side. Please try again.',
  user_not_found: 'That user no longer exists.',
  channel_not_found: "This channel doesn't exist, or you don't have access to it.",
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
  invite_expired: 'This invite link has expired.',
  invite_revoked: 'This invite link was revoked.',
  invite_exhausted: 'This invite link has reached its maximum number of uses.',
  rate_limited: 'You are doing that too fast. Please wait a moment.',
  invalid_token: 'Your session has expired. Please sign in again.',
  missing_token: 'Your session has expired. Please sign in again.',
};

export async function apiRequest<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.', {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    const message =
      (typeof json.message === 'string' && json.message) ||
      FRIENDLY_ERRORS[code] ||
      `Request failed (${res.status}).`;
    throw new ApiError(res.status, code, message, json);
  }
  return json as T;
}
