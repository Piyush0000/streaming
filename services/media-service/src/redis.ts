import Redis from 'ioredis';
import { env } from './env';

// Used only for ephemeral presence pub/sub — never authoritative state.
// A media-service restart loses nothing that Postgres/other services need;
// active WebRTC rooms are naturally rebuilt as clients rejoin.
export const redis = new Redis(env.REDIS_URL);

// Dedicated subscriber connection for stream moderation / lifecycle events
// (a subscribed connection cannot publish or run other commands).
export const redisSub = new Redis(env.REDIS_URL);

export async function pingRedis(): Promise<void> {
  await redis.ping();
}

export const PRESENCE_CHANNEL = 'presence.voice';
