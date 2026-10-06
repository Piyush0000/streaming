import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOT_EPOCH,
  COMMENT_MAX,
  FLAIR_MAX,
  TITLE_MAX,
  commentBodySchema,
  compareKeysDesc,
  computeKarma,
  containsPattern,
  controversy,
  createCommunitySchema,
  decodeSortCursor,
  deriveTitle,
  encodeSortCursor,
  escapeLike,
  flattenThread,
  hotRank,
  isValidSlug,
  karmaDelta,
  parseHttpUrl,
  parsePostInput,
  voteDelta,
  wilsonLowerBound,
  VoteValue,
} from '../src/hubLogic';

const ID1 = '123e4567-e89b-12d3-a456-426614174000';
const ID2 = '223e4567-e89b-12d3-a456-426614174000';

test('hot rank: age dominates at equal score, score adds log10', () => {
  const t0 = (HOT_EPOCH + 45000 * 1000) * 1000; // arbitrary base
  assert.equal(hotRank(0, t0), 1000);
  assert.equal(hotRank(1, t0), 1000); // log10(1) = 0
  assert.equal(hotRank(10, t0), 1001);
  assert.equal(hotRank(100, t0), 1002);
  assert.equal(hotRank(-10, t0), 999);
  // a post 45000s (12.5h) newer at score 0 equals a 10x score
  assert.equal(hotRank(0, t0 + 45000 * 1000), hotRank(10, t0) + 0);
  assert.ok(hotRank(0, t0 + 1000 * 1000) > hotRank(0, t0));
  assert.ok(hotRank(-5, t0) < hotRank(0, t0));
});

test('controversy and wilson', () => {
  assert.equal(controversy(0, 10), 0);
  assert.equal(controversy(10, 0), 0);
  assert.ok(controversy(10, 10) > controversy(20, 2));
  assert.equal(controversy(5, 5), 10);
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.ok(wilsonLowerBound(100, 0) > wilsonLowerBound(1, 0));
  assert.ok(wilsonLowerBound(10, 0) > wilsonLowerBound(10, 10));
  const w = wilsonLowerBound(50, 50);
  assert.ok(w > 0 && w < 0.5);
});

test('slug validation', () => {
  for (const ok of ['abc', 'a_b_c', 'Crypto'.toLowerCase(), 'x'.repeat(21), 'a1b2c3']) assert.equal(isValidSlug(ok), true, ok);
  for (const bad of ['ab', 'x'.repeat(22), 'has-dash', 'has space', 'CAPS', 'üñí', '', 'a/b', 'a.b']) assert.equal(isValidSlug(bad), false, bad);
  const p = createCommunitySchema.safeParse({ slug: '  MyCoin_1 ', name: ' My Coin ', description: 'hi' });
  assert.ok(p.success);
  assert.equal(p.data.slug, 'mycoin_1');
  assert.equal(p.data.name, 'My Coin');
  assert.equal(createCommunitySchema.safeParse({ slug: 'ok_slug', name: 'x', description: 'd'.repeat(501) }).success, false);
  assert.equal(createCommunitySchema.safeParse({ slug: 'bad-slug', name: 'x' }).success, false);
  assert.equal(createCommunitySchema.safeParse({ slug: 'okslug', name: '' }).success, false);
  assert.equal(createCommunitySchema.parse({ slug: 'okslug', name: 'n' }).description, '');
});

test('url validation rejects non-http schemes', () => {
  assert.equal(parseHttpUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(parseHttpUrl('http://example.com'), 'http://example.com/');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'ftp://x.com', 'file:///etc/passwd', '//evil.com', 'example.com', '', 'https://u:p@example.com', 'https://exa mple.com', 'https://' + 'a'.repeat(500) + '.com'])
    assert.equal(parseHttpUrl(bad), null, bad);
});

