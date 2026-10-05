import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PRESETS, avatarPresetFor, avatarPresetSchema, isAvatarPreset, avatarUrlFor, effectiveDisplayName, parseIdList, profilePatchSchema } from '../src/profile';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

test('profile patch: trims, caps and requires at least one field', () => {
  assert.deepEqual(profilePatchSchema.parse({ displayName: '  Ada  ' }), { displayName: 'Ada' });
  assert.equal(profilePatchSchema.safeParse({}).success, false);
  assert.equal(profilePatchSchema.safeParse({ displayName: 'x'.repeat(33) }).success, false);
  assert.equal(profilePatchSchema.safeParse({ displayName: 'x'.repeat(32) }).success, true);
  assert.equal(profilePatchSchema.safeParse({ bio: 'x'.repeat(191) }).success, false);
  assert.equal(profilePatchSchema.safeParse({ bio: 'x'.repeat(190) }).success, true);
  assert.equal(profilePatchSchema.safeParse({ displayName: 'a\nb' }).success, false);
  assert.equal(profilePatchSchema.safeParse({ displayName: 'a\u0000b' }).success, false);
  assert.equal(profilePatchSchema.safeParse({ bio: 'line1\nline2' }).success, true);
  assert.equal(profilePatchSchema.safeParse({ bio: 'a\u001bb' }).success, false);
  assert.equal(profilePatchSchema.safeParse({ displayName: 5 }).success, false);
  assert.equal(profilePatchSchema.safeParse({ displayName: 'a', email: 'x@y.z' }).success, false);
});

test('parseIdList: dedupes, validates, caps at 50', () => {
  assert.deepEqual(parseIdList(`${U1},${U2},${U1}`), { ids: [U1, U2] });
  assert.ok('error' in parseIdList(''));
  assert.ok('error' in parseIdList(undefined));
  assert.ok('error' in parseIdList(['a']));
  assert.ok('error' in parseIdList(`${U1},nope`));
  const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.ok('error' in parseIdList(many.join(',')));
  assert.ok('ids' in parseIdList(many.slice(0, 50).join(',')));
});

test('avatarUrlFor only emits safe file names', () => {
  assert.equal(avatarUrlFor(null), null);
  assert.equal(avatarUrlFor('../etc/passwd'), null);
  assert.equal(avatarUrlFor(`${U1}.png`), `/api/users/avatar/${U1}.png`);
  assert.equal(avatarUrlFor(`${U1}.svg`), null);
});

test('effectiveDisplayName falls back to username', () => {
  assert.equal(effectiveDisplayName('', 'bob'), 'bob');
  assert.equal(effectiveDisplayName(null, 'bob'), 'bob');
  assert.equal(effectiveDisplayName('Bob B', 'bob'), 'Bob B');
});

test('avatar preset: allowlist validation', () => {
  assert.equal(isAvatarPreset('bull'), true);
  assert.equal(isAvatarPreset('wizard'), true);
  assert.equal(isAvatarPreset('Bull'), false);
  assert.equal(isAvatarPreset('../etc/passwd'), false);
  assert.equal(isAvatarPreset(''), false);
  assert.equal(isAvatarPreset(null), false);
  assert.equal(isAvatarPreset(5), false);
  assert.equal(avatarPresetFor('fox'), 'fox');
  assert.equal(avatarPresetFor('mickey'), null);
  assert.equal(avatarPresetFor(undefined), null);
  assert.deepEqual(avatarPresetSchema.parse({ preset: 'cat' }), { preset: 'cat' });
  assert.deepEqual(avatarPresetSchema.parse({ preset: null }), { preset: null });
  assert.equal(avatarPresetSchema.safeParse({ preset: 'nope' }).success, false);
  assert.equal(avatarPresetSchema.safeParse({}).success, false);
  assert.equal(avatarPresetSchema.safeParse({ preset: 'cat', x: 1 }).success, false);
  assert.equal(new Set(AVATAR_PRESETS).size, AVATAR_PRESETS.length);
});
