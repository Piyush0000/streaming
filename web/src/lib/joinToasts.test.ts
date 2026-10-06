import test from 'node:test';
import assert from 'node:assert/strict';
import { joinMessage, planJoinToast, type JoinEvent } from './joinToasts';

const ev = (id: string, name: string, at: string, source = 'instagram', userId = 'u' + id): JoinEvent => ({
  id, userId, displayName: name, username: name, avatarUrl: null, source, createdAt: at,
});

test('first poll sets a baseline without toasting', () => {
  const p = planJoinToast([ev('1', 'Ada', '2026-01-01T10:00:00.000Z')], null, 'me');
  assert.equal(p.message, null);
  assert.equal(p.cursor, '2026-01-01T10:00:00.000Z');
});

test('single join names the source; own join is skipped', () => {
  const p = planJoinToast([ev('2', 'Bo', '2026-01-01T10:05:00.000Z'), ev('3', 'Me', '2026-01-01T10:06:00.000Z', 'x', 'me')], '2026-01-01T10:00:00.000Z', 'me');
  assert.equal(p.message, 'Bo just joined Elonix Stream via Instagram');
  assert.equal(p.cursor, '2026-01-01T10:06:00.000Z');
});

test('already-seen events are not repeated; cursor never regresses', () => {
  const p = planJoinToast([ev('1', 'Ada', '2026-01-01T10:00:00.000Z')], '2026-01-01T10:00:00.000Z', 'me');
  assert.equal(p.fresh.length, 0);
  const q = planJoinToast([], '2026-01-01T10:00:00.000Z', 'me');
  assert.equal(q.cursor, '2026-01-01T10:00:00.000Z');
  const r = planJoinToast([ev('9', 'Z', '2026-01-01T10:10:00.000Z')], '2026-01-01T10:00:00.000Z', 'me', new Set(['9']));
  assert.equal(r.fresh.length, 0);
});

test('batches multiple joins', () => {
  const at = (m: number) => `2026-01-01T10:0${m}:00.000Z`;
  assert.equal(joinMessage([ev('1', 'A', at(1)), ev('2', 'B', at(2))]), 'A and B joined Elonix Stream');
  assert.equal(joinMessage([ev('1', 'A', at(1)), ev('2', 'B', at(2)), ev('3', 'C', at(3))]), 'A, B and C joined Elonix Stream');
  const five = [1, 2, 3, 4, 5].map((i) => ev(String(i), 'N' + i, at(i)));
  assert.equal(joinMessage(five), 'N1, N2, N3 and 2 others joined Elonix Stream');
  assert.equal(joinMessage([]), null);
});

test('ignores malformed events', () => {
  const bad = { ...ev('1', 'A', 'nope') };
  const p = planJoinToast([bad], '2026-01-01T10:00:00.000Z', 'me');
  assert.equal(p.message, null);
});
