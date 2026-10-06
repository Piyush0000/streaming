// Pure logic for the Elonix Hub community platform. No env/db imports so it
// can be unit tested in isolation. SQL twins of the scoring functions live in
// migrations/009_hub_community.sql and MUST stay in sync.
import { z } from 'zod';

// ---------- scoring ----------

export const HOT_EPOCH = 1134028003;
export const HOT_DIVISOR = 45000;

/**
 * Reddit-style hot rank: sign(score) * log10(max(|score|, 1)) + (created - 1134028003) / 45000.
 * Rounded to 7 decimals to match the NUMERIC stored by hub_hot_rank().
 * A tenfold score jump equals ~12.5h of age; negative scores sink below fresh posts.
 */
export function hotRank(score: number, createdAtMs: number): number {
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const seconds = createdAtMs / 1000 - HOT_EPOCH;
  return Math.round((sign * order + seconds / HOT_DIVISOR) * 1e7) / 1e7;
}

/** Reddit "controversial": (up+down)^(min/max), 0 unless both sides have votes. */
export function controversy(up: number, down: number): number {
  if (up <= 0 || down <= 0) return 0;
  return (up + down) ** (Math.min(up, down) / Math.max(up, down));
}

const Z = 1.281551565545;
/** Lower bound of the Wilson score interval (80%) used for the "best" comment sort. */
export function wilsonLowerBound(up: number, down: number): number {
  const n = up + down;
  if (n <= 0) return 0;
  const p = up / n;
  const z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// ---------- votes & karma ----------

export type VoteValue = -1 | 0 | 1;

export function isVoteValue(v: unknown): v is VoteValue {
  return v === -1 || v === 0 || v === 1;
}

export interface VoteDelta {
  up: number;
  down: number;
  score: number;
}

/** Counter changes when a user's vote moves from `prev` to `next` (0 = no vote). */
export function voteDelta(prev: VoteValue, next: VoteValue): VoteDelta {
  return {
    up: (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0),
    down: (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0),
    score: next - prev,
  };
}

/** Karma change for the target's author: self-votes never count. */
export function karmaDelta(prev: VoteValue, next: VoteValue, voterId: string, authorId: string): number {
  return voterId === authorId ? 0 : next - prev;
}

/** Reference definition of karma (what hub_recompute_karma() computes in SQL). */
export function computeKarma(
  userId: string,
  items: { authorId: string; deleted: boolean; votes: { userId: string; value: 1 | -1 }[] }[]
): number {
  let total = 0;
  for (const it of items) {
    if (it.authorId !== userId || it.deleted) continue;
    for (const v of it.votes) if (v.userId !== userId) total += v.value;
  }
  return total;
}

// ---------- text / url / slug validation (plain text only, no markdown processing) ----------

export const SLUG_RE = /^[a-z0-9_]{3,21}$/;
export const TITLE_MAX = 150;
export const BODY_MAX = 10000;
export const IMAGE_TEXT_MAX = 500;
export const LINK_MAX = 500;
export const FLAIR_MAX = 24;
export const COMMENT_MAX = 2000;
export const COMMUNITY_NAME_MAX = 50;
export const COMMUNITY_DESC_MAX = 500;
export const MAX_COMMENT_DEPTH = 8;
export const MAX_PINNED = 2;

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}
export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function hasControlChars(s: string, allowNewline: boolean): boolean {
  // eslint-disable-next-line no-control-regex
  return (allowNewline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(s);
}

/** CRLF -> LF, trim. Does not alter anything else (no markdown handling). */
export function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

/** Returns an error message, or null when `s` is a valid plain-text field. */
export function textProblem(s: string, max: number, multiline: boolean): string | null {
  if (hasControlChars(s, multiline)) return 'contains invalid characters';
  if ([...s].length > max) return `must be at most ${max} characters`;
  return null;
}

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Optional plain-text field (empty string = absent). */
export function textField(label: string, max: number, multiline = false) {
  return z.preprocess(
    emptyToUndef,
    z
      .string({ invalid_type_error: `${label} must be a string` })
      .transform((s) => normalizeText(s))
      .superRefine((s, ctx) => {
        const p = textProblem(s, max, multiline);
        if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ${p}` });
      })
      .optional()
  );
}

/** Required plain-text field. */
export function requiredText(label: string, max: number, multiline = false) {
  return z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be a string` })
    .transform((s) => normalizeText(s))
    .superRefine((s, ctx) => {
      if (s.length === 0) return ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must not be empty` });
      const p = textProblem(s, max, multiline);
      if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} ${p}` });
    });
}

/** Normalised http(s) URL or null (rejects javascript:, data:, userinfo, >500 chars, garbage). */
export function parseHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > LINK_MAX || hasControlChars(s, false) || /\s/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !u.hostname) return null;
  const href = u.href;
  return href.length <= LINK_MAX ? href : null;
}