test('post input: types, limits, defaults', () => {
  // legacy multipart (no type) = image, derives title
  const img = parsePostInput({ caption: 'BTC long\nsecond line', symbol: 'BTC', side: 'long', pnlPercent: '12.5' }, true);
  assert.ok(img.ok);
  if (img.ok) {
    assert.equal(img.value.type, 'image');
    assert.equal(img.value.community, 'general');
    assert.equal(img.value.title, 'BTC long');
    assert.equal(img.value.pnlPercent, 12.5);
  }
  const noCaption = parsePostInput({}, true);
  assert.ok(noCaption.ok && noCaption.value.title === 'Untitled trade');

  const text = parsePostInput({ title: ' Hello ', body: 'line1\r\nline2', community: 'Crypto' }, false);
  assert.ok(text.ok);
  if (text.ok) {
    assert.equal(text.value.type, 'text');
    assert.equal(text.value.title, 'Hello');
    assert.equal(text.value.body, 'line1\nline2');
    assert.equal(text.value.community, 'crypto');
    assert.equal(text.value.symbol, null);
  }
  assert.equal(parsePostInput({ title: 't' }, false).ok, false); // text needs body
  assert.equal(parsePostInput({ body: 'b' }, false).ok, false); // needs title
  assert.equal(parsePostInput({ title: 't', body: 'x'.repeat(10001) }, false).ok, false);
  assert.equal(parsePostInput({ title: 'x'.repeat(TITLE_MAX + 1), body: 'b' }, false).ok, false);
  assert.equal(parsePostInput({ title: 'x'.repeat(TITLE_MAX), body: 'x'.repeat(10000) }, false).ok, true);
  assert.equal(parsePostInput({ title: 't\u0000x', body: 'b' }, false).ok, false); // control chars
  assert.equal(parsePostInput({ title: 't', body: 'b', flair: 'f'.repeat(FLAIR_MAX + 1) }, false).ok, false);
  assert.equal(parsePostInput({ title: 't', body: 'b', community: 'no-good' }, false).ok, false);
  assert.equal(parsePostInput({ title: 't', body: 'b', type: 'video' }, false).ok, false);

  const link = parsePostInput({ title: 't', linkUrl: 'https://example.com' }, false);
  assert.ok(link.ok && link.value.type === 'link' && link.value.linkUrl === 'https://example.com/');
  assert.equal(parsePostInput({ title: 't', type: 'link' }, false).ok, false);
  assert.equal(parsePostInput({ title: 't', linkUrl: 'javascript:alert(1)' }, false).ok, false);
  assert.equal(parsePostInput({ title: 't', type: 'link', linkUrl: 'data:text/html;base64,AAAA' }, false).ok, false);
  // image text limited to 500
  assert.equal(parsePostInput({ caption: 'x'.repeat(501) }, true).ok, false);
  assert.equal(deriveTitle('  \n  '), 'Untitled trade');
  assert.equal(deriveTitle('x'.repeat(200)).length, TITLE_MAX);
});

test('comment body limits', () => {
  assert.equal(commentBodySchema.safeParse({ body: '  ' }).success, false);
  assert.equal(commentBodySchema.safeParse({ body: 'x'.repeat(COMMENT_MAX) }).success, true);
  assert.equal(commentBodySchema.safeParse({ body: 'x'.repeat(COMMENT_MAX + 1) }).success, false);
  assert.equal(commentBodySchema.safeParse({ body: 'a\nb' }).success, true);
  assert.equal(commentBodySchema.safeParse({ body: 'a\u0007b' }).success, false);
});

test('vote delta math covers all 9 transitions', () => {
  const vals: VoteValue[] = [-1, 0, 1];
  for (const prev of vals) {
    for (const next of vals) {
      const d = voteDelta(prev, next);
      // applying the delta to counters derived from prev must equal counters derived from next
      const base = { up: prev === 1 ? 1 : 0, down: prev === -1 ? 1 : 0 };
      assert.equal(base.up + d.up, next === 1 ? 1 : 0);
      assert.equal(base.down + d.down, next === -1 ? 1 : 0);
      assert.equal(d.score, d.up - d.down);
      assert.equal(d.score, next - prev);
    }
  }
  assert.deepEqual(voteDelta(1, -1), { up: -1, down: 1, score: -2 });
  assert.deepEqual(voteDelta(0, 0), { up: 0, down: 0, score: 0 });
});

test('self-votes never change karma', () => {
  assert.equal(karmaDelta(0, 1, 'a', 'a'), 0);
  assert.equal(karmaDelta(1, -1, 'a', 'a'), 0);
  assert.equal(karmaDelta(0, 1, 'b', 'a'), 1);
  assert.equal(karmaDelta(1, -1, 'b', 'a'), -2);
  assert.equal(karmaDelta(-1, 0, 'b', 'a'), 1);
});

