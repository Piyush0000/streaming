import { Request, Response, NextFunction } from 'express';
import { PoolClient } from 'pg';
import { extractBearerToken, verifyAccessToken } from '@streaming/auth-shared';
import { pool } from './db';
import { env } from './env';
import { logger } from './logger';
import { isAdminEmail } from './streamService';
import { uuidSchema } from './validation';
import { avatarPresetFor, avatarUrlFor, effectiveDisplayName } from './profile';
import { VoteValue, voteDelta, karmaDelta } from './hubLogic';

// Helpers shared by the hub routers (hub.ts, hubCommunities.ts).

export const REPORT_HIDE_THRESHOLD = 5;

/** Optional auth: a valid Bearer token sets req.user; missing/invalid -> anonymous viewer. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (token) {
    try {
      req.user = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
    } catch {
      // Treated as anonymous on public endpoints.
    }
  }
  next();
}

export function fail(res: Response, err: unknown, what: string, ctx: Record<string, unknown> = {}) {
  logger.error({ err, ...ctx }, `hub: ${what} failed`);
  return res.status(500).json({ error: 'internal_error' });
}

export function parseId(req: Request, res: Response, name = 'id'): string | undefined {
  const parsed = uuidSchema.safeParse(req.params[name]);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_input',
      message: `${name}: ${parsed.error.issues[0].message}`,
      details: parsed.error.issues,
    });
    return undefined;
  }
  return parsed.data;
}

export function rateLimited(res: Response, retryAfterMs: number) {
  const sec = Math.ceil(retryAfterMs / 1000);
  res.setHeader('Retry-After', String(sec));
  return res.status(429).json({
    error: 'rate_limited',
    message: `You are doing that too fast. Try again in ${sec}s.`,
    retryAfterMs,
  });
}

export function badInput(res: Response, message: string) {
  return res.status(400).json({ error: 'invalid_input', message });
}

export async function rollback(client: PoolClient) {
  await client.query('ROLLBACK').catch((e) => logger.error({ err: e }, 'hub: rollback failed'));
}

// ---------- posts ----------

// $1 = viewer id (null for anonymous: the vote/save joins then match nothing).
export const POST_SELECT = `
  p.id, p.user_id, p.username, p.type, p.title, p.body, p.link_url, p.flair, p.caption, p.image_file,
  p.symbol, p.side, p.pnl_percent, p.score, p.up_count, p.down_count, p.comment_count, p.pinned_at, p.created_at,
  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
  to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS saved_ts,
  c.slug AS community_slug, c.name AS community_name,
  up.display_name, up.avatar_file, up.avatar_preset,
  COALESCE(v.value, 0)::int AS my_vote, (s.user_id IS NOT NULL) AS saved`;

export const POST_FROM = `
  FROM hub_posts p
  JOIN communities c ON c.id = p.community_id
  LEFT JOIN user_profiles up ON up.user_id = p.user_id
  LEFT JOIN hub_post_votes v ON v.post_id = p.id AND v.user_id = $1::uuid
  LEFT JOIN hub_post_saves s ON s.post_id = p.id AND s.user_id = $1::uuid`;

export const NOT_HIDDEN = `p.deleted_at IS NULL
  AND (SELECT COUNT(*) FROM hub_reports r WHERE r.post_id = p.id) < ${REPORT_HIDE_THRESHOLD}`;

// Viewer-specific: hides posts by authors the viewer blocked. Requires $1 = viewer id.
export const NOT_BLOCKED = `NOT EXISTS (
  SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = $1::uuid AND ub.blocked_id = p.user_id)`;

export interface PostRow {
  id: string;
  user_id: string;
  username: string;
  type: 'image' | 'text' | 'link';
  title: string;
  body: string;
  link_url: string | null;
  flair: string | null;
  caption: string;
  image_file: string | null;
  symbol: string | null;
  side: string | null;
  pnl_percent: string | null;
  score: number;
  up_count: number;
  down_count: number;
  comment_count: number;
  pinned_at: Date | null;
  created_at: Date;
  cursor_ts: string;
  saved_ts: string | null;
  community_slug: string;
  community_name: string;
  display_name: string | null;
  avatar_file: string | null;
  avatar_preset: string | null;
  my_vote: number;
  saved: boolean;
  sort_key?: string;
}

export function toAuthor(userId: string, username: string, p: { display_name: string | null; avatar_file: string | null; avatar_preset: string | null }) {
  return {
    id: userId,
    username,
    displayName: effectiveDisplayName(p.display_name, username),
    avatarUrl: avatarUrlFor(p.avatar_file),
    avatarPreset: avatarPresetFor(p.avatar_preset),
  };
}

export function toPost(row: PostRow, viewerId: string | null) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    flair: row.flair,
    pinned: row.pinned_at !== null,
    community: { slug: row.community_slug, name: row.community_name },
    author: toAuthor(row.user_id, row.username, row),
    caption: row.body !== '' ? row.body : row.caption,
    imageUrl: row.image_file ? `/api/hub/media/${row.image_file}` : null,
    symbol: row.symbol,
    side: row.side,
    pnlPercent: row.pnl_percent === null ? null : Number(row.pnl_percent),
    score: row.score,
    upCount: row.up_count,
    downCount: row.down_count,
    likeCount: row.up_count,
    myVote: row.my_vote === 1 ? 1 : row.my_vote === -1 ? -1 : 0,
    likedByMe: row.my_vote === 1,
    saved: row.saved,
    commentCount: row.comment_count,
    mine: viewerId !== null && row.user_id === viewerId,
    createdAt: row.created_at.toISOString(),
  };
}
export type HubPost = ReturnType<typeof toPost>;

export async function loadPost(id: string, viewerId: string | null): Promise<HubPost | null> {
  const { rows } = await pool.query<PostRow>(
    `SELECT ${POST_SELECT} ${POST_FROM} WHERE p.id = $2 AND ${NOT_HIDDEN} AND ${NOT_BLOCKED}`,
    [viewerId, id]
  );
  return rows[0] ? toPost(rows[0], viewerId) : null;
}

// ---------- moderation ----------

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/** Admin (STREAM_ADMIN_EMAILS) or owner/mod of the community. */
export async function canModerate(
  db: Queryable,
  user: { sub: string; email?: string },
  communityId: string
): Promise<boolean> {
  if (isAdminEmail(user.email)) return true;
  const { rows } = await db.query(
    "SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2 AND role IN ('owner', 'mod')",
    [communityId, user.sub]
  );
  return rows.length > 0;
}

