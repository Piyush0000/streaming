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

export async function uploadFile(accessToken: string, file: File): Promise<MessageAttachment> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(UPLOADS_BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await parseJsonOrThrow(res);
  return body.attachment;
}

export async function createChannel(
  accessToken: string,
  name: string,
  topic: string,
  kind: Channel['kind'] = 'text'
): Promise<Channel> {
  const res = await fetch(`${API_BASE_URL}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ name, topic: topic || undefined, kind }),
  });
  const body = await parseJsonOrThrow(res);
  return body.channel;
}