test('incremental karma equals recomputed karma over random vote sequences', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const users = ['u0', 'u1', 'u2', 'u3'];
  const posts = [
    { authorId: 'u0', deleted: false, votes: new Map<string, 1 | -1>() },
    { authorId: 'u1', deleted: false, votes: new Map<string, 1 | -1>() },
  ];
  const karma: Record<string, number> = { u0: 0, u1: 0, u2: 0, u3: 0 };
  for (let i = 0; i < 2000; i++) {
    const post = posts[Math.floor(rnd() * posts.length)];
    const voter = users[Math.floor(rnd() * users.length)];
    const next = ([-1, 0, 1] as VoteValue[])[Math.floor(rnd() * 3)];
    const prev = (post.votes.get(voter) ?? 0) as VoteValue;
    karma[post.authorId] += karmaDelta(prev, next, voter, post.authorId);
    if (next === 0) post.votes.delete(voter);
    else post.votes.set(voter, next);
  }
  const asItems = posts.map((p) => ({
    authorId: p.authorId,
    deleted: p.deleted,
    votes: [...p.votes].map(([userId, value]) => ({ userId, value })),
  }));
  for (const u of users) assert.equal(computeKarma(u, asItems), karma[u], u);
  // deleting a post removes its (non-self) contribution
  const before = computeKarma('u0', asItems);
  asItems[0].deleted = true;
  assert.equal(computeKarma('u0', asItems), 0);
  assert.ok(typeof before === 'number');
});

test('LIKE escaping', () => {
  assert.equal(escapeLike('100%_a\\b'), '100\\%\\_a\\\\b');
  assert.equal(containsPattern('a%b'), '%a\\%b%');
  assert.equal(containsPattern('plain'), '%plain%');
});

test('sort cursors are opaque, sort-bound and validated', () => {
  const c = encodeSortCursor('hot', '12345.1234567', ID1);
  assert.deepEqual(decodeSortCursor(c, 'hot', 'num'), { key: '12345.1234567', id: ID1 });
  assert.equal(decodeSortCursor(c, 'new', 'ts'), null); // other sort
  assert.equal(decodeSortCursor(c, 'hot', 'int'), null); // key kind mismatch
  assert.equal(decodeSortCursor('garbage', 'hot', 'num'), null);
  assert.equal(decodeSortCursor(encodeSortCursor('hot', "1'; DROP TABLE x;--", ID1), 'hot', 'num'), null);
  assert.equal(decodeSortCursor(encodeSortCursor('hot', '1', 'not-a-uuid'), 'hot', 'num'), null);
  assert.deepEqual(decodeSortCursor(encodeSortCursor('top', '-3', ID1), 'top', 'int'), { key: '-3', id: ID1 });
  const ts = '2026-01-02T03:04:05.123456Z';
  assert.deepEqual(decodeSortCursor(encodeSortCursor('new', ts, ID1), 'new', 'ts'), { key: ts, id: ID1 });
  assert.equal(compareKeysDesc({ key: '5', id: ID1 }, { key: '3', id: ID2 }, 'int') < 0, true);
  assert.equal(compareKeysDesc({ key: '3', id: ID1 }, { key: '3', id: ID2 }, 'int') > 0, true); // ties: higher id first
});

test('flattenThread orders depth-first, sorts siblings, prunes dead branches', () => {
  const n = (id: string, parentId: string | null, key: number, hidden = false) => ({ id, parentId, sortKey: String(key), hidden });
  const rows = [
    n('r1', null, 5),
    n('r2', null, 9, true), // hidden root without live replies -> pruned
    n('r3', null, 1, true), // hidden root WITH live reply -> kept as placeholder
    n('a', 'r1', 1),
    n('b', 'r1', 7),
    n('b1', 'b', 2),
    n('c', 'r3', 4),
    n('d', 'r3', 3, true), // hidden leaf -> pruned
  ];
  assert.deepEqual(
    flattenThread(rows, 'int').map((x) => x.id),
    ['r1', 'b', 'b1', 'a', 'r3', 'c']
  );
});
