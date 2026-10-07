import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, toPlainText, trimText, sanitizeUrl, mergeItems, queryItems, parseFeedDate, NewsItem } from '../src/newsParse';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const meta = { name: 'Src', category: 'crypto' as const };

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title><![CDATA[Bitcoin &amp; <b>ETH</b> rally]]></title><link>https://ex.com/a?utm_source=x&amp;id=1#frag</link>
<pubDate>Thu, 08 Oct 2026 10:00:00 +0000</pubDate>
<description><![CDATA[<p>Prices <script>alert(1)</script>jumped &amp; held.</p><img src="x" onerror="alert(1)">]]></description>
<content:encoded>FULL CONTENT SHOULD NEVER APPEAR</content:encoded></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Thu, 08 Oct 2026 10:00:00 +0000</pubDate></item>
<item><title>No date</title><link>https://ex.com/nodate</link></item>
<item><title>Garbage date</title><link>https://ex.com/gd</link><pubDate>not a date</pubDate></item>
<item><title></title><link>https://ex.com/empty</link><pubDate>Thu, 08 Oct 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title>
<entry><title type="html">Atom &lt;i&gt;headline&lt;/i&gt;</title>
<link rel="self" href="https://ex.com/self"/><link rel="alternate" href="https://ex.com/atom-1"/>
<published>2026-10-08T09:00:00Z</published><summary>&lt;p&gt;Escaped &amp;amp; html&lt;/p&gt;</summary></entry>
<entry><title>Updated only</title><link href="http://ex.com/atom-2"/><updated>2026-10-08T08:00:00Z</updated></entry>
</feed>`;

test('RSS 2.0: strips html, drops bad links/dates, ignores full content', () => {
  const items = parseFeed(RSS, meta, NOW);
  assert.equal(items.length, 1);
  const i = items[0];
  assert.equal(i.title, 'Bitcoin & ETH rally');
  assert.equal(i.url, 'https://ex.com/a?id=1');
  assert.equal(i.summary, 'Prices jumped & held.');
  assert.equal(i.publishedAt, '2026-10-08T10:00:00.000Z');
  assert.equal(i.source, 'Src');
  assert.ok(!JSON.stringify(i).includes('FULL CONTENT'));
  assert.match(i.id, /^[0-9a-f]{16}$/);
});

test('Atom: picks alternate link, published/updated, double-escaped summary', () => {
  const items = parseFeed(ATOM, meta, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, 'https://ex.com/atom-1');
  assert.equal(items[0].title, 'Atom headline');
  assert.equal(items[0].summary, 'Escaped & html');
  assert.equal(items[1].publishedAt, '2026-10-08T08:00:00.000Z');
  assert.equal(items[1].summary, null);
});

test('non-feed xml throws', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>', meta, NOW));
});

test('toPlainText neutralises XSS payloads and never emits angle brackets', () => {
  for (const s of [
    '<script>alert(1)</script>x',
    '&lt;script&gt;alert(1)&lt;/script&gt;y',
    '&amp;lt;img src=x onerror=alert(1)&amp;gt;z',
    '<a href="javascript:alert(1)">click</a>',
    '1 < 2 > 0',
  ]) {
    const out = toPlainText(s);
    assert.ok(!/[<>]/.test(out), out);
    assert.ok(!/<script/i.test(out));
  }
  assert.equal(toPlainText('<p>a&nbsp;&#65;b&#x41;</p>'), 'a AbA');
  assert.equal(toPlainText(null), '');
});

test('trimText caps at 220 incl. ellipsis, on word boundary', () => {
  const long = 'word '.repeat(100).trim();
  const t = trimText(long);
  assert.ok(t.length <= 220);
  assert.ok(t.endsWith('…'));
  assert.equal(trimText('short'), 'short');
});

test('sanitizeUrl: http/https only, strips tracking/fragment/credentials', () => {
  assert.equal(sanitizeUrl('https://a.com/x?utm_medium=y&k=1#h'), 'https://a.com/x?k=1');
  assert.equal(sanitizeUrl('http://a.com/'), 'http://a.com/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.com/x', '//a.com', 'not a url', '', 'https://u:p@a.com/', null, 5]) {
    assert.equal(sanitizeUrl(bad), null, String(bad));
  }
});

test('parseFeedDate rejects garbage and far-future dates', () => {
  assert.equal(parseFeedDate('nope', NOW), null);
  assert.equal(parseFeedDate('', NOW), null);
  assert.equal(parseFeedDate('2027-01-01T00:00:00Z', NOW), null);
  assert.equal(parseFeedDate('2026-10-08T11:00:00Z', NOW), Date.parse('2026-10-08T11:00:00Z'));
});

function item(over: Partial<NewsItem>): NewsItem {
  return {
    id: 'id' + Math.random(),
    title: 't' + Math.random(),
    url: 'https://ex.com/' + Math.random(),
    source: 'S',
    category: 'crypto',
    publishedAt: '2026-10-08T10:00:00.000Z',
    summary: null,
    ...over,
  };
}

test('mergeItems: dedupes by url and title, drops >7d, sorts newest first, caps', () => {
  const a = item({ id: 'a', title: 'Same Title', url: 'https://www.ex.com/p/1/', publishedAt: '2026-10-08T10:00:00.000Z' });
  const dupUrl = item({ id: 'b', title: 'Other', url: 'https://ex.com/p/1', publishedAt: '2026-10-08T09:00:00.000Z' });
  const dupTitle = item({ id: 'c', title: 'same  title!', url: 'https://other.com/z', publishedAt: '2026-10-08T08:00:00.000Z' });
  const old = item({ id: 'd', title: 'Old', publishedAt: '2026-09-20T00:00:00.000Z' });
  const newer = item({ id: 'e', title: 'Newer', publishedAt: '2026-10-08T11:00:00.000Z' });
  const out = mergeItems([[a, dupUrl], [dupTitle, old, newer]], NOW);
  assert.deepEqual(out.map((i) => i.id), ['e', 'a']);
  const many = Array.from({ length: 10 }, () => item({}));
  assert.equal(mergeItems([many], NOW, 3).length, 3);
});

test('queryItems: category, q, limit, cursor pagination', () => {
  const items = mergeItems(
    [
      [
        item({ id: '1', title: 'Bitcoin up', publishedAt: '2026-10-08T11:00:00.000Z' }),
        item({ id: '2', title: 'Oil falls', category: 'markets', publishedAt: '2026-10-08T10:00:00.000Z' }),
        item({ id: '3', title: 'Ethereum news', publishedAt: '2026-10-08T09:00:00.000Z' }),
        item({ id: '4', title: 'Election', category: 'world', publishedAt: '2026-10-08T08:00:00.000Z' }),
      ],
    ],
    NOW
  );
  assert.deepEqual(queryItems(items, { category: 'crypto', limit: 10 }).items.map((i) => i.id), ['1', '3']);
  assert.deepEqual(queryItems(items, { category: 'all', q: 'ETHEREUM', limit: 10 }).items.map((i) => i.id), ['3']);
  const p1 = queryItems(items, { category: 'all', limit: 3 });
  assert.equal(p1.items.length, 3);
  assert.ok(p1.nextCursor);
  const p2 = queryItems(items, { category: 'all', limit: 3, cursor: p1.nextCursor! });
  assert.deepEqual(p2.items.map((i) => i.id), ['4']);
  assert.equal(p2.nextCursor, null);
});
