import crypto from 'crypto';
import { env } from './env';
import { logger } from './logger';
import type { StreamBridgeStatus } from '@streaming/shared-types';

/**
 * Client for the Elonix (LR21) "is this email premium?" bridge.
 *
 * Contract: POST ${LR21_BRIDGE_URL}, raw JSON body {"email":"<lowercased>"},
 * header X-Internal-Signature: hex(HMAC-SHA256(rawBody, LR21_BRIDGE_SECRET)).
 * Expected response: { ok: true, known: boolean, premium: boolean }.
 *
 * Never throws into the request path. On timeout / non-2xx / malformed
 * response it reports { premium: false, bridge: 'unavailable' } — premium is
 * NEVER granted on failure. Successful lookups are cached 60s per email;
 * failures are not cached (so a recovered bridge is picked up immediately).
 */

const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5000;

export interface PremiumLookup {
  premium: boolean;
  bridge: StreamBridgeStatus;
}

const cache = new Map<string, { value: PremiumLookup; expiresAt: number }>();

export function bridgeConfigured(): boolean {
  return Boolean(env.LR21_BRIDGE_URL && env.LR21_BRIDGE_SECRET);
}

export async function checkPremium(rawEmail: string): Promise<PremiumLookup> {
  if (!env.LR21_BRIDGE_URL || !env.LR21_BRIDGE_SECRET) {
    return { premium: false, bridge: 'not_configured' };
  }

  const email = rawEmail.trim().toLowerCase();
  const hit = cache.get(email);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const body = JSON.stringify({ email });
  const signature = crypto.createHmac('sha256', env.LR21_BRIDGE_SECRET).update(body).digest('hex');

  try {
    const res = await fetch(env.LR21_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Signature': signature },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'lr21 bridge returned non-2xx');
      return { premium: false, bridge: 'unavailable' };
    }
    const json = (await res.json()) as { ok?: unknown; known?: unknown; premium?: unknown };
    if (json?.ok !== true || typeof json.premium !== 'boolean') {
      logger.warn('lr21 bridge returned unexpected payload');
      return { premium: false, bridge: 'unavailable' };
    }
    const value: PremiumLookup = { premium: json.premium === true, bridge: 'ok' };
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(email, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    logger.warn({ err }, 'lr21 bridge call failed; treating as not premium');
    return { premium: false, bridge: 'unavailable' };
  }
}
