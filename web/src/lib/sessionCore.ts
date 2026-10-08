/**
 * Pure session logic (no DOM / import.meta access) so it can be unit tested under node.
 * The browser singleton lives in ./sessionManager.ts.
 *
 * Responsibilities:
 *  - single source of truth for the persisted session (localStorage 'streaming.session')
 *  - JWT exp decoding + refresh scheduling (~60s before expiry, clock-skew aware)
 *  - single-flight refresh in this tab, cross-tab coordination via Web Locks or a
 *    localStorage lease (the server ROTATES refresh tokens and revokes the old one,
 *    so two tabs refreshing with the same token would log one of them out)
 *  - logging out ONLY on a definitive "refresh token is invalid" answer, never on
 *    transient network / 5xx failures.
 */

export const SESSION_STORAGE_KEY = 'streaming.session';
const LOCK_NAME = 'streaming.session.refresh';
const LOCK_STORAGE_KEY = 'streaming.session.refresh-lock';

export interface SessionUser {
  id: string;
  username: string;
  email: string;
}

export interface Session {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
}

export type RefreshOutcome =
  | { kind: 'ok'; accessToken: string; refreshToken: string }
  | { kind: 'invalid' }
  | { kind: 'transient' };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function base64UrlDecode(input: string): string | null {
  try {
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob === 'function') {
      const bin = atob(b64);
      // Handle UTF-8 payloads.
      let out = '';
      for (let i = 0; i < bin.length; i++) out += '%' + bin.charCodeAt(i).toString(16).padStart(2, '0');
      return decodeURIComponent(out);
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** Decodes (WITHOUT verifying) a JWT payload; null for anything malformed. */
export function decodeJwtPayload(token: unknown): { exp?: number; iat?: number } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const json = base64UrlDecode(parts[1]);
  if (!json) return null;
  try {
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== 'object') return null;
    const out: { exp?: number; iat?: number } = {};
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) out.exp = payload.exp;
    if (typeof payload.iat === 'number' && Number.isFinite(payload.iat)) out.iat = payload.iat;
    return out;
  } catch {
    return null;
  }
}

/** `exp` in epoch milliseconds, or null when the token has none / is malformed. */
export function tokenExpiryMs(token: unknown): number | null {
  const p = decodeJwtPayload(token);
  return p?.exp !== undefined ? p.exp * 1000 : null;
}

/** `iat` in epoch milliseconds, or null. */
export function tokenIssuedAtMs(token: unknown): number | null {
  const p = decodeJwtPayload(token);
  return p?.iat !== undefined ? p.iat * 1000 : null;
}

/**
 * Estimates (client clock - server clock) in ms from a token we just received:
 * the server minted it "just now", so iat ~ server time. Distrusts absurd values.
 */
export function estimateClockSkewMs(token: unknown, now: number): number {
  const iat = tokenIssuedAtMs(token);
  if (iat === null) return 0;
  const skew = now - iat;
  if (Math.abs(skew) < 3000) return 0; // network latency + 1s iat resolution, not skew
  if (Math.abs(skew) > 7 * 24 * 3600 * 1000) return 0; // nonsense
  return skew;
}

export const DEFAULT_REFRESH_LEAD_MS = 60_000;

/**
 * Milliseconds from `now` until the access token should be refreshed
 * (0 = refresh immediately). Refresh happens `lead` ms before the (skew-corrected)
 * expiry, where lead is capped at a quarter of the token lifetime so very short
 * TTLs don't make us refresh in a hot loop.
 */
export function computeRefreshDelay(opts: {
  expMs: number;
  iatMs?: number | null;
  now: number;
  skewMs?: number;
  leadMs?: number;
}): number {
  const skew = opts.skewMs ?? 0;
  let lead = opts.leadMs ?? DEFAULT_REFRESH_LEAD_MS;
  if (opts.iatMs != null && opts.expMs > opts.iatMs) {
    lead = Math.min(lead, (opts.expMs - opts.iatMs) / 4);
  }
  const expLocal = opts.expMs + skew;
  return Math.max(0, expLocal - lead - opts.now);
}

/** True while the access token is still valid for at least `marginMs` (unknown exp = treat as fresh). */
export function isTokenFresh(token: string, now: number, skewMs = 0, marginMs = 0): boolean {
  const exp = tokenExpiryMs(token);
  if (exp === null) return true;
  return exp + skewMs - marginMs > now;
}

