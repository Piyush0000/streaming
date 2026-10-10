import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDimensions, guessImageType } from './imageResize';

test('fitDimensions scales the long side and never upscales', () => {
  assert.deepEqual(fitDimensions(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitDimensions(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitDimensions(0, 10, 100), { width: 0, height: 0 });
});

test('guessImageType falls back to the extension', () => {
  assert.equal(guessImageType('a.JPG', ''), 'image/jpeg');
  assert.equal(guessImageType('a.png', 'image/png'), 'image/png');
  assert.equal(guessImageType('a.heic', ''), '');
});
