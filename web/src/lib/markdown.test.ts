import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToPlain, parseMarkdown, safeUrl, type Block, type Inline } from './markdown';

function walk(nodes: Inline[], f: (n: Inline) => void) {
  for (const n of nodes) {
    f(n);
    if (n.t === 'b' || n.t === 'i' || n.t === 'a') walk(n.c, f);
  }
}
function allInline(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  for (const b of blocks) {
    const lists = b.t === 'ul' || b.t === 'ol' ? b.items : b.t === 'p' || b.t === 'quote' ? [b.c] : [];
    for (const l of lists) walk(l, (n) => out.push(n));
  }
  return out;
}

test('safeUrl allows only http/https', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com'), 'http://example.com/');
  for (const bad of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    '//evil.com',
    '/x',
    'ftp://x.com',
    'https://',
    'https://a.com/"onmouseover=1',
    'https://a.com/ x',
  ])
    assert.equal(safeUrl(bad), null, bad);
});

test('bold, italic, inline code', () => {
  const [p] = parseMarkdown('a **b** and *i* and `c`') as Extract<Block, { t: 'p' }>[];
  assert.equal(p.t, 'p');
  assert.deepEqual(p.c.map((n) => n.t), ['text', 'b', 'text', 'i', 'text', 'code']);
});

test('code block keeps content literal', () => {
  const b = parseMarkdown('```\n**not bold** <b>x</b>\n```');
  assert.deepEqual(b, [{ t: 'code', v: '**not bold** <b>x</b>' }]);
});

test('lists and quotes', () => {
  const b = parseMarkdown('- one\n- two\n\n1. a\n2. b\n\n> quoted\n> more');
  assert.deepEqual(b.map((x) => x.t), ['ul', 'ol', 'quote']);
  assert.equal((b[0] as Extract<Block, { t: 'ul' }>).items.length, 2);
});

test('line breaks inside a paragraph', () => {
  const [p] = parseMarkdown('a\nb') as Extract<Block, { t: 'p' }>[];
  assert.deepEqual(p.c.map((n) => n.t), ['text', 'br', 'text']);
});

test('links: http/https become anchors, others are plain text', () => {
  const ok = allInline(parseMarkdown('[x](https://e.com) https://f.com/p.'));
  const anchors = ok.filter((n) => n.t === 'a') as Extract<Inline, { t: 'a' }>[];
  assert.deepEqual(anchors.map((a) => a.href), ['https://e.com/', 'https://f.com/p']);
  for (const src of [
    '[x](javascript:alert(1))',
    '[x](JAVASCRIPT:alert(1))',
    '[x](data:text/html;base64,AAA)',
    '[x](//evil.com)',
    '[x]( javascript:alert(1))',
  ])
    assert.equal(allInline(parseMarkdown(src)).filter((n) => n.t === 'a').length, 0, src);
});

test('raw HTML is never interpreted; it stays literal text', () => {
  const src = '<script>alert(1)</script><img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>';
  const nodes = allInline(parseMarkdown(src));
  assert.ok(nodes.every((n) => n.t === 'text' || n.t === 'br'));
  assert.equal(nodes.map((n) => (n.t === 'text' ? n.v : '')).join(''), src);
});

test('link text that looks like a URL does not nest anchors', () => {
  const nodes = allInline(parseMarkdown('[https://a.com](https://b.com)'));
  assert.equal(nodes.filter((n) => n.t === 'a').length, 1);
});

test('pathological input is bounded and does not throw', () => {
  const evil = '*'.repeat(5000) + '['.repeat(5000) + '`'.repeat(5000) + '_'.repeat(5000);
  assert.doesNotThrow(() => parseMarkdown(evil));
  assert.doesNotThrow(() => parseMarkdown('**'.repeat(3000)));
  assert.doesNotThrow(() => parseMarkdown(null as unknown as string));
});

test('markdownToPlain flattens and truncates', () => {
  assert.equal(markdownToPlain('**hi** [x](https://a.com)\n- a\n- b'), 'hi x a b');
  assert.ok(markdownToPlain('x'.repeat(500), 50).length <= 50);
});
