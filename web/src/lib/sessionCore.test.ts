import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRefreshDelay,
  createSessionManager,
  decodeJwtPayload,
  estimateClockSkewMs,
  isTokenFresh,
  refreshRetryDelayMs,
  SESSION_STORAGE_KEY,
  tokenExpiryMs,
  type RefreshOutcome,
  type Session,
  type StorageLike,
} from './sessionCore';

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
const user = { id: 'u1', username: 'a', email: 'a@b.c' };
function sess(access: string, refresh = 'r1'): Session {
  return { user, accessToken: access, refreshToken: refresh };
}

test('decodeJwtPayload handles valid, malformed and non-string input', () => {
  assert.deepEqual(decodeJwtPayload(jwt({ exp: 100, iat: 10, x: 1 })), { exp: 100, iat: 10 });
  assert.equal(decodeJwtPayload('abc'), null);
  assert.equal(decodeJwtPayload('a.!!!.c'), null);
  assert.equal(decodeJwtPayload(undefined), null);
  assert.equal(tokenExpiryMs(jwt({ exp: 100 })), 100_000);
  assert.equal(tokenExpiryMs(jwt({ sub: 'x' })), null);
});

test('computeRefreshDelay: 60s before expiry, never negative, lead capped for short TTLs', () => {
  const exp = 1_000_000 + 15 * 60_000;
  assert.equal(computeRefreshDelay({ expMs: exp, iatMs: 1_000_000, now: 1_000_000 }), 14 * 60_000);
  assert.equal(computeRefreshDelay({ expMs: exp, now: exp + 5000 }), 0);
  // 20s token -> lead 5s, not 60s
  assert.equal(computeRefreshDelay({ expMs: 20_000, iatMs: 0, now: 0 }), 15_000);
});

test('computeRefreshDelay honours clock skew (client ahead pushes the deadline later)', () => {
  const exp = 900_000;
  assert.equal(computeRefreshDelay({ expMs: exp, now: 0, skewMs: 0 }), 840_000);
  assert.equal(computeRefreshDelay({ expMs: exp, now: 0, skewMs: 3_600_000 }), 840_000 + 3_600_000);
  assert.equal(computeRefreshDelay({ expMs: exp, now: 0, skewMs: -840_000 }), 0);
});

test('estimateClockSkewMs ignores latency-sized and absurd differences', () => {
  const t = jwt({ iat: 1000 });
  assert.equal(estimateClockSkewMs(t, 1_001_500), 0);
  assert.equal(estimateClockSkewMs(t, 1_000_000 + 60_000), 60_000);
  assert.equal(estimateClockSkewMs(t, 1_000_000 + 30 * 24 * 3600_000), 0);
});

test('isTokenFresh and retry backoff', () => {
  const t = jwt({ exp: 100 });
  assert.equal(isTokenFresh(t, 99_000, 0, 0), true);
  assert.equal(isTokenFresh(t, 99_000, 0, 5_000), false);
  assert.equal(isTokenFresh('opaque', 1e12), true);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(refreshRetryDelayMs), [5000, 10000, 20000, 40000, 60000, 60000]);
});

function setup(opts: { refresh: (rt: string) => Promise<RefreshOutcome>; storage?: ReturnType<typeof memStorage>; now?: () => number }) {
  const storage = opts.storage ?? memStorage();
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  const m = createSessionManager({
    storage,
    refresh: opts.refresh,
    now: opts.now ?? (() => 1_000_000),
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, id: ++id });
      return id;
    },
    clearTimer: (x) => {
      const i = timers.findIndex((t) => t.id === x);
      if (i >= 0) timers.splice(i, 1);
    },
    locks: { request: (_n, cb) => cb() },
  });
  return { m, storage, timers };
}

test('refreshNow is single-flight and persists the rotated pair', async () => {
  let calls = 0;
  const newAccess = jwt({ exp: 2000, iat: 1000 });
  const { m, storage } = setup({
    refresh: async (rt) => {
      calls++;
      assert.equal(rt, 'r1');
      await new Promise((r) => setTimeout(r, 10));
      return { kind: 'ok', accessToken: newAccess, refreshToken: 'r2' };
    },
  });
  m.setSession(sess(jwt({ exp: 1000, iat: 100 })));
  const seen: (string | undefined)[] = [];
  m.subscribe((s) => seen.push(s?.accessToken));
  const results = await Promise.all([m.refreshNow(), m.refreshNow(), m.refreshNow()]);
  assert.equal(calls, 1);
  assert.deepEqual(results, [newAccess, newAccess, newAccess]);
  assert.equal(JSON.parse(storage.map.get(SESSION_STORAGE_KEY)!).refreshToken, 'r2');
  assert.equal(m.getAccessToken(), newAccess);
  assert.ok(seen.includes(newAccess));
});

test('a caller with a stale token adopts the already-rotated session without hitting the server', async () => {
  let calls = 0;
  const fresh = jwt({ exp: 5000, iat: 1000 });
  const { m } = setup({
    refresh: async () => {
      calls++;
      return { kind: 'transient' };
    },
  });
  m.setSession(sess(fresh, 'r2'));
  const tok = await m.refreshNow({ staleAccessToken: 'old-token' });
  assert.equal(tok, fresh);
  assert.equal(calls, 0);
});

