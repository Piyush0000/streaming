import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowGuardedReload,
  isChunkLoadError,
  resetKeysChanged,
  shouldAutoRecoverLogin,
  type KVStore,
} from './errorRecovery';

function memStore(): KVStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const brokenStore: KVStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

test('isChunkLoadError recognises stale-deploy import failures', () => {
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Hub-abc.js')), true);
  assert.equal(isChunkLoadError(new Error('error loading dynamically imported module')), true);
  assert.equal(isChunkLoadError(new TypeError('Importing a module script failed.')), true);
  assert.equal(isChunkLoadError(new Error('Loading chunk 12 failed.')), true);
  assert.equal(isChunkLoadError({ name: 'ChunkLoadError' }), true);
});

test('isChunkLoadError ignores ordinary errors', () => {
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError('Failed to fetch dynamically imported module'), false);
});

test('login auto-recovery fires once per session change, only inside the window', () => {
  const store = memStore();
  assert.equal(shouldAutoRecoverLogin({ now: 10_000, sessionChangedAt: null, store }), false);
  assert.equal(shouldAutoRecoverLogin({ now: 20_000, sessionChangedAt: 10_000, store }), false, 'older than 5s');
  assert.equal(shouldAutoRecoverLogin({ now: 12_000, sessionChangedAt: 10_000, store }), true);
  assert.equal(shouldAutoRecoverLogin({ now: 12_500, sessionChangedAt: 10_000, store }), false, 'already used for this change');
  assert.equal(shouldAutoRecoverLogin({ now: 31_000, sessionChangedAt: 30_000, store }), true, 'a new session change re-arms it');
});

test('login auto-recovery refuses when the guard cannot be persisted', () => {
  assert.equal(shouldAutoRecoverLogin({ now: 11_000, sessionChangedAt: 10_000, store: brokenStore }), false);
});

test('guarded reload is allowed once per gap', () => {
  const store = memStore();
  assert.equal(allowGuardedReload({ now: 1_000, store }), true);
  assert.equal(allowGuardedReload({ now: 2_000, store }), false);
  assert.equal(allowGuardedReload({ now: 62_000, store }), true);
  assert.equal(allowGuardedReload({ now: 5_000, store: brokenStore }), false);
});

test('resetKeysChanged compares by identity, element-wise', () => {
  assert.equal(resetKeysChanged(['/a', 'u1'], ['/a', 'u1']), false);
  assert.equal(resetKeysChanged(['/a', 'u1'], ['/b', 'u1']), true);
  assert.equal(resetKeysChanged(['/a', null], ['/a', 'u1']), true);
  assert.equal(resetKeysChanged(['/a'], ['/a', 'x']), true);
  assert.equal(resetKeysChanged(undefined, []), false);
});