export const slugSchema = z
  .string({ required_error: 'slug is required', invalid_type_error: 'slug must be a string' })
  .transform(normalizeSlug)
  .refine(isValidSlug, 'slug must be 3-21 characters: lowercase letters, digits and underscore');

export const createCommunitySchema = z.object({
  slug: slugSchema,
  name: requiredText('name', COMMUNITY_NAME_MAX),
  description: z.preprocess((v) => (v === undefined || v === null ? '' : v), z.string().transform(normalizeText).superRefine((s, ctx) => {
    const p = textProblem(s, COMMUNITY_DESC_MAX, true);
    if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `description ${p}` });
  })),
});

export type PostType = 'image' | 'text' | 'link';

const rawPostSchema = z.object({
  community: z.preprocess(emptyToUndef, slugSchema.optional()),
  type: z.preprocess(emptyToUndef, z.enum(['image', 'text', 'link'], { errorMap: () => ({ message: 'type must be image, text or link' }) }).optional()),
  title: textField('title', TITLE_MAX),
  body: textField('body', BODY_MAX, true),
  caption: textField('caption', IMAGE_TEXT_MAX, true),
  linkUrl: z.preprocess(emptyToUndef, z.string({ invalid_type_error: 'linkUrl must be a string' }).optional()),
  flair: textField('flair', FLAIR_MAX),
  symbol: textField('symbol', 20),
  side: z.preprocess(
    emptyToUndef,
    z.enum(['long', 'short', 'spot'], { errorMap: () => ({ message: 'side must be long, short or spot' }) }).optional()
  ),
  pnlPercent: z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? undefined : Number(v)),
    z
      .number({ invalid_type_error: 'pnlPercent must be a number' })
      .finite('pnlPercent must be a finite number')
      .min(-1_000_000, 'pnlPercent is out of range')
      .max(1_000_000, 'pnlPercent is out of range')
      .optional()
  ),
});

export interface PostInput {
  type: PostType;
  community: string;
  title: string;
  body: string;
  linkUrl: string | null;
  flair: string | null;
  symbol: string | null;
  side: 'long' | 'short' | 'spot' | null;
  pnlPercent: number | null;
}

/** Title for image posts that have none: first caption line (<=150) or 'Untitled trade'. */
export function deriveTitle(text: string): string {
  const first = text.trim().split('\n')[0]?.trim() ?? '';
  return first === '' ? 'Untitled trade' : [...first].slice(0, TITLE_MAX).join('');
}

/**
 * Validates a create-post payload (multipart fields or JSON). `multipart` decides the default type:
 * multipart -> image (legacy clients); JSON -> link when linkUrl is present, else text.
 * For image posts the image file itself is checked by the caller.
 */
export function parsePostInput(
  raw: unknown,
  multipart: boolean
): { ok: true; value: PostInput } | { ok: false; error: z.ZodError | string } {
  const parsed = rawPostSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error };
  const d = parsed.data;
  const type: PostType = d.type ?? (multipart ? 'image' : d.linkUrl ? 'link' : 'text');
  const community = d.community ?? 'general';
  const base = { community, flair: d.flair ?? null, symbol: null, side: null, pnlPercent: null } as const;
  if (type === 'image') {
    const text = d.body ?? d.caption ?? '';
    if ([...text].length > IMAGE_TEXT_MAX) return { ok: false, error: `body: must be at most ${IMAGE_TEXT_MAX} characters for image posts` };
    return {
      ok: true,
      value: {
        ...base,
        type,
        title: d.title ?? deriveTitle(text),
        body: text,
        linkUrl: null,
        symbol: d.symbol ?? null,
        side: d.side ?? null,
        pnlPercent: d.pnlPercent ?? null,
      },
    };
  }
  if (!d.title) return { ok: false, error: 'title: title is required' };
  if (type === 'text') {
    if (!d.body) return { ok: false, error: 'body: body is required for text posts' };
    return { ok: true, value: { ...base, type, title: d.title, body: d.body, linkUrl: null } };
  }
  if (!d.linkUrl) return { ok: false, error: 'linkUrl: linkUrl is required for link posts' };
  const url = parseHttpUrl(d.linkUrl);
  if (!url) return { ok: false, error: `linkUrl: must be a valid http(s) URL of at most ${LINK_MAX} characters` };
  return { ok: true, value: { ...base, type, title: d.title, body: d.body ?? '', linkUrl: url } };
}

export const commentBodySchema = z.object({
  body: requiredText('body', COMMENT_MAX, true),
});

// ---------- search ----------

