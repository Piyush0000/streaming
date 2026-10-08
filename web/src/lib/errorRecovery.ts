/**
 * Pure helpers behind ErrorBoundary / chunk-load recovery. No React, no DOM
 * beyond an injected key-value store, so they are unit-testable under node.
 */

export const AUTO_RECOVER_WINDOW_MS = 5_000;
export const CHUNK_RELOAD_MIN_GAP_MS = 60_000;

const LOGIN_RECOVERY_KEY = 'streaming.errRecovery.login';
const CHUNK_RELOAD_KEY = 'streaming.errRecovery.chunkReload';

export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** sessionStorage, or an in-memory fallback when storage is blocked (private mode, sandboxed iframes). */
const memory = new Map<string, string>();
export function defaultStore(): KVStore {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.getItem('__probe__');
      return sessionStorage;
    }
  } catch {
    /* fall through */
  }
  return { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };
}

function safeGet(store: KVStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(store: KVStore, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** True for the errors a stale deploy produces when a lazy route chunk is gone (nginx answers the missing .js with index.html). */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'ChunkLoadError') return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [^\s]+ failed|Loading CSS chunk [^\s]+ failed|Unable to preload CSS/i.test(msg);
}

/**
 * Login-transition auto recovery: an error caught within `windowMs` of a session
 * change is retried exactly once per session change instead of showing the card.
 * Returns true (and records it) when the caller should silently reset the boundary.
 */
export function shouldAutoRecoverLogin(opts: {
  now: number;
  sessionChangedAt: number | null;
  store?: KVStore;
  windowMs?: number;
}): boolean {
  const { now, sessionChangedAt } = opts;
  if (sessionChangedAt === null) return false;
  const age = now - sessionChangedAt;
  if (age < 0 || age > (opts.windowMs ?? AUTO_RECOVER_WINDOW_MS)) return false;
  const store = opts.store ?? defaultStore();
  if (safeGet(store, LOGIN_RECOVERY_KEY) === String(sessionChangedAt)) return false;
  // If we cannot persist the guard, refuse: better to show the card than to loop.
  return safeSet(store, LOGIN_RECOVERY_KEY, String(sessionChangedAt));
}

/** Allows at most one hard reload per `minGapMs`; records the attempt. False means "already tried, show the card". */
export function allowGuardedReload(opts: { now: number; store?: KVStore; minGapMs?: number }): boolean {
  const store = opts.store ?? defaultStore();
  const last = Number(safeGet(store, CHUNK_RELOAD_KEY));
  const gap = opts.minGapMs ?? CHUNK_RELOAD_MIN_GAP_MS;
  if (Number.isFinite(last) && last > 0 && opts.now - last < gap) return false;
  return safeSet(store, CHUNK_RELOAD_KEY, String(opts.now));
}

/** Reloads the page once if the guard allows it. Returns whether a reload was triggered. */
export function reloadOnceForChunkError(): boolean {
  if (typeof window === 'undefined') return false;
  if (!allowGuardedReload({ now: Date.now() })) return false;
  window.location.reload();
  return true;
}

export function resetKeysChanged(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  const a = prev ?? [];
  const b = next ?? [];
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return true;
  return false;
}
