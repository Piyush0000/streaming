/**
 * Markdown-lite parser for Elonix Hub posts/comments.
 *
 * Pure function: text in, plain AST out. The renderer builds React nodes from the AST,
 * so raw HTML in the source is only ever shown as literal text. Only http/https links survive.
 */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'a'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] };

const MAX_LEN = 20000;
const MAX_DEPTH = 4;

/** Returns a normalized absolute http(s) URL, or null for anything else (javascript:, data:, relative, ...). */
export function safeUrl(raw: string): string | null {
  const s = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 2048 || /[\u0000-\u0020\u007f<>"'\`]/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

const isAlnum = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

function parseInline(s: string, depth = 0, noLink = false): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') {
      flush();
      out.push({ t: 'br' });
      i++;
      continue;
    }
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (depth < MAX_DEPTH) {
      if (ch === '[' && !noLink) {
        const m = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/.exec(s.slice(i, i + 2300));
        if (m) {
          const href = safeUrl(m[2]);
          flush();
          if (href) out.push({ t: 'a', href, c: parseInline(m[1], depth + 1, true) });
          else out.push({ t: 'text', v: m[1] });
          i += m[0].length;
          continue;
        }
      }
      if (ch === '*' && s[i + 1] === '*') {
        const j = s.indexOf('**', i + 2);
        if (j > i + 2) {
          flush();
          out.push({ t: 'b', c: parseInline(s.slice(i + 2, j), depth + 1, noLink) });
          i = j + 2;
          continue;
        }
      }
      if ((ch === '*' && s[i + 1] !== '*') || (ch === '_' && !isAlnum(s[i - 1]))) {
        const j = s.indexOf(ch, i + 1);
        if (j > i + 1 && s[i + 1] !== ' ' && s[j - 1] !== ' ' && !s.slice(i + 1, j).includes('\n') && !(ch === '_' && isAlnum(s[j + 1]))) {
          flush();
          out.push({ t: 'i', c: parseInline(s.slice(i + 1, j), depth + 1, noLink) });
          i = j + 1;
          continue;
        }
      }
    }
    if (!noLink && (ch === 'h' || ch === 'H') && /^https?:\/\//i.test(s.slice(i, i + 8)) && !isAlnum(s[i - 1])) {
      const m = /^https?:\/\/[^\s<>"'`]+/i.exec(s.slice(i, i + 2100));
      if (m) {
        let text = m[0];
        while (/[.,;:!?)\]]$/.test(text)) text = text.slice(0, -1);
        const href = safeUrl(text);
        if (href) {
          flush();
          out.push({ t: 'a', href, c: [{ t: 'text', v: text }] });
          i += text.length;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const text = String(src ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_LEN);
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', v: code.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flushPara();
      const q: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push({ t: 'quote', c: parseInline(q.join('\n')) });
      continue;
    }
    if (/^\s{0,3}[-*+]\s+\S/.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s{0,3}[-*+]\s+\S/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s{0,3}[-*+]\s+/, '')));
      blocks.push({ t: 'ul', items });
      continue;
    }
    if (/^\s{0,3}\d{1,3}[.)]\s+\S/.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && /^\s{0,3}\d{1,3}[.)]\s+\S/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s{0,3}\d{1,3}[.)]\s+/, '')));
      blocks.push({ t: 'ol', items });
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

function inlinePlain(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : inlinePlain(n.c)))
    .join('');
}

/** Flattened single-line preview (for compact rows / meta descriptions). */
export function markdownToPlain(src: string, max = 200): string {
  const out = parseMarkdown(src)
    .map((b) => (b.t === 'code' ? b.v : b.t === 'ul' || b.t === 'ol' ? b.items.map(inlinePlain).join(' ') : inlinePlain(b.c)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
