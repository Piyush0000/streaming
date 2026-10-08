import type { Channel, MessageAttachment } from '@streaming/shared-types';
import type { RefreshOutcome } from './sessionCore';
import { rateLimitMessage, SHARED_ERRORS } from './errorMessages';

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

/**
 * Refresh used by the session manager. Distinguishes a DEFINITIVE rejection
 * (401/400/403: the refresh token is expired, revoked or unknown) from a
 * transient failure (offline, timeout, 5xx, 429), so a flaky network never
 * signs the user out.
 */
export async function requestRefresh(refreshToken: string): Promise<RefreshOutcome> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 30_000) : null;
  try {
    const res = await fetch(`${AUTH_BASE_URL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: controller?.signal,
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) return { kind: 'invalid' };
    if (!res.ok) return { kind: 'transient' };
    const body = (await res.json().catch(() => null)) as { accessToken?: unknown; refreshToken?: unknown } | null;
    if (body && typeof body.accessToken === 'string' && typeof body.refreshToken === 'string') {
      return { kind: 'ok', accessToken: body.accessToken, refreshToken: body.refreshToken };
    }
    return { kind: 'transient' };
  } catch {
    return { kind: 'transient' };
  } finally {
    if (timer) clearTimeout(timer);
  }
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

const FRIENDLY_ERRORS: Record<string, string> = SHARED_ERRORS;

export async function apiRequest<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', SHARED_ERRORS.network_error, {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    const retryAfterMs = typeof json.retryAfterMs === 'number' ? json.retryAfterMs : undefined;
    const message =
      (code === 'rate_limited' && retryAfterMs ? rateLimitMessage(retryAfterMs) : '') ||
      (typeof json.message === 'string' && json.message) ||
      FRIENDLY_ERRORS[code] ||
      (res.status >= 500 ? SHARED_ERRORS.service_unavailable : `Request failed (${res.status}).`);
    throw new ApiError(res.status, code, message, json);
  }
  return json as T;
}
