import Redis from 'ioredis';
import { env } from './env';

// Separate connections: one for ordinary commands (publish), one dedicated
// to the blocking XREADGROUP consume loop, one dedicated to pub/sub
// subscriptions (a subscribed connection can't issue other commands).
export const redisPub = new Redis(env.REDIS_URL);
export const redisConsume = new Redis(env.REDIS_URL);
export const redisSub = new Redis(env.REDIS_URL);

export async function pingRedis(): Promise<void> {
  await redisPub.ping();
}

export const CHAT_STREAM = 'chat.messages';
export const CHAT_CONSUMER_GROUP = 'chat-service';
