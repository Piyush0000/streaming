import type { Channel } from '@streaming/shared-types';

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL ?? '/api/auth';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

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
    throw new Error(body?.error ?? `request failed with status ${res.status}`);
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
