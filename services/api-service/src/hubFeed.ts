import { z } from 'zod';
import { pool } from './db';
import { decodeCursor } from './hubImage';
import {
  FeedSort,
  MAX_PINNED,
  POST_SORTS,
  TOP_WINDOWS,
  TopWindow,
  decodeSortCursor,
  encodeSortCursor,
} from './hubLogic';
import { NOT_BLOCKED, NOT_HIDDEN, POST_FROM, POST_SELECT, PostRow, toPost } from './hubShared';

export const cursorField = z.preprocess((v) => (v === '' ? undefined : v), z.string().max(400).optional());
export const limitField = (def: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z
      .number({ invalid_type_error: 'limit must be a number' })
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(max, `limit must be at most ${max}`)
      .default(def)
  );

// ---------- feed ----------

export interface FeedOptions {
  sort: FeedSort;
  t: TopWindow;
  community?: string;
  author?: string;
  joined?: boolean;
  cursor?: string;
  limit: number;
}

/** Shared feed query: used by /posts and /users/:username/posts. Returns null on a bad cursor. */
export async function listPosts(viewerId: string | null, o: FeedOptions) {
  const spec = POST_SORTS[o.sort];
  let cur: { key: string; id: string } | null = null;
  if (o.cursor) {
    cur = decodeSortCursor(o.cursor, o.sort, spec.kind);
    // Cursors issued before sorts existed were (created_at|id) pairs.
    if (!cur && o.sort === 'new') {
      const legacy = decodeCursor(o.cursor);
      if (legacy) cur = { key: legacy.ts, id: legacy.id };
    }
    if (!cur) return null;
  }
  const params: unknown[] = [viewerId, o.limit + 1];
  const where: string[] = [NOT_HIDDEN, NOT_BLOCKED];
  const push = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (o.community) where.push(`c.slug = ${push(o.community)}`);
  if (o.author) where.push(`p.user_id = (SELECT u.id FROM users u WHERE lower(u.username) = lower(${push(o.author)}::text))`);
  if (o.joined) where.push('p.community_id IN (SELECT m.community_id FROM community_members m WHERE m.user_id = $1::uuid)');
  const win = o.sort === 'top' ? TOP_WINDOWS[o.t] : null;
  if (win) where.push(`p.created_at >= now() - interval '${win}'`);
  // Pinned posts are served separately (first page only) in a community feed.
  const pinnedFirst = !!o.community && !o.author;
  if (pinnedFirst) where.push('p.pinned_at IS NULL');
  if (cur) where.push(`(${spec.expr}, p.id) < (${push(cur.key)}::${spec.cast}, ${push(cur.id)}::uuid)`);

  const { rows } = await pool.query<PostRow>(
    `SELECT ${POST_SELECT}, ${spec.keySql} AS sort_key ${POST_FROM}
     WHERE ${where.join(' AND ')}
     ORDER BY ${spec.expr} DESC, p.id DESC
     LIMIT $2`,
    params
  );
  const page = rows.slice(0, o.limit);
  const last = page[page.length - 1];
  let pinned: PostRow[] = [];
  if (pinnedFirst && !o.cursor) {
    pinned = (
      await pool.query<PostRow>(
        `SELECT ${POST_SELECT} ${POST_FROM}
         WHERE ${NOT_HIDDEN} AND ${NOT_BLOCKED} AND p.pinned_at IS NOT NULL AND c.slug = $2
         ORDER BY p.pinned_at DESC, p.id DESC LIMIT ${MAX_PINNED}`,
        [viewerId, o.community]
      )
    ).rows;
  }
  return {
    posts: [...pinned, ...page].map((r) => toPost(r, viewerId)),
    nextCursor: rows.length > o.limit && last ? encodeSortCursor(o.sort, last.sort_key ?? '', last.id) : null,
  };
}

