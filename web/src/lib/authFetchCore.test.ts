import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthFetch, shouldIntercept } from './authFetchCore';

const ORIGIN = 'http://app.test';

function mkManager(opts: { current?: string | null; refreshTo?: string | null } = {}) {
  const state = { token: opts.current === undefined ? 'T2' : opts.current, refreshCalls: 0 };
  return {
    state,
    manager: {
      getAccessToken: () => state.token,
      ensureFresh: async () => state.token,
      refreshNow: async () => {
        state.refreshCalls++;
        if (opts.refreshTo) state.token = opts.refreshTo;
        return opts.refreshTo ?? null;
      },
    },
  };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const authOf = (init?: RequestInit) => new Headers(init?.headers).get('Authorization');

test('shouldIntercept: same-origin /api only, never /api/auth', () => {
  assert.equal(shouldIntercept(new URL('/api/channels', ORIGIN), ORIGIN), true);
  assert.equal(shouldIntercept(new URL('/api/auth/refresh', ORIGIN), ORIGIN), false);
  assert.equal(shouldIntercept(new URL('/api/auth/google', ORIGIN), ORIGIN), false);
  assert.equal(shouldIntercept(new URL('/other', ORIGIN), ORIGIN), false);
  assert.equal(shouldIntercept(new URL('https://evil.test/api/x'), ORIGIN), false);
  // dev: services on other ports are intercepted only when configured as api bases; auth base never
  const bases = ['http://localhost:4002', 'http://localhost:4003/uploads'];
  const auth = ['http://localhost:4001'];
  assert.equal(shouldIntercept(new URL('http://localhost:4002/channels'), ORIGIN, bases, auth), true);
  assert.equal(shouldIntercept(new URL('http://localhost:4003/uploads'), ORIGIN, bases, auth), true);
  assert.equal(shouldIntercept(new URL('http://localhost:4001/refresh'), ORIGIN, bases, auth), false);
  assert.equal(shouldIntercept(new URL('http://localhost:9999/x'), ORIGIN, bases, auth), false);
});

test('substitutes the latest token for a stale closure token', async () => {
  const sent: (string | null)[] = [];
  const { manager } = mkManager({ current: 'LATEST' });
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async (_i: unknown, init?: RequestInit) => {
      sent.push(authOf(init));
      return json(200, { ok: true });
    }) as typeof fetch,
  });
  const res = await f('/api/channels', { headers: { Authorization: 'Bearer STALE' } });
  assert.equal(res.status, 200);
  assert.deepEqual(sent, ['Bearer LATEST']);
});

test('requests without a Bearer header or outside /api pass through untouched', async () => {
  const sent: (RequestInit | undefined)[] = [];
  const { manager, state } = mkManager();
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async (_i: unknown, init?: RequestInit) => (sent.push(init), json(200, {}))) as typeof fetch,
  });
  await f('/api/public');
  await f('/static/x', { headers: { Authorization: 'Bearer A' } });
  assert.equal(state.refreshCalls, 0);
  assert.equal(authOf(sent[1]), 'Bearer A');
});

test('401 invalid_token -> exactly one refresh and one retry with the new token and the same body', async () => {
  const calls: { auth: string | null; body: unknown }[] = [];
  const { manager, state } = mkManager({ current: 'OLD', refreshTo: 'NEW' });
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async (_i: unknown, init?: RequestInit) => {
      const auth = authOf(init);
      calls.push({ auth, body: init?.body });
      return auth === 'Bearer NEW' ? json(200, { ok: 1 }) : json(401, { error: 'invalid_token' });
    }) as typeof fetch,
  });
  const form = new FormData();
  form.append('a', 'b');
  const res = await f('/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer OLD' }, body: form });
  assert.equal(res.status, 200);
  assert.equal(state.refreshCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].auth, 'Bearer NEW');
  assert.strictEqual(calls[1].body, form);
});

test('never retries more than once, and not on other 401 codes', async () => {
  let n = 0;
  const { manager, state } = mkManager({ current: 'OLD', refreshTo: 'NEW' });
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async () => (n++, json(401, { error: 'invalid_token' }))) as typeof fetch,
  });
  const res = await f('/api/x', { headers: { Authorization: 'Bearer OLD' } });
  assert.equal(res.status, 401);
  assert.equal(n, 2);
  assert.equal(state.refreshCalls, 1);

  n = 0;
  const g = createAuthFetch({
    origin: ORIGIN,
    manager: mkManager({ current: 'OLD', refreshTo: 'NEW' }).manager,
    baseFetch: (async () => (n++, json(401, { error: 'invalid_credentials' }))) as typeof fetch,
  });
  await g('/api/x', { headers: { Authorization: 'Bearer OLD' } });
  assert.equal(n, 1);
});

test('failed refresh returns the original 401 without retrying', async () => {
  let n = 0;
  const { manager } = mkManager({ current: 'OLD', refreshTo: null });
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async () => (n++, json(401, { error: 'invalid_token' }))) as typeof fetch,
  });
  const res = await f('/api/x', { headers: { Authorization: 'Bearer OLD' } });
  assert.equal(res.status, 401);
  assert.equal(n, 1);
});

test('non-replayable (stream) bodies are not retried', async () => {
  let n = 0;
  const { manager, state } = mkManager({ current: 'OLD', refreshTo: 'NEW' });
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async () => (n++, json(401, { error: 'invalid_token' }))) as typeof fetch,
  });
  const body = new ReadableStream();
  await f('/api/x', { method: 'POST', headers: { Authorization: 'Bearer OLD' }, body, duplex: 'half' } as RequestInit);
  assert.equal(n, 1);
  assert.equal(state.refreshCalls, 0);
});

test('AbortSignal is forwarded on both attempts', async () => {
  const signals: unknown[] = [];
  const { manager } = mkManager({ current: 'OLD', refreshTo: 'NEW' });
  const f = createAuthFetch({
    origin: ORIGIN,
    manager,
    baseFetch: (async (_i: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return authOf(init) === 'Bearer NEW' ? json(200, {}) : json(401, { error: 'invalid_token' });
    }) as typeof fetch,
  });
  const ac = new AbortController();
  await f('/api/x', { headers: { Authorization: 'Bearer OLD' }, signal: ac.signal });
  assert.deepEqual(signals, [ac.signal, ac.signal]);
});
