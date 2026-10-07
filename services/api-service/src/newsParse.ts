import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/**
 * Server-side RSS/Atom aggregation. Copyright-safe by construction: only
 * title, canonical link, source, category, date and a <=220 char plain-text
 * summary leave this module. Parsing/normalising helpers are pure (unit-tested);
 * fetching + cache are at the bottom.
 */

export type NewsCategory = 'crypto' | 'markets' | 'world';

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  category: NewsCategory;
  publishedAt: string; // ISO
  summary: string | null;
}

export const MAX_ITEM_AGE_MS = 7 * 24 * 3600_000;
export const MAX_ITEMS = 200;
export const SUMMARY_MAX = 220;
const TITLE_MAX = 300;
const FUTURE_SKEW_MS = 60 * 60_000;

// ---------- text helpers ----------
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', copy: '(c)',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
      return String.fromCodePoint(code);
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function stripTags(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028\\u2029\\ufeff]', 'g');

/** Any HTML/entities -> plain text. Output never contains '<' or '>'. */
export function toPlainText(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input;
  // Feeds often double-encode markup (&lt;p&gt;); strip/decode twice, then drop leftovers.
  for (let i = 0; i < 2; i++) s = stripTags(decodeEntities(stripTags(s)));
  s = stripTags(s).replace(/[<>]/g, '');
  s = s.replace(CONTROL_CHARS, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Trim to <= max chars on a word boundary, adding an ellipsis when cut. */
export function trimText(s: string, max = SUMMARY_MAX): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s.,;:!?-]+$/, '') + '…';
}

// ---------- URL / date ----------
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|taid$|at_medium$|at_campaign$|at_custom|ocid$|guccounter$|guce_)/i;

/** Returns a clean http(s) URL (no credentials/fragment/tracking params) or null. */
export function sanitizeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u.toString();
}

