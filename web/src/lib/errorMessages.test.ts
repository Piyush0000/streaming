import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyJoinFailure, rateLimitMessage, roomFullMessage, SHARED_ERRORS } from './errorMessages';

test('room full shows N/M and is user-retryable', () => {
  const f = classifyJoinFailure({ code: 'room_full', capacity: { current: 50, max: 50 } });
  assert.equal(f.kind, 'full');
  assert.equal(f.message, 'This room is full (50/50). Try again in a moment.');
  assert.equal(roomFullMessage(), SHARED_ERRORS.room_full);
});

test('fatal vs transient vs auth', () => {
  assert.equal(classifyJoinFailure({ code: 'banned' }).kind, 'fatal');
  assert.equal(classifyJoinFailure({ code: 'stream_ended' }).kind, 'fatal');
  assert.equal(classifyJoinFailure({ code: 'channel_not_found', status: 404 }).kind, 'fatal');
  assert.equal(classifyJoinFailure({ code: 'invite_expired' }).kind, 'fatal');
  assert.equal(classifyJoinFailure({ code: 'network_error', status: 0 }).kind, 'transient');
  assert.equal(classifyJoinFailure({ code: 'http_503', status: 503 }).kind, 'transient');
  assert.equal(classifyJoinFailure({ code: 'access_unavailable' }).kind, 'transient');
  assert.equal(classifyJoinFailure(new Error('media socket failed to connect')).kind, 'transient');
  assert.equal(classifyJoinFailure({ code: 'invalid_token', status: 401 }).kind, 'auth');
});

test('rate limit has a countdown; permission errors are specific; unknown never leaks raw text', () => {
  const f = classifyJoinFailure({ code: 'rate_limited', retryAfterMs: 4200 });
  assert.equal(f.kind, 'rate_limited');
  assert.match(f.message, /5s/);
  assert.match(rateLimitMessage(), /too fast/);
  assert.equal(classifyJoinFailure({ name: 'NotAllowedError' }).kind, 'permission');
  const o = classifyJoinFailure(new Error('TypeError: x is undefined at foo.js:1'));
  assert.equal(o.kind, 'other');
  assert.ok(!o.message.includes('undefined'));
});
