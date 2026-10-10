import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareToastMessage } from './share';

test('shareToastMessage gives visible feedback for every outcome except a cancelled sheet', () => {
  const url = 'https://example.test/elonixhub/post/1';
  assert.equal(shareToastMessage('cancelled', url), null);
  assert.deepEqual(shareToastMessage('copied', url), { message: 'Link copied to clipboard', kind: 'success' });
  assert.deepEqual(shareToastMessage('shared', url), { message: 'Shared', kind: 'success' });
  const failed = shareToastMessage('failed', url);
  assert.equal(failed?.kind, 'info');
  assert.ok(failed?.message.includes(url), 'the raw link is shown so the user can copy it by hand');
});