/** Escapes LIKE/ILIKE wildcards (backslash is PostgreSQL's default escape character). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
export function containsPattern(q: string): string {
  return `%${escapeLike(q)}%`;
}

// ---------- sorting & cursors ----------

export type FeedSort = 'hot' | 'new' | 'top' | 'controversial';
export type CommentSort = 'best' | 'new' | 'top';
export type KeyKind = 'num' | 'int' | 'ts';

export interface SortSpec {
  /** SQL expression ordered DESC (tie-break: id DESC). */
  expr: string;
  /** SQL cast for the cursor key parameter. */
  cast: string;
  /** SQL that renders the key as text for the cursor. */
  keySql: string;
  kind: KeyKind;
}

const TS_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

export const POST_SORTS: Record<FeedSort, SortSpec> = {
  hot: { expr: 'p.hot_rank', cast: 'numeric', keySql: 'p.hot_rank::text', kind: 'num' },
  new: { expr: 'p.created_at', cast: 'timestamptz', keySql: `to_char(p.created_at AT TIME ZONE 'UTC', ${TS_FMT})`, kind: 'ts' },
  top: { expr: 'p.score', cast: 'int', keySql: 'p.score::text', kind: 'int' },
  controversial: {
    expr: 'hub_controversy(p.up_count, p.down_count)',
    cast: 'numeric',
    keySql: 'hub_controversy(p.up_count, p.down_count)::text',
    kind: 'num',
  },
};

export const COMMENT_SORTS: Record<CommentSort, SortSpec> = {
  best: { expr: 'hub_wilson(c.up_count, c.down_count)', cast: 'numeric', keySql: 'hub_wilson(c.up_count, c.down_count)::text', kind: 'num' },
  new: { expr: 'c.created_at', cast: 'timestamptz', keySql: `to_char(c.created_at AT TIME ZONE 'UTC', ${TS_FMT})`, kind: 'ts' },
  top: { expr: 'c.score', cast: 'int', keySql: 'c.score::text', kind: 'int' },
};

export const TOP_WINDOWS = { day: '1 day', week: '7 days', month: '30 days', year: '365 days', all: null } as const;
export type TopWindow = keyof typeof TOP_WINDOWS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RES: Record<KeyKind, RegExp> = {
  num: /^-?\d{1,12}(\.\d{1,12})?$/,
  int: /^-?\d{1,10}$/,
  ts: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
};

/** Opaque, sort-bound keyset cursor. */
export function encodeSortCursor(sort: string, key: string, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, s: sort, k: key, i: id }), 'utf8').toString('base64url');
}

/** Returns null when malformed or issued for a different sort. */
export function decodeSortCursor(cursor: string, sort: string, kind: KeyKind): { key: string; id: string } | null {
  try {
    const o = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (o.v !== 1 || o.s !== sort || typeof o.k !== 'string' || typeof o.i !== 'string') return null;
    if (!UUID_RE.test(o.i) || !KEY_RES[kind].test(o.k)) return null;
    return { key: o.k, id: o.i };
  } catch {
    return null;
  }
}

/** Compare two sort keys DESC-first: returns <0 when `a` should come before `b`. */
export function compareKeysDesc(a: { key: string; id: string }, b: { key: string; id: string }, kind: KeyKind): number {
  let c: number;
  if (kind === 'ts') c = a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
  else c = Number(b.key) - Number(a.key);
  if (c !== 0) return c < 0 ? -1 : 1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// ---------- threads ----------

export interface ThreadNode {
  id: string;
  parentId: string | null;
  sortKey: string;
  /** deleted / hidden-for-viewer: shown only as a placeholder when it has live replies. */
  hidden: boolean;
}

/**
 * Flattens comment rows into depth-first display order. Roots keep their input order (the
 * SQL page order); siblings below roots are ordered by `kind` DESC. Hidden nodes without any
 * live descendant are pruned. Rows whose parent is missing are treated as roots.
 */
export function flattenThread<T extends ThreadNode>(rows: T[], kind: KeyKind): T[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of rows) {
    if (r.parentId && ids.has(r.parentId)) {
      const list = children.get(r.parentId) ?? [];
      list.push(r);
      children.set(r.parentId, list);
    } else {
      roots.push(r);
    }
  }
  const out: T[] = [];
  const visit = (node: T): T[] => {
    const kids = (children.get(node.id) ?? []).slice().sort((a, b) =>
      compareKeysDesc({ key: a.sortKey, id: a.id }, { key: b.sortKey, id: b.id }, kind)
    );
    const sub: T[] = [];
    for (const k of kids) sub.push(...visit(k));
    if (node.hidden && sub.length === 0) return [];
    return [node, ...sub];
  };
  for (const r of roots) out.push(...visit(r));
  return out;
}
