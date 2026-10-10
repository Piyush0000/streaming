import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeIntentUrl, isAndroid, isInAppBrowser } from './inAppBrowser';

const IG = 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android';
const FB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/440.0]';
const CHROME = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

test('detects Instagram and Facebook web views, not plain Chrome', () => {
  assert.equal(isInAppBrowser(IG), true);
  assert.equal(isInAppBrowser(FB), true);
  assert.equal(isInAppBrowser(CHROME), false);
  assert.equal(isAndroid(IG), true);
  assert.equal(isAndroid(FB), false);
});

test('chromeIntentUrl keeps path and query', () => {
  assert.equal(
    chromeIntentUrl('https://stream.lr21.org/login?x=1'),
    'intent://stream.lr21.org/login?x=1#Intent;scheme=https;package=com.android.chrome;end'
  );
  assert.equal(chromeIntentUrl('javascript:alert(1)'), null);
  assert.equal(chromeIntentUrl('not a url'), null);
});
