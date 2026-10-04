import { useEffect, useMemo, useReducer } from 'react';
import { useSession } from '../context/SessionContext';
import { fetchProfiles, type PublicProfile } from '../lib/profiles';

export type Profile = PublicProfile;

const TTL_MS = 5 * 60 * 1000;
/** After a failed or empty lookup, do not retry that id for a while (never hammer the API). */
const NEGATIVE_TTL_MS = 30 * 1000;
const BATCH_DELAY_MS = 25;
const MAX_BATCH = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Entry {
  profile: Profile | null; // null = known missing / failed lookup (negative cache)
  expires: number;
}

const cache = new Map<string, Entry>();
const inflight = new Set<string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let latestToken: string | null = null;

function notify() {
  for (const l of listeners) l();
}

function fresh(id: string): boolean {
  const e = cache.get(id);
  return !!e && e.expires > Date.now();
}

/** Seeds/overwrites the cache (e.g. after the user edits their own profile) and re-renders subscribers. */
export function primeProfile(profile: Profile): void {
  cache.set(profile.id, { profile, expires: Date.now() + TTL_MS });
  notify();
}

export function invalidateProfile(id: string): void {
  cache.delete(id);
  notify();
}

async function flush() {
  timer = null;
  const token = latestToken;
  const ids = Array.from(pending);
  pending.clear();
  if (!token || ids.length === 0) return;
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const chunk = ids.slice(i, i + MAX_BATCH);
    chunk.forEach((id) => inflight.add(id));
    try {
      const profiles = await fetchProfiles(token, chunk);
      const found = new Set<string>();
      for (const p of profiles) {
        found.add(p.id);
        cache.set(p.id, { profile: p, expires: Date.now() + TTL_MS });
      }
      for (const id of chunk) {
        if (!found.has(id)) cache.set(id, { profile: null, expires: Date.now() + NEGATIVE_TTL_MS });
      }
    } catch {
      // Never throw: callers fall back to the username they already have.
      for (const id of chunk) {
        const prev = cache.get(id);
        cache.set(id, { profile: prev?.profile ?? null, expires: Date.now() + NEGATIVE_TTL_MS });
      }
    } finally {
      chunk.forEach((id) => inflight.delete(id));
    }
    notify();
  }
}

function request(ids: string[], token: string) {
  latestToken = token;
  let queued = false;
  for (const id of ids) {
    if (fresh(id) || inflight.has(id) || pending.has(id)) continue;
    pending.add(id);
    queued = true;
  }
  if (queued && timer === null) timer = setTimeout(() => void flush(), BATCH_DELAY_MS);
}

/**
 * Batched, cached profile lookup. Returns a Map of the profiles known so far;
 * missing ids are simply absent (fall back to the username you already have).
 * Requests are deduped across components and batched (<= 50 ids per call).
 */
export function useProfiles(ids: string[]): Map<string, Profile> {
  const { session } = useSession();
  const token = session?.accessToken ?? null;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const key = useMemo(
    () => Array.from(new Set(ids.filter((id) => UUID_RE.test(id)))).sort().join(','),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(',')]
  );

  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (token && key) request(key.split(','), token);
  }, [key, token, version]);

  return useMemo(() => {
    const out = new Map<string, Profile>();
    if (!key) return out;
    for (const id of key.split(',')) {
      const e = cache.get(id);
      if (e?.profile) out.set(id, e.profile); // expired entries still render while revalidating
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}
