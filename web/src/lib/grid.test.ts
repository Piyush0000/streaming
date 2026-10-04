import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridColumns, resolveSpotlight } from './grid';

test('gridColumns scales 1-2-3-4 by participant count on wide screens', () => {
  assert.equal(gridColumns(0), 1);
  assert.equal(gridColumns(1), 1);
  assert.equal(gridColumns(2), 2);
  assert.equal(gridColumns(4), 2);
  assert.equal(gridColumns(5), 3);
  assert.equal(gridColumns(9), 3);
  assert.equal(gridColumns(10), 4);
  assert.equal(gridColumns(40), 4);
});

test('gridColumns is capped by container width (375px phone)', () => {
  assert.equal(gridColumns(1, 375), 1);
  assert.equal(gridColumns(2, 375), 1);
  assert.equal(gridColumns(3, 375), 2);
  assert.equal(gridColumns(12, 375), 2);
  assert.equal(gridColumns(12, 600), 3);
  assert.equal(gridColumns(12, 1000), 4);
});

test('resolveSpotlight prefers a live pin, then a screen share, else none', () => {
  assert.equal(resolveSpotlight('u1', ['screen:a'], ['u1', 'u2']), 'u1');
  assert.equal(resolveSpotlight('gone', ['screen:a'], ['u1']), 'screen:a');
  assert.equal(resolveSpotlight(null, ['screen:a', 'screen:b'], ['u1']), 'screen:a');
  assert.equal(resolveSpotlight(null, [], ['u1']), null);
  assert.equal(resolveSpotlight('gone', [], ['u1']), null);
});
