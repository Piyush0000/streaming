import test from 'node:test';
import assert from 'node:assert/strict';
import { feedSince, isNewAccount, normalizeJoinSource, parseFeedLimit } from '../src/activity';

test('normalizeJoinSource allowlists', () => {
  assert.equal(normalizeJoinSource('Instagram'), 'instagram');
  assert.equal(normalizeJoinSource('x'), 'x');
  assert.equal(normalizeJoinSource('evil'), 'other');
  assert.equal(normalizeJoinSource(5), 'other');
  assert.equal(normalizeJoinSource(undefined), 'other');
});

test('isNewAccount', () => {
  const now = Date.now();
  assert.equal(isNewAccount(new Date(now - 3600_000), now), true);
  assert.equal(isNewAccount(new Date(now - 48 * 3600_000), now), false);
  assert.equal(isNewAccount(null, now), false);
  assert.equal(isNewAccount('garbage', now), false);
});

test('feed params', () => {
  assert.equal(parseFeedLimit('5'), 5);
  assert.equal(parseFeedLimit('999'), 50);
  assert.equal(parseFeedLimit('x'), 20);
  const now = Date.now();
  assert.equal(feedSince(undefined, now).getTime(), now - 24 * 3600_000);
  assert.equal(feedSince(new Date(now - 1000).toISOString(), now).getTime(), now - 1000);
  assert.equal(feedSince(new Date(now - 99 * 3600_000).toISOString(), now).getTime(), now - 24 * 3600_000);
});