/** Backoff for transient refresh failures: 5s, 10s, 20s, 40s, 60s... */
export function refreshRetryDelayMs(failures: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.max(0, failures - 1));
}

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s && typeof s === 'object' && typeof s.accessToken === 'string' && typeof s.refreshToken === 'string' && s.user) {
      return s as Session;
    }
  } catch {
    /* malformed */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export interface SessionManagerDeps {
  storage: StorageLike | null;
  refresh: (refreshToken: string) => Promise<RefreshOutcome>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  locks?: LockManagerLike | null;
  /** Wait helper for the localStorage-lease fallback (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  leadMs?: number;
}

export interface RefreshRequest {
  /** The access token the caller just got rejected with (or used). If the session already holds a different, fresh one, just adopt it. */
  staleAccessToken?: string | null;
}

export type SessionListener = (session: Session | null) => void;

const MAX_TIMER_MS = 5 * 60_000; // re-evaluate at least every 5 min (sleep / throttled timers)

export function createSessionManager(deps: SessionManagerDeps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms) as unknown as { unref?: () => void };
      t.unref?.(); // never keep a node process alive just for the refresh timer
      return t;
    });
  const clearTimer = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const leadMs = deps.leadMs ?? DEFAULT_REFRESH_LEAD_MS;
  const tabId = Math.random().toString(36).slice(2);

  let session: Session | null = null;
  let loaded = false;
  let skewMs = 0;
  let timer: unknown = null;
  let inflight: Promise<string | null> | null = null;
  let failures = 0;
  let lostFired = false;
  let storageOk = true; // false once a write failed: storage can't be trusted as the source of truth
  const listeners = new Set<SessionListener>();
  const lostListeners = new Set<() => void>();

  function readStorage(): Session | null {
    try {
      return parseSession(deps.storage?.getItem(SESSION_STORAGE_KEY) ?? null);
    } catch {
      return null;
    }
  }

  function writeStorage(next: Session | null) {
    try {
      if (!deps.storage) return;
      if (next) deps.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
      else deps.storage.removeItem(SESSION_STORAGE_KEY);
      storageOk = true;
    } catch {
      storageOk = false;
      /* private mode / quota: the in-memory copy still works for this tab */
    }
  }

  function ensureLoaded() {
    if (!loaded) {
      loaded = true;
      session = readStorage();
    }
  }

  function emit() {
    for (const l of [...listeners]) {
      try {
        l(session);
      } catch {
        /* a bad listener must not break the others */
      }
    }
  }

  function sameSession(a: Session | null, b: Session | null) {
    return a === b || (!!a && !!b && a.accessToken === b.accessToken && a.refreshToken === b.refreshToken && a.user?.id === b.user?.id);
  }

  /** Re-reads storage (another tab may have rotated tokens). Emits if it changed. */
  function reloadFromStorage(): boolean {
    ensureLoaded();
    if (!deps.storage || !storageOk) return false;
    const stored = readStorage();
    if (sameSession(stored, session)) return false;
    session = stored;
    if (stored) lostFired = false;
    schedule();
    emit();
    return true;
  }

  function clearScheduled() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function msUntilRefresh(): number | null {
    if (!session) return null;
    const expMs = tokenExpiryMs(session.accessToken);
    if (expMs === null) return null;
    return computeRefreshDelay({
      expMs,
      iatMs: tokenIssuedAtMs(session.accessToken),
      now: now(),
      skewMs,
      leadMs,
    });
  }

  function schedule(delayOverride?: number) {
    clearScheduled();
    if (!session) return;
    const delay = delayOverride ?? msUntilRefresh();
    if (delay === null) return;
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, Math.min(Math.max(delay, 0), MAX_TIMER_MS));
  }

  /** Refreshes if due (called by the timer and on visibility / online / focus). */
  async function tick(): Promise<void> {
    ensureLoaded();
    reloadFromStorage();
    if (!session) return;
    const delay = msUntilRefresh();
    if (delay === null) return;
    if (delay <= 0) {
      const tok = await refreshNow({ staleAccessToken: session.accessToken });
      if (tok === null && session) schedule(refreshRetryDelayMs(Math.max(1, failures)));
    } else {
      schedule();
    }
  }

  function handleLost() {
    if (lostFired) return;
    lostFired = true;
    clearScheduled();
    session = null;
    writeStorage(null);
    emit();
    for (const l of [...lostListeners]) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  // ---- lock ---------------------------------------------------------------

  async function withLease<T>(fn: () => Promise<T>): Promise<T> {
    const storage = deps.storage;
    if (!storage) return fn();
    const owner = `${tabId}:${Math.random().toString(36).slice(2)}`;
    const ttl = 20_000;
    const deadline = now() + 12_000;
    let held = false;
    while (now() < deadline) {
      try {
        const cur = storage.getItem(LOCK_STORAGE_KEY);
        let free = !cur;
        if (cur) {
          const [, expiry] = cur.split('|');
          free = !(Number(expiry) > now());
        }
        if (free) {
          storage.setItem(LOCK_STORAGE_KEY, `${owner}|${now() + ttl}`);
          await sleep(25); // let a racing tab overwrite us, then confirm
          if (storage.getItem(LOCK_STORAGE_KEY)?.startsWith(`${owner}|`)) {
            held = true;
            break;
          }
        }
      } catch {
        break; // storage broken: proceed unlocked
      }
      await sleep(100);
    }
    try {
      return await fn();
    } finally {
      if (held) {
        try {
          if (storage.getItem(LOCK_STORAGE_KEY)?.startsWith(`${owner}|`)) storage.removeItem(LOCK_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
    if (deps.locks) return deps.locks.request(LOCK_NAME, fn);
    return withLease(fn);
  }

  // ---- public API -----------------------------------------------------------

  function getSession(): Session | null {
    ensureLoaded();
    return session;
  }

  function getAccessToken(): string | null {
    return getSession()?.accessToken ?? null;
  }

  function setSession(next: Session | null, opts: { fromNetwork?: boolean } = {}) {
    ensureLoaded();
    session = next;
    if (next) {
      lostFired = false;
      failures = 0;
      if (opts.fromNetwork !== false) skewMs = estimateClockSkewMs(next.accessToken, now());
    }
    writeStorage(next);
    schedule();
    emit();
  }

  function updateTokens(tokens: { accessToken: string; refreshToken: string }) {
    ensureLoaded();
    if (!session) return;
    setSession({ ...session, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  }

  /** Explicit user logout / clear: no "lost" toast. */
  function clear() {
    ensureLoaded();
    clearScheduled();
    session = null;
    lostFired = false;
    writeStorage(null);
    emit();
  }

  function subscribe(l: SessionListener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  }

  function onSessionLost(l: () => void): () => void {
    lostListeners.add(l);
    return () => lostListeners.delete(l);
  }

  async function doRefresh(req: RefreshRequest): Promise<string | null> {
    ensureLoaded();
    if (!session) return null;
    const stale = req.staleAccessToken ?? session.accessToken;
    try {
      return await withCrossTabLock(async () => {
        // Another tab may have refreshed while we waited for the lock.
        reloadFromStorage();
        if (!session) return null;
        if (session.accessToken !== stale && isTokenFresh(session.accessToken, now(), skewMs, 5_000)) {
          failures = 0;
          return session.accessToken;
        }
        let used = session.refreshToken;
        for (let attempt = 0; attempt < 2; attempt++) {
          let outcome: RefreshOutcome;
          try {
            outcome = await deps.refresh(used);
          } catch {
            outcome = { kind: 'transient' };
          }
          if (outcome.kind === 'ok') {
            failures = 0;
            const cur = session ?? readStorage();
            if (!cur) return null; // logged out meanwhile
            setSession({ ...cur, accessToken: outcome.accessToken, refreshToken: outcome.refreshToken });
            return outcome.accessToken;
          }
          if (outcome.kind === 'transient') {
            failures += 1;
            return null;
          }
          // Definitive invalid: maybe a tab without lock support rotated it under us.
          const stored = readStorage();
          if (stored && stored.refreshToken !== used) {
            session = stored;
            used = stored.refreshToken;
            if (isTokenFresh(stored.accessToken, now(), skewMs, 5_000) && stored.accessToken !== stale) {
              schedule();
              emit();
              return stored.accessToken;
            }
            continue;
          }
          if (!stored && deps.storage) {
            // Another tab already signed out / lost the session: follow it silently.
            reloadFromStorage();
            return null;
          }
          handleLost();
          return null;
        }
        return null;
      });
    } catch {
      failures += 1;
      return null;
    }
  }

  /**
   * Refreshes the tokens (single flight). Resolves to the new access token, or
   * null when it could not be refreshed (transient failure: session kept; or
   * definitive failure: session lost and listeners notified).
   */
  function refreshNow(req: RefreshRequest = {}): Promise<string | null> {
    if (inflight) return inflight;
    const p = doRefresh(req).finally(() => {
      if (inflight === p) inflight = null;
      if (session && timer === null) schedule(failures > 0 ? refreshRetryDelayMs(failures) : undefined);
    });
    inflight = p;
    return p;
  }

  /** Returns a token that is valid for at least `marginMs`, refreshing first when needed. */
  async function ensureFresh(marginMs = 15_000): Promise<string | null> {
    ensureLoaded();
    if (!session) return null;
    if (isTokenFresh(session.accessToken, now(), skewMs, marginMs)) return session.accessToken;
    const refreshed = await refreshNow({ staleAccessToken: session.accessToken });
    // On transient failure fall back to the current token: it may still be accepted.
    return refreshed ?? session?.accessToken ?? null;
  }

  /** Call from a `storage` event for SESSION_STORAGE_KEY (other tab changed tokens). */
  function handleStorageEvent() {
    reloadFromStorage();
  }

  /** Call on visibilitychange(visible) / online / focus / pageshow. */
  function wake() {
    void tick();
  }

  return {
    getSession,
    getAccessToken,
    setSession,
    updateTokens,
    clear,
    subscribe,
    onSessionLost,
    refreshNow,
    ensureFresh,
    handleStorageEvent,
    wake,
    /** test hooks */
    _msUntilRefresh: msUntilRefresh,
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
