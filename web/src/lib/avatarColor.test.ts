import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarColor, avatarGradient, readableLightness, whiteContrastOnHsl } from './avatarColor';

test('every hue keeps white initials readable', () => {
  for (let hue = 0; hue < 360; hue += 5) {
    const l = readableLightness(hue, 62, 50);
    assert.ok(whiteContrastOnHsl(hue, 0.62, l / 100) >= 4.5, `hue ${hue} lightness ${l}`);
  }
});

test('yellow-green is darkened more than blue', () => {
  assert.ok(readableLightness(70, 62, 50) < readableLightness(220, 62, 50));
});

test('avatarGradient / avatarColor are deterministic', () => {
  assert.equal(avatarGradient('ava_trades'), avatarGradient('ava_trades'));
  assert.match(avatarColor('x'), /^hsl\(\d+, 55%, \d+%\)$/);
});
