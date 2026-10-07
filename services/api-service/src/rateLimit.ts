import { logger } from './logger';
import { redisPub } from './redis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

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

/** Fixed-window Redis counter. Fails OPEN with a loud error log (same policy as chat-service). */
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
        await redisPub.pexpire(key, windowSec * 1000);
        ttl = windowSec * 1000;
      }
      return { count, ttl };
    })();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`redis rate-limit call timed out after ${REDIS_TIMEOUT_MS}ms`)), REDIS_TIMEOUT_MS);
    });
    work.catch(() => undefined);
    const { count, ttl } = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
    if (count > limit) return { allowed: false, retryAfterMs: Math.max(ttl, 1) };
    return { allowed: true, retryAfterMs: 0 };
  } catch (err) {
    logFailOpen(err, key);
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** Express helper: per-IP fixed-window limit (X-Real-IP set by the gateway). Sends the 429 itself; returns false when blocked. */
export async function allowIp(
  req: import('express').Request,
  res: import('express').Response,
  scope: string,
  limit: number,
  windowSec = 60
): Promise<boolean> {
  const hdr = req.headers['x-real-ip'];
  const ip = (typeof hdr === 'string' && hdr) || req.ip || 'unknown';
  const rl = await hitRateLimit(`rl:${scope}:${ip}`, limit, windowSec);
  if (rl.allowed) return true;
  const sec = Math.ceil(rl.retryAfterMs / 1000);
  res.setHeader('Retry-After', String(sec));
  res.status(429).json({ error: 'rate_limited', message: `Too many requests. Try again in ${sec}s.`, retryAfterMs: rl.retryAfterMs });
  return false;
}
