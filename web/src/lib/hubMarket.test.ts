import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewsPage, parseOverview, parseSymbolsResponse, safeUrl } from './hubMarket';

test('parseNewsPage drops items with bad urls and tolerates garbage', () => {
  const p = parseNewsPage({
    stale: true,
    sources: [{ name: 'A', ok: true }, { name: 'B' }],
    items: [
      { id: '1', title: 'Hi', url: 'https://x.com/a', source: 'X', category: 'crypto', publishedAt: null, summary: null },
      { id: '2', title: 'Bad', url: 'javascript:alert(1)' },
      null,
    ],
  });
  assert.equal(p.items.length, 1);
  assert.equal(p.stale, true);
  assert.equal(p.sources[1]!.ok, false);
  assert.equal(p.nextCursor, null);
  assert.deepEqual(parseNewsPage(null).items, []);
});

test('parseSymbolsResponse fills optional fields and skips invalid rows', () => {
  const r = parseSymbolsResponse({ symbols: [{ symbol: 'BTCUSDT', price: '100' }, { symbol: 'X' }, 5] });
  assert.equal(r.symbols.length, 1);
  assert.equal(r.symbols[0]!.base, 'BTC');
  assert.equal(r.symbols[0]!.high, 100);
});

test('parseOverview keeps nulls null', () => {
  const o = parseOverview({ fearGreed: null, global: null });
  assert.equal(o.fearGreed, null);
  assert.equal(o.global, null);
  assert.equal(parseOverview({ fearGreed: { value: 150, label: 'Greed' } }).fearGreed?.value, 100);
});

test('safeUrl only allows http(s)', () => {
  assert.equal(safeUrl('ftp://a'), null);
  assert.ok(safeUrl('http://a.com'));
});
