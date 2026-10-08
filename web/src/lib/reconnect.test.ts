import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelayMs, createReconnector, type ReconnectSnapshot } from './reconnect';

test('backoff grows exponentially, is capped and jittered within bounds', () => {
  const noJitter = { baseMs: 1000, maxMs: 15000, jitter: 0 };
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffDelayMs(n, noJitter)), [1000, 2000, 4000, 8000, 15000, 15000]);
  assert.equal(backoffDelayMs(3, { baseMs: 1000, jitter: 0.5 }, () => 1), 2000);
  assert.equal(backoffDelayMs(3, { baseMs: 1000, jitter: 0.5 }, () => 0), 4000);
  for (let i = 0; i < 50; i++) {
    const d = backoffDelayMs(4, { baseMs: 1000, jitter: 0.3 });
    assert.ok(d >= 5600 && d <= 8000);
  }
});

const instant = async () => {};

test('reconnector succeeds on a later attempt and reports phases', async () => {
  const phases: string[] = [];
  let calls = 0;
  const r = createReconnector({
    sleep: instant,
    attempt: async () => {
      if (++calls < 3) throw new Error('network');
    },
    onChange: (s: ReconnectSnapshot) => phases.push(`${s.phase}${s.attempt}`),
  });
  assert.equal(await r.start(), true);
  assert.equal(calls, 3);
  assert.equal(r.snapshot.phase, 'idle');
  assert.ok(phases.includes('attempting3'));
});

test('reconnector gives up with failed after maxAttempts', async () => {
  let calls = 0;
  const r = createReconnector({ sleep: instant, maxAttempts: 4, attempt: async () => (calls++, Promise.reject(new Error('x'))) });
  assert.equal(await r.start(), false);
  assert.equal(calls, 4);
  assert.equal(r.snapshot.phase, 'failed');
});

test('fatal errors stop immediately', async () => {
  let calls = 0;
  const r = createReconnector({
    sleep: instant,
    attempt: async () => {
      calls++;
      throw Object.assign(new Error('banned'), { fatal: true });
    },
  });
  assert.equal(await r.start(), false);
  assert.equal(calls, 1);
  assert.equal(r.snapshot.phase, 'failed');
});

test('cancel stops a run before any attempt happens', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  const r = createReconnector({
    sleep: () => gate,
    attempt: async () => {
      calls++;
    },
  });
  const p = r.start();
  r.cancel();
  release();
  assert.equal(await p, false);
  assert.equal(calls, 0);
  assert.equal(r.snapshot.phase, 'idle');
});