test('another tab rotating the token while we wait for the lock is adopted', async () => {
  let calls = 0;
  const storage = memStorage();
  const tabB = jwt({ exp: 5000, iat: 1000 });
  const { m } = setup({ storage, refresh: async () => (calls++, { kind: 'transient' }) });
  const old = jwt({ exp: 1100, iat: 100 });
  m.setSession(sess(old));
  // tab B writes new tokens to storage (no storage event delivered yet)
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sess(tabB, 'rB')));
  const tok = await m.refreshNow({ staleAccessToken: old });
  assert.equal(tok, tabB);
  assert.equal(calls, 0);
});

test('transient failure keeps the session and does not fire session-lost', async () => {
  const { m, storage } = setup({ refresh: async () => ({ kind: 'transient' }) });
  m.setSession(sess(jwt({ exp: 1000, iat: 100 })));
  let lost = 0;
  m.onSessionLost(() => lost++);
  assert.equal(await m.refreshNow(), null);
  assert.equal(lost, 0);
  assert.ok(m.getSession());
  assert.ok(storage.map.get(SESSION_STORAGE_KEY));
});

test('definitive invalid refresh fires session-lost exactly once and clears storage', async () => {
  const { m, storage } = setup({ refresh: async () => ({ kind: 'invalid' }) });
  m.setSession(sess(jwt({ exp: 1000, iat: 100 })));
  let lost = 0;
  m.onSessionLost(() => lost++);
  await m.refreshNow();
  await m.refreshNow();
  assert.equal(lost, 1);
  assert.equal(m.getSession(), null);
  assert.equal(storage.map.has(SESSION_STORAGE_KEY), false);
});

test('invalid because a lock-less tab rotated first: retries with the stored token instead of logging out', async () => {
  const storage = memStorage();
  const good = jwt({ exp: 9999, iat: 1000 });
  const { m } = setup({
    storage,
    refresh: async (rt) => {
      if (rt === 'r1') {
        storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sess(jwt({ exp: 1000, iat: 100 }), 'r2')));
        return { kind: 'invalid' };
      }
      return { kind: 'ok', accessToken: good, refreshToken: 'r3' };
    },
  });
  const old = jwt({ exp: 1000, iat: 100 });
  m.setSession(sess(old));
  let lost = 0;
  m.onSessionLost(() => lost++);
  const tok = await m.refreshNow({ staleAccessToken: old });
  assert.equal(lost, 0);
  assert.equal(tok, good);
});

test('proactive timer is armed ~60s before exp and explicit logout does not fire session-lost', () => {
  const now = 1_000_000;
  const { m, timers } = setup({ refresh: async () => ({ kind: 'transient' }) });
  m.setSession(sess(jwt({ exp: now / 1000 + 900, iat: now / 1000 })));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5 * 60_000); // capped re-evaluation interval; real delay is 14 min
  assert.equal(m._msUntilRefresh(), 14 * 60_000);
  let lost = 0;
  m.onSessionLost(() => lost++);
  m.clear();
  assert.equal(lost, 0);
  assert.equal(timers.length, 0);
});

test('ensureFresh refreshes an expired token first, and falls back to the old one on transient failure', async () => {
  const expired = jwt({ exp: 500, iat: 100 }); // expired at now=1000s
  const next = jwt({ exp: 5000, iat: 1000 });
  let ok = false;
  const { m } = setup({
    refresh: async () => (ok ? { kind: 'ok', accessToken: next, refreshToken: 'r2' } : { kind: 'transient' }),
  });
  m.setSession(sess(expired), { fromNetwork: false });
  assert.equal(await m.ensureFresh(), expired);
  ok = true;
  assert.equal(await m.ensureFresh(), next);
});

test('storage unavailable: manager still works in memory', () => {
  const m = createSessionManager({ storage: null, refresh: async () => ({ kind: 'transient' }), locks: null });
  m.setSession(sess('opaque'));
  assert.equal(m.getAccessToken(), 'opaque');
  m.handleStorageEvent();
  assert.equal(m.getAccessToken(), 'opaque');
});

test('lease lock fallback (no Web Locks) serialises two managers on one storage', async () => {
  const storage = memStorage();
  let active = 0;
  let maxActive = 0;
  const mk = () =>
    createSessionManager({
      storage,
      locks: null,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
      refresh: async (rt) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        const t = Date.now() / 1000;
        return { kind: 'ok', accessToken: jwt({ exp: t + 900, iat: t, n: rt }), refreshToken: 'n-' + rt };
      },
    });
  const a = mk();
  const b = mk();
  const old = jwt({ exp: 1, iat: 0 });
  a.setSession(sess(old));
  b.handleStorageEvent();
  await Promise.all([a.refreshNow({ staleAccessToken: old }), b.refreshNow({ staleAccessToken: old })]);
  assert.equal(maxActive, 1);
});