/** Key used only for de-duplication. */
export function normalizeUrlKey(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${u.search}`;
}

export function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Parses feed dates; null when unparseable or implausibly far in the future. */
export function parseFeedDate(v: unknown, nowMs: number): number | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v.trim());
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t > nowMs + FUTURE_SKEW_MS) return null;
  return t;
}

export function itemId(url: string): string {
  return createHash('sha1').update(normalizeUrlKey(url)).digest('hex').slice(0, 16);
}

// ---------- feed parsing ----------
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
});

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    if (typeof t === 'string') return t;
  }
  return '';
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function atomLink(links: unknown): string {
  if (typeof links === 'string') return links;
  const arr = asArray(links as Record<string, unknown> | Record<string, unknown>[]);
  const pick =
    arr.find((l) => l && typeof l === 'object' && (l['@_rel'] === 'alternate' || l['@_rel'] === undefined) && l['@_href']) ??
    arr.find((l) => l && typeof l === 'object' && l['@_href']);
  return pick && typeof pick === 'object' ? text(pick['@_href']) : '';
}

export interface FeedMeta {
  name: string;
  category: NewsCategory;
}

/** Parses RSS 2.0 / RSS 1.0 (RDF) / Atom into safe NewsItems. Throws on non-feed XML. Invalid entries are skipped. */
export function parseFeed(body: string, meta: FeedMeta, nowMs: number): NewsItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = xml.parse(body) as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: any[];
  let kind: 'rss' | 'atom';
  if (doc?.rss?.channel) {
    entries = asArray(asArray(doc.rss.channel)[0]?.item);
    kind = 'rss';
  } else if (doc?.['rdf:RDF']) {
    entries = asArray(doc['rdf:RDF'].item);
    kind = 'rss';
  } else if (doc?.feed) {
    entries = asArray(doc.feed.entry);
    kind = 'atom';
  } else {
    throw new Error('not an RSS/Atom document');
  }
  const out: NewsItem[] = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const title = trimText(toPlainText(text(e.title)), TITLE_MAX);
    if (!title) continue;
    let link: string | null;
    let dateRaw: string;
    let descRaw: string;
    if (kind === 'atom') {
      link = sanitizeUrl(atomLink(e.link));
      dateRaw = text(e.published) || text(e.updated);
      descRaw = text(e.summary);
    } else {
      const guid = e.guid && typeof e.guid === 'object' && e.guid['@_isPermaLink'] === 'false' ? '' : text(e.guid);
      link = sanitizeUrl(text(e.link)) ?? sanitizeUrl(guid);
      dateRaw = text(e.pubDate) || text(e['dc:date']) || text(e.published);
      descRaw = text(e.description);
    }
    if (!link) continue;
    const at = parseFeedDate(dateRaw, nowMs);
    if (at === null) continue;
    let summary: string | null = trimText(toPlainText(descRaw)) || null;
    if (summary && normalizeTitleKey(summary) === normalizeTitleKey(title)) summary = null;
    out.push({
      id: itemId(link),
      title,
      url: link,
      source: meta.name,
      category: meta.category,
      publishedAt: new Date(at).toISOString(),
      summary,
    });
  }
  return out;
}

/** Drops old items, dedupes by URL and title, sorts newest first, caps. */
export function mergeItems(lists: NewsItem[][], nowMs: number, cap = MAX_ITEMS): NewsItem[] {
  const all = lists.flat().filter((i) => {
    const t = Date.parse(i.publishedAt);
    return Number.isFinite(t) && nowMs - t <= MAX_ITEM_AGE_MS && t <= nowMs + FUTURE_SKEW_MS;
  });
  all.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : a.id < b.id ? -1 : 1));
  const urls = new Set<string>();
  const titles = new Set<string>();
  const out: NewsItem[] = [];
  for (const i of all) {
    const uk = normalizeUrlKey(i.url);
    const tk = normalizeTitleKey(i.title);
    if (urls.has(uk) || (tk && titles.has(tk))) continue;
    urls.add(uk);
    if (tk) titles.add(tk);
    out.push(i);
    if (out.length >= cap) break;
  }
  return out;
}

// ---------- query (pure) ----------
export type CategoryFilter = 'all' | NewsCategory;

export function encodeCursor(item: NewsItem): string {
  return Buffer.from(`${item.publishedAt}|${item.id}`).toString('base64url');
}

function decodeCursor(c: string): { at: string; id: string } | null {
  try {
    const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    if (!at || !id || !Number.isFinite(Date.parse(at))) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** items must be sorted as produced by mergeItems. Cursor = last item returned previously. */
export function queryItems(
  items: NewsItem[],
  opts: { category: CategoryFilter; q?: string; limit: number; cursor?: string }
): { items: NewsItem[]; nextCursor: string | null } {
  const q = (opts.q ?? '').trim().toLowerCase().slice(0, 100);
  let list = items.filter(
    (i) =>
      (opts.category === 'all' || i.category === opts.category) &&
      (!q || i.title.toLowerCase().includes(q) || (i.summary ?? '').toLowerCase().includes(q) || i.source.toLowerCase().includes(q))
  );
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) list = list.filter((i) => i.publishedAt < c.at || (i.publishedAt === c.at && i.id > c.id));
  }
  const page = list.slice(0, opts.limit);
  const nextCursor = list.length > opts.limit && page.length ? encodeCursor(page[page.length - 1]) : null;
  return { items: page, nextCursor };
}

// ---------- sources ----------
export interface FeedSource extends FeedMeta {
  url: string;
}

// Verified from the build machine. Dropped: bitcoinmagazine (403), yahoo rssindex (404),
// CNBC search.cnbc.com URL (non-XML body) -> replaced with the www.cnbc.com/id/... feed.
export const FEED_SOURCES: FeedSource[] = [
  { name: 'Cointelegraph', category: 'crypto', url: 'https://cointelegraph.com/rss' },
  { name: 'CoinDesk', category: 'crypto', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Decrypt', category: 'crypto', url: 'https://decrypt.co/feed' },
  { name: 'The Block', category: 'crypto', url: 'https://www.theblock.co/rss.xml' },
  { name: 'CryptoSlate', category: 'crypto', url: 'https://cryptoslate.com/feed/' },
  { name: 'NewsBTC', category: 'crypto', url: 'https://www.newsbtc.com/feed/' },
  { name: 'CNBC', category: 'markets', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { name: 'MarketWatch', category: 'markets', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'Investing.com', category: 'markets', url: 'https://www.investing.com/rss/news.rss' },
  { name: 'Financial Times', category: 'markets', url: 'https://www.ft.com/rss/home' },
  { name: 'BBC Business', category: 'world', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { name: 'BBC World', category: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'The Guardian Business', category: 'world', url: 'https://www.theguardian.com/business/rss' },
  { name: 'NPR Business', category: 'world', url: 'https://feeds.npr.org/1006/rss.xml' },
];

