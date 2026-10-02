import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

// Publish-only connection for stream pub/sub events (best-effort acceleration;
// Postgres + the internal access endpoint remain authoritative).
export const redisPub = new Redis(env.REDIS_URL);
redisPub.on('error', (err) => logger.error({ err }, 'redis connection error'));

export async function pingRedis(): Promise<void> {
  await redisPub.ping();
}
