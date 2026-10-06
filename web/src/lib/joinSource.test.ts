import test from 'node:test';
import assert from 'node:assert/strict';
import { detectJoinSource, sourceFromHost, sourceFromUserAgent } from './joinSource';

test('hosts map to sources', () => {
  assert.equal(sourceFromHost('x.com'), 'x');
  assert.equal(sourceFromHost('t.co'), 'x');
  assert.equal(sourceFromHost('mobile.twitter.com'), 'x');
  assert.equal(sourceFromHost('l.facebook.com'), 'facebook');
  assert.equal(sourceFromHost('m.facebook.com'), 'facebook');
  assert.equal(sourceFromHost('l.instagram.com'), 'instagram');
  assert.equal(sourceFromHost('www.youtube.com'), 'youtube');
  assert.equal(sourceFromHost('out.reddit.com'), 'reddit');
  assert.equal(sourceFromHost('web.telegram.org'), 'telegram');
  assert.equal(sourceFromHost('www.google.co.in'), 'google');
  assert.equal(sourceFromHost('notx.com'), null);
  assert.equal(sourceFromHost('evilt.co'), null);
});

test('query tag wins over referrer', () => {
  assert.equal(detectJoinSource({ search: '?utm_source=Instagram', referrer: 'https://x.com/' }), 'instagram');
  assert.equal(detectJoinSource({ search: '?ref=twitter' }), 'x');
  assert.equal(detectJoinSource({ search: '?src=fb' }), 'facebook');
  assert.equal(detectJoinSource({ search: '?utm_source=newsletter' }), 'other');
});

test('referrer, user agent and direct fallbacks', () => {
  assert.equal(detectJoinSource({ referrer: 'https://t.co/abc' }), 'x');
  assert.equal(detectJoinSource({ referrer: 'https://example.org/post' }), 'other');
  assert.equal(detectJoinSource({ referrer: 'https://app.elonix.io/login', ownHost: 'app.elonix.io' }), 'direct');
  assert.equal(detectJoinSource({ userAgent: 'Mozilla/5.0 Instagram 300.0' }), 'instagram');
  assert.equal(detectJoinSource({ userAgent: 'Mozilla [FBAN/FBIOS;FBAV/400]' }), 'facebook');
  assert.equal(detectJoinSource({ userAgent: 'Mozilla Twitter for iPhone' }), 'x');
  assert.equal(detectJoinSource({ userAgent: 'Mozilla/5.0 Chrome' }), 'direct');
  assert.equal(detectJoinSource({ referrer: 'not a url' }), 'direct');
  assert.equal(sourceFromUserAgent(''), null);
});
