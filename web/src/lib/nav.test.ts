import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canGoBackInApp } from './nav';

test('canGoBackInApp relies on the router history index', () => {
  assert.equal(canGoBackInApp({ idx: 2 }), true);
  assert.equal(canGoBackInApp({ idx: 0 }), false);
  assert.equal(canGoBackInApp(null), false);
  assert.equal(canGoBackInApp({}), false);
});
