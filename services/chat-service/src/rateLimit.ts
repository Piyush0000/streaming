import { env } from './env';
import { logger } from './logger';
import { redisPub } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  /** How long until the window resets (0 when allowed). */
  retryAfterMs: number;
}

/** A Redis hiccup must never stall chat: give the counter this long, then fail open. */
const REDIS_TIMEOUT_MS = 750;

let lastErrorLogAt = 0;
let suppressedErrors = 0;

function logFailOpen(err: unknown, key: string) {
  const now = Date.now();
  if (now - lastErrorLogAt < 5000) {
    suppressedErrors++;
    return;
  }
  logger.error(
    { err, key, suppressedSinceLastLog: suppressedErrors },
    'RATE LIMITING DISABLED: Redis counter failed; failing OPEN (requests are being allowed unthrottled)'
  );
  lastErrorLogAt = now;
  suppressedErrors = 0;
}

/**
 * Fixed-window counter in Redis: INCR the key, set its TTL on the first hit
 * of a window. Over the limit -> not allowed until the key expires.
 * Fails OPEN (allowed) with a loud error log if Redis errors or is slow.
 */
export async function hitRateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  try {
    const work = (async () => {
      const results = await redisPub.multi().incr(key).pttl(key).exec();
      if (!results) throw new Error('redis multi returned null');
      const [[incrErr, count], [pttlErr, pttl]] = results as [[Error | null, number], [Error | null, number]];
      if (incrErr) throw incrErr;
      if (pttlErr) throw pttlErr;
      let ttl = pttl;
      if (ttl < 0) {
        // First hit of the window (or a key that lost its TTL): (re)arm the expiry.
        await redisPub.pexpire(key, windowSec * 1000);
        ttl = windowSec * 1000;
      }
      return { count, ttl };
    })();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`redis rate-limit call timed out after ${REDIS_TIMEOUT_MS}ms`)), REDIS_TIMEOUT_MS);
    });
    // Avoid an unhandled rejection if the slow call fails after we gave up.
    work.catch(() => undefined);
    const { count, ttl } = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
    if (count > limit) return { allowed: false, retryAfterMs: Math.max(ttl, 1) };
    return { allowed: true, retryAfterMs: 0 };
  } catch (err) {
    logFailOpen(err, key);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export function checkChatRateLimit(userId: string): Promise<RateLimitResult> {
  return hitRateLimit(`rl:chat:${userId}`, env.CHAT_RATE_LIMIT_MESSAGES, env.CHAT_RATE_LIMIT_WINDOW_SEC);
}

export function checkUploadRateLimit(userId: string): Promise<RateLimitResult> {
  return hitRateLimit(`rl:upload:${userId}`, env.UPLOAD_RATE_LIMIT_PER_MINUTE, 60);
}
