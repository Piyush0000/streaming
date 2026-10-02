import type { ChannelAccess } from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';

const LOOKUP_TIMEOUT_MS = 2500;
const END_TIMEOUT_MS = 5000;

export type AccessLookup =
  | { status: 'ok'; access: ChannelAccess }
  | { status: 'not_found' }
  | { status: 'unreachable' };

/**
 * channelId -> "is a stream?" learned from earlier successful lookups. Only
 * used as a fallback when api-service is unreachable: a channel previously
 * confirmed as a plain voice channel keeps working; anything unknown or
 * stream-like fails closed.
 */
const knownIsStream = new Map<string, boolean>();

export function knownNotStream(channelId: string): boolean {
  return knownIsStream.get(channelId) === false;
}

export async function lookupAccess(channelId: string, userId: string, email: string): Promise<AccessLookup> {
  const url = new URL(
    `/internal/channels/${encodeURIComponent(channelId)}/access`,
    env.API_SERVICE_INTERNAL_URL
  );
  url.searchParams.set('userId', userId);
  url.searchParams.set('email', email);
  try {
    const res = await fetch(url, {
      headers: { 'x-internal-secret': env.INTERNAL_API_SECRET },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) throw new Error(`api-service responded ${res.status}`);
    const access = (await res.json()) as ChannelAccess;
    knownIsStream.set(channelId, access.isStream);
    return { status: 'ok', access };
  } catch (err) {
    logger.warn({ err, channelId }, 'api-service access lookup failed');
    return { status: 'unreachable' };
  }
}

/** Asks api-service to end a stream (host-absent timeout). Returns true if ended / already ended. */
export async function endStreamViaApi(streamId: string): Promise<boolean> {
  const url = new URL(`/internal/streams/${encodeURIComponent(streamId)}/end`, env.API_SERVICE_INTERNAL_URL);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-secret': env.INTERNAL_API_SECRET },
      signal: AbortSignal.timeout(END_TIMEOUT_MS),
    });
    if (res.ok || res.status === 409 || res.status === 404) return true; // ended now / already ended / gone
    logger.error({ streamId, status: res.status }, 'api-service refused to end stream');
    return false;
  } catch (err) {
    logger.error({ err, streamId }, 'failed to call api-service to end stream');
    return false;
  }
}