// ---------- karma ----------

export async function addKarma(client: PoolClient, userId: string, kind: 'post' | 'comment', delta: number) {
  if (delta === 0) return;
  const col = kind === 'post' ? 'post_karma' : 'comment_karma';
  await client.query(
    `INSERT INTO hub_karma (user_id, ${col}) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET ${col} = hub_karma.${col} + EXCLUDED.${col}, updated_at = now()`,
    [userId, delta]
  );
}

/** Rebuilds a user's karma counters from the vote tables (fixes any drift). */
export async function recomputeKarma(userId: string): Promise<void> {
  await pool.query('SELECT hub_recompute_karma($1::uuid)', [userId]);
}

/** When a post/comment is removed its non-self votes stop counting toward the author's karma. */
export async function removeTargetKarma(client: PoolClient, kind: 'post' | 'comment', id: string, authorId: string) {
  const table = kind === 'post' ? 'hub_post_votes' : 'hub_comment_votes';
  const idCol = kind === 'post' ? 'post_id' : 'comment_id';
  const { rows } = await client.query<{ s: string | null }>(
    `SELECT COALESCE(SUM(value), 0)::text AS s FROM ${table} WHERE ${idCol} = $1 AND user_id <> $2`,
    [id, authorId]
  );
  await addKarma(client, authorId, kind, -Number(rows[0]?.s ?? 0));
}

// ---------- voting ----------

export interface VoteResult {
  score: number;
  upCount: number;
  downCount: number;
  myVote: VoteValue;
}

/**
 * Transactional vote: locks the target row, reads the caller's previous vote, applies the delta
 * to the counters (and hot_rank for posts) and to the author's karma (never for self-votes).
 * Returns null when the target does not exist / is hidden.
 */
export async function castVote(
  kind: 'post' | 'comment',
  targetId: string,
  voterId: string,
  next: VoteValue
): Promise<VoteResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock =
      kind === 'post'
        ? await client.query<{ user_id: string }>(`SELECT p.user_id FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN} FOR UPDATE`, [targetId])
        : await client.query<{ user_id: string }>(
            `SELECT c.user_id FROM hub_comments c JOIN hub_posts p ON p.id = c.post_id
             WHERE c.id = $1 AND c.deleted_at IS NULL AND ${NOT_HIDDEN} FOR UPDATE OF c`,
            [targetId]
          );
    if (!lock.rows[0]) {
      await rollback(client);
      return null;
    }
    const authorId = lock.rows[0].user_id;
    const table = kind === 'post' ? 'hub_post_votes' : 'hub_comment_votes';
    const idCol = kind === 'post' ? 'post_id' : 'comment_id';
    const prevRes = await client.query<{ value: number }>(`SELECT value FROM ${table} WHERE ${idCol} = $1 AND user_id = $2`, [targetId, voterId]);
    const prev = (prevRes.rows[0]?.value ?? 0) as VoteValue;
    const d = voteDelta(prev, next);
    if (next === 0) {
      if (prev !== 0) await client.query(`DELETE FROM ${table} WHERE ${idCol} = $1 AND user_id = $2`, [targetId, voterId]);
    } else if (prev !== next) {
      await client.query(
        `INSERT INTO ${table} (${idCol}, user_id, value) VALUES ($1, $2, $3)
         ON CONFLICT (${idCol}, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [targetId, voterId, next]
      );
    }
    const upd =
      kind === 'post'
        ? await client.query<{ score: number; up_count: number; down_count: number }>(
            `UPDATE hub_posts SET up_count = up_count + $2, down_count = down_count + $3, score = score + $4,
               hot_rank = hub_hot_rank(score + $4, created_at)
             WHERE id = $1 RETURNING score, up_count, down_count`,
            [targetId, d.up, d.down, d.score]
          )
        : await client.query<{ score: number; up_count: number; down_count: number }>(
            `UPDATE hub_comments SET up_count = up_count + $2, down_count = down_count + $3, score = score + $4
             WHERE id = $1 RETURNING score, up_count, down_count`,
            [targetId, d.up, d.down, d.score]
          );
    await addKarma(client, authorId, kind, karmaDelta(prev, next, voterId, authorId));
    await client.query('COMMIT');
    const r = upd.rows[0];
    return { score: r.score, upCount: r.up_count, downCount: r.down_count, myVote: next };
  } catch (err) {
    await rollback(client);
    throw err;
  } finally {
    client.release();
  }
}
