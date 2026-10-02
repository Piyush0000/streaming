import type { ChannelAccess } from '@streaming/shared-types';
import { env } from './env';
import { logger } from './logger';
import { getChannelKindFromDb } from './db';

const LOOKUP_TIMEOUT_MS = 2500;

export type AccessLookup =
  | { status: 'ok'; access: ChannelAccess }
  /** api-service says the channel doesn't exist (chat keeps today's behaviour for it). */
  | { status: 'not_found' }
  /** api-service unreachable / errored. `isStream` is best-effort knowledge from the DB. */
  | { status: 'unreachable'; isStream: boolean | 'unknown' };

/**
 * Asks api-service (authoritative) what this user may do in a channel.
 * Never throws. When api-service can't be reached we try to find out whether
 * the channel is a stream straight from Postgres (shared DB) so that plain
 * text chat keeps working while stream chat fails closed.
 */
export async function lookupAccess(
  channelId: string,
  userId: string,
  email: string
): Promise<AccessLookup> {
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
    return { status: 'ok', access: (await res.json()) as ChannelAccess };
  } catch (err) {
    logger.warn({ err, channelId }, 'api-service access lookup failed');
  }

  try {
    const kind = await getChannelKindFromDb(channelId);
    return { status: 'unreachable', isStream: kind === undefined ? false : kind === 'stream' };
  } catch (err) {
    logger.warn({ err, channelId }, 'channel kind fallback lookup failed');
    return { status: 'unreachable', isStream: 'unknown' };
  }
}
