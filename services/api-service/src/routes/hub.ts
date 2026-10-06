import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../db';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { sendInvalidInput } from '../validation';
import { contentTypeForFile, decodeCursor, detectImageExt, encodeCursor } from '../hubImage';
import {
  COMMENT_SORTS,
  CommentSort,
  MAX_COMMENT_DEPTH,
  MAX_PINNED,
  commentBodySchema,
  decodeSortCursor,
  encodeSortCursor,
  flattenThread,
  parsePostInput,
} from '../hubLogic';
import {
  NOT_BLOCKED,
  NOT_HIDDEN,
  POST_FROM,
  POST_SELECT,
  PostRow,
  badInput,
  canModerate,
  castVote,
  fail,
  loadPost,
  optionalAuth,
  parseId,
  rateLimited,
  removeTargetKarma,
  rollback,
  toAuthor,
  toPost,
} from '../hubShared';
import { cursorField, limitField, listPosts } from '../hubFeed';
import { communitiesRouter } from './hubCommunities';

// Elonix Hub: Reddit-style community platform (communities, typed posts, votes, threaded comments).
// Mounted at /hub; the gateway maps /api/hub/ -> api-service /hub/.
export const hubRouter = Router();

export const HUB_UPLOADS_DIR = process.env.HUB_UPLOADS_DIR
  ? path.resolve(process.env.HUB_UPLOADS_DIR)
  : path.join(__dirname, '..', '..', 'hub-uploads');
fs.mkdirSync(HUB_UPLOADS_DIR, { recursive: true });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const POSTS_PER_HOUR = 10;
const COMMENTS_PER_HOUR = 20;
const COMMENT_EDITS_PER_HOUR = 30;
const VOTES_PER_MINUTE = 120;
const SAVES_PER_HOUR = 120;
const MOD_ACTIONS_PER_HOUR = 60;

const slugParam = z.preprocess((v) => (v === '' ? undefined : typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().max(40).optional());

const feedQuerySchema = z.object({
  cursor: cursorField,
  limit: limitField(12, 30),
  sort: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['hot', 'new', 'top', 'controversial']).default('new')),
  t: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['day', 'week', 'month', 'year', 'all']).default('all')),
  community: slugParam,
  author: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(64).optional()),
  feed: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['all', 'joined']).default('all')),
});

// GET /hub/posts?sort=hot|new|top|controversial&t=&community=&author=&feed=joined&cursor=&limit= -> { posts, nextCursor }
// Default sort is `new` (what pre-community clients expect). Hot rank = see hubLogic.hotRank.
hubRouter.get('/posts', optionalAuth, async (req: Request, res: Response) => {
  const parsed = feedQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const q = parsed.data;
  const viewerId = req.user?.sub ?? null;
  if (q.feed === 'joined' && !viewerId) return res.status(401).json({ error: 'missing_token' });
  try {
    const result = await listPosts(viewerId, {
      sort: q.sort,
      t: q.t,
      community: q.community,
      author: q.author,
      joined: q.feed === 'joined',
      cursor: q.cursor,
      limit: q.limit,
    });
    if (!result) return badInput(res, 'cursor: invalid cursor');
    res.json(result);
  } catch (err) {
    fail(res, err, 'list posts');
  }
});

// GET /hub/posts/:id -> { post }
hubRouter.get('/posts/:id', optionalAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const post = await loadPost(id, req.user?.sub ?? null);
    if (!post) return res.status(404).json({ error: 'post_not_found' });
    res.json({ post });
  } catch (err) {
    fail(res, err, 'get post', { id });
  }
});

// ---------- create post ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 16, fieldSize: 16 * 1024, parts: 20 },
});

// POST /hub/posts -> 201 { post }
// multipart (field `image` + fields) or JSON. type image (default for multipart): image required;
// text: title+body; link: title+linkUrl. `community` slug defaults to "general".
hubRouter.post('/posts', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:post:${user.sub}`, POSTS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const multipart = !!req.is('multipart/form-data');

  const handle = async (uploadErr: unknown) => {
    if (uploadErr) {
      if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'image_too_large', message: 'Image must be 5MB or smaller.' });
      }
      logger.warn({ err: uploadErr, userId: user.sub }, 'hub: upload parse failed');
      return res.status(400).json({
        error: 'upload_failed',
        message: uploadErr instanceof Error ? uploadErr.message : 'upload failed',
      });
    }
    const parsed = parsePostInput(req.body, multipart);
    if (!parsed.ok) return typeof parsed.error === 'string' ? badInput(res, parsed.error) : sendInvalidInput(res, parsed.error);
    const d = parsed.value;

    let file: string | null = null;
    let filePath = '';
    let imageBuf: Buffer | null = null;
    if (d.type === 'image') {
      if (!req.file || req.file.size === 0) {
        return res.status(400).json({ error: 'no_image', message: 'image: an image file is required' });
      }
      // Type comes from magic bytes only; client mime type / filename are ignored.
      const ext = detectImageExt(req.file.buffer);
      if (!ext) {
        return res.status(415).json({ error: 'unsupported_image', message: 'Only PNG, JPEG, WebP and GIF images are allowed.' });
      }
      file = `${crypto.randomUUID()}.${ext}`;
      filePath = path.join(HUB_UPLOADS_DIR, file);
      imageBuf = req.file.buffer;
    }

    try {
      const community = await pool.query<{ id: string }>('SELECT id FROM communities WHERE slug = $1', [d.community]);
      if (!community.rows[0]) return res.status(404).json({ error: 'community_not_found' });

      if (imageBuf) {
        try {
          await fs.promises.writeFile(filePath, imageBuf, { flag: 'wx' });
        } catch (err) {
          return fail(res, err, 'write image', { userId: user.sub });
        }
      }
      const postId = crypto.randomUUID();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO hub_posts (id, user_id, username, type, title, body, link_url, flair, community_id,
                                  caption, image_file, symbol, side, pnl_percent, hot_rank)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, hub_hot_rank(0, now()))`,
          [
            postId, user.sub, user.username, d.type, d.title, d.body, d.linkUrl, d.flair, community.rows[0].id,
            d.type === 'image' ? d.body : '', file, d.symbol, d.side, d.pnlPercent,
          ]
        );
        await client.query('UPDATE communities SET post_count = post_count + 1 WHERE id = $1', [community.rows[0].id]);
        await client.query('COMMIT');
      } catch (err) {
        await rollback(client);
        if (file) {
          fs.promises.unlink(filePath).catch((e) => logger.error({ err: e, filePath }, 'hub: failed to clean up orphan image'));
        }
        return fail(res, err, 'create post', { userId: user.sub });
      } finally {
        client.release();
      }
      logger.info({ userId: user.sub, postId, type: d.type }, 'hub: post created');
      const post = await loadPost(postId, user.sub);
      res.status(201).json({ post });
    } catch (err) {
      fail(res, err, 'create post', { userId: user.sub });
    }
  };

  if (multipart) upload.single('image')(req, res, handle);
  else void handle(null);
});

// DELETE /hub/posts/:id (author, community mod/owner, or admin) -> { ok: true }
hubRouter.delete('/posts/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const user = req.user!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ user_id: string; community_id: string }>(
      'SELECT user_id, community_id FROM hub_posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id]
    );
    if (!rows[0]) {
      await rollback(client);
      return res.status(404).json({ error: 'post_not_found' });
    }
    if (rows[0].user_id !== user.sub && !(await canModerate(client, user, rows[0].community_id))) {
      await rollback(client);
      return res.status(403).json({ error: 'forbidden' });
    }
    await removeTargetKarma(client, 'post', id, rows[0].user_id);
    await client.query('UPDATE hub_posts SET deleted_at = now(), pinned_at = NULL WHERE id = $1', [id]);
    await client.query('UPDATE communities SET post_count = GREATEST(post_count - 1, 0) WHERE id = $1', [rows[0].community_id]);
    await client.query('COMMIT');
    logger.info({ postId: id, by: user.sub }, 'hub: post deleted');
    res.json({ ok: true });
  } catch (err) {
    await rollback(client);
    fail(res, err, 'delete post', { id });
  } finally {
    client.release();
  }
});

// ---------- votes ----------

const voteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)], {
    errorMap: () => ({ message: 'value must be 1, -1 or 0' }),
  }),
});

async function voteHandler(req: Request, res: Response, kind: 'post' | 'comment', forced?: 0 | 1) {
  const id = parseId(req, res);
  if (!id) return null;
  let value: -1 | 0 | 1;
  if (forced !== undefined) value = forced;
  else {
    const parsed = voteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendInvalidInput(res, parsed.error);
      return null;
    }
    value = parsed.data.value;
  }
  const me = req.user!.sub;
  const rl = await hitRateLimit(`rl:hub:vote:${me}`, VOTES_PER_MINUTE, 60);
  if (!rl.allowed) {
    rateLimited(res, rl.retryAfterMs);
    return null;
  }
  try {
    const result = await castVote(kind, id, me, value);
    if (!result) {
      res.status(404).json({ error: kind === 'post' ? 'post_not_found' : 'comment_not_found' });
      return null;
    }
    return result;
  } catch (err) {
    fail(res, err, `${kind} vote`, { id, userId: me });
    return null;
  }
}

// POST /hub/posts/:id/vote {value: 1|-1|0} -> { score, upCount, downCount, myVote }
hubRouter.post('/posts/:id/vote', requireAuth, async (req, res) => {
  const r = await voteHandler(req, res, 'post');
  if (r) res.json(r);
});

// Legacy like endpoints: POST = vote 1, DELETE = vote 0 -> { liked, likeCount, score, upCount, downCount, myVote }
async function legacyLike(req: Request, res: Response, like: boolean) {
  const r = await voteHandler(req, res, 'post', like ? 1 : 0);
  if (r) res.json({ liked: like, likeCount: r.upCount, ...r });
}
hubRouter.post('/posts/:id/like', requireAuth, (req, res) => legacyLike(req, res, true));
hubRouter.delete('/posts/:id/like', requireAuth, (req, res) => legacyLike(req, res, false));

// POST /hub/comments/:id/vote {value} -> { score, upCount, downCount, myVote }
hubRouter.post('/comments/:id/vote', requireAuth, async (req, res) => {
  const r = await voteHandler(req, res, 'comment');
  if (r) res.json(r);
});

// ---------- saves ----------

async function setSaved(req: Request, res: Response, saved: boolean) {
  const id = parseId(req, res);
  if (!id) return;
  const me = req.user!.sub;
  const rl = await hitRateLimit(`rl:hub:save:${me}`, SAVES_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    if (saved) {
      const exists = await pool.query(`SELECT 1 FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN}`, [id]);
      if (!exists.rows[0]) return res.status(404).json({ error: 'post_not_found' });
      await pool.query('INSERT INTO hub_post_saves (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, me]);
    } else {
      await pool.query('DELETE FROM hub_post_saves WHERE post_id = $1 AND user_id = $2', [id, me]);
    }
    res.json({ saved });
  } catch (err) {
    fail(res, err, saved ? 'save' : 'unsave', { id });
  }
}
// POST/DELETE /hub/posts/:id/save (idempotent) -> { saved }
hubRouter.post('/posts/:id/save', requireAuth, (req, res) => setSaved(req, res, true));
hubRouter.delete('/posts/:id/save', requireAuth, (req, res) => setSaved(req, res, false));

// GET /hub/saved?cursor=&limit= -> { posts, nextCursor }  (own saves, newest saved first)
hubRouter.get('/saved', requireAuth, async (req: Request, res: Response) => {
  const q = z.object({ cursor: cursorField, limit: limitField(12, 30) }).safeParse(req.query);
  if (!q.success) return sendInvalidInput(res, q.error);
  const me = req.user!.sub;
  let cur: { ts: string; id: string } | null = null;
  if (q.data.cursor) {
    cur = decodeCursor(q.data.cursor);
    if (!cur) return badInput(res, 'cursor: invalid cursor');
  }
  try {
    const params: unknown[] = [me, q.data.limit + 1];
    let cursorSql = '';
    if (cur) {
      params.push(cur.ts, cur.id);
      cursorSql = 'AND (s.created_at, p.id) < ($3::timestamptz, $4::uuid)';
    }
    const { rows } = await pool.query<PostRow>(
      `SELECT ${POST_SELECT} ${POST_FROM}
       WHERE s.user_id IS NOT NULL AND ${NOT_HIDDEN} AND ${NOT_BLOCKED} ${cursorSql}
       ORDER BY s.created_at DESC, p.id DESC LIMIT $2`,
      params
    );
    const page = rows.slice(0, q.data.limit);
    const last = page[page.length - 1];
    res.json({
      posts: page.map((r) => toPost(r, me)),
      nextCursor: rows.length > q.data.limit && last?.saved_ts ? encodeCursor(last.saved_ts, last.id) : null,
    });
  } catch (err) {
    fail(res, err, 'list saved');
  }
});

// ---------- pin ----------

const pinSchema = z.object({ pinned: z.boolean().default(true) });

// POST /hub/posts/:id/pin {pinned?: true} (community mod/owner/admin; max 2 pinned) -> { ok, pinned }
hubRouter.post('/posts/:id/pin', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = pinSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:mod:${user.sub}`, MOD_ACTIONS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const post = await client.query<{ community_id: string }>(
      'SELECT community_id FROM hub_posts WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (!post.rows[0]) {
      await rollback(client);
      return res.status(404).json({ error: 'post_not_found' });
    }
    const communityId = post.rows[0].community_id;
    if (!(await canModerate(client, user, communityId))) {
      await rollback(client);
      return res.status(403).json({ error: 'forbidden' });
    }
    // Serialise pin changes per community so the max-2 rule cannot be raced.
    await client.query('SELECT 1 FROM communities WHERE id = $1 FOR UPDATE', [communityId]);
    if (parsed.data.pinned) {
      const cnt = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM hub_posts WHERE community_id = $1 AND pinned_at IS NOT NULL AND deleted_at IS NULL AND id <> $2',
        [communityId, id]
      );
      if (cnt.rows[0].n >= MAX_PINNED) {
        await rollback(client);
        return res.status(409).json({ error: 'pin_limit', message: `A community can have at most ${MAX_PINNED} pinned posts.` });
      }
      await client.query('UPDATE hub_posts SET pinned_at = COALESCE(pinned_at, now()) WHERE id = $1', [id]);
    } else {
      await client.query('UPDATE hub_posts SET pinned_at = NULL WHERE id = $1', [id]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, pinned: parsed.data.pinned });
  } catch (err) {
    await rollback(client);
    fail(res, err, 'pin post', { id });
  } finally {
    client.release();
  }
});

// ---------- comments ----------

interface CommentRow {
  id: string;
  parent_id: string | null;
  depth: number;
  user_id: string;
  username: string;
  body: string;
  score: number;
  up_count: number;
  down_count: number;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  display_name: string | null;
  avatar_file: string | null;
  avatar_preset: string | null;
  my_vote: number;
  blocked: boolean;
  sort_key: string;
}

// $1 = viewer id.
const COMMENT_SELECT = `
  c.id, c.parent_id, c.depth, c.user_id, c.username, c.body, c.score, c.up_count, c.down_count,
  c.created_at, c.edited_at, c.deleted_at, up.display_name, up.avatar_file, up.avatar_preset,
  COALESCE(v.value, 0)::int AS my_vote,
  EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = $1::uuid AND ub.blocked_id = c.user_id) AS blocked`;
const COMMENT_FROM = `
  FROM hub_comments c
  LEFT JOIN user_profiles up ON up.user_id = c.user_id
  LEFT JOIN hub_comment_votes v ON v.comment_id = c.id AND v.user_id = $1::uuid`;

function toComment(row: CommentRow, viewerId: string | null) {
  if (row.deleted_at !== null || row.blocked) {
    // Placeholder: keeps the tree shape without exposing body/author.
    return {
      id: row.id,
      parentId: row.parent_id,
      depth: row.depth,
      author: null,
      body: null,
      score: 0,
      upCount: 0,
      downCount: 0,
      myVote: 0,
      mine: false,
      createdAt: row.created_at.toISOString(),
      editedAt: null,
      deleted: true,
    };
  }
  return {
    id: row.id,
    parentId: row.parent_id,
    depth: row.depth,
    author: toAuthor(row.user_id, row.username, row),
    body: row.body,
    score: row.score,
    upCount: row.up_count,
    downCount: row.down_count,
    myVote: row.my_vote === 1 ? 1 : row.my_vote === -1 ? -1 : 0,
    mine: viewerId !== null && row.user_id === viewerId,
    createdAt: row.created_at.toISOString(),
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    deleted: false,
  };
}

async function loadComment(id: string, viewerId: string | null) {
  const { rows } = await pool.query<CommentRow>(`SELECT ${COMMENT_SELECT}, '' AS sort_key ${COMMENT_FROM} WHERE c.id = $2`, [viewerId, id]);
  return rows[0] ? toComment(rows[0], viewerId) : null;
}

const commentsQuerySchema = z.object({
  cursor: cursorField,
  limit: limitField(20, 50),
  sort: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['best', 'new', 'top']).default('best')),
});

// GET /hub/posts/:id/comments?sort=best|new|top&cursor=&limit= -> { comments, nextCursor }
// Pagination is over TOP-LEVEL comments; each page includes their whole subtree, flattened depth-first
// (parent before children), so the client can build the tree from parentId/depth.
hubRouter.get('/posts/:id/comments', optionalAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const q = commentsQuerySchema.safeParse(req.query);
  if (!q.success) return sendInvalidInput(res, q.error);
  const sort = q.data.sort as CommentSort;
  const spec = COMMENT_SORTS[sort];
  let cur: { key: string; id: string } | null = null;
  if (q.data.cursor) {
    cur = decodeSortCursor(q.data.cursor, `c:${sort}`, spec.kind);
    if (!cur) return badInput(res, 'cursor: invalid cursor');
  }
  const viewerId = req.user?.sub ?? null;
  try {
    const exists = await pool.query(`SELECT 1 FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN}`, [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'post_not_found' });
    const params: unknown[] = [viewerId, id, q.data.limit + 1];
    let cursorSql = '';
    if (cur) {
      params.push(cur.key, cur.id);
      cursorSql = `AND (${spec.expr}, c.id) < ($4::${spec.cast}, $5::uuid)`;
    }
    const roots = await pool.query<CommentRow>(
      `SELECT ${COMMENT_SELECT}, ${spec.keySql} AS sort_key ${COMMENT_FROM}
       WHERE c.post_id = $2 AND c.parent_id IS NULL
         AND (c.deleted_at IS NULL OR EXISTS (SELECT 1 FROM hub_comments k WHERE k.parent_id = c.id))
         ${cursorSql}
       ORDER BY ${spec.expr} DESC, c.id DESC
       LIMIT $3`,
      params
    );
    const page = roots.rows.slice(0, q.data.limit);
    const last = page[page.length - 1];
    let all = page;
    if (page.length > 0) {
      const subtree = await pool.query<CommentRow>(
        `WITH RECURSIVE t AS (
           SELECT id FROM hub_comments WHERE parent_id = ANY($2::uuid[])
           UNION ALL
           SELECT k.id FROM hub_comments k JOIN t ON k.parent_id = t.id
         )
         SELECT ${COMMENT_SELECT}, ${spec.keySql} AS sort_key ${COMMENT_FROM}
         JOIN t ON t.id = c.id
         LIMIT 3000`,
        [viewerId, page.map((r) => r.id)]
      );
      all = [...page, ...subtree.rows];
    }
    const nodes = all.map((r) => ({ row: r, id: r.id, parentId: r.parent_id, sortKey: r.sort_key, hidden: r.deleted_at !== null || r.blocked }));
    const ordered = flattenThread(nodes, spec.kind);
    res.json({
      comments: ordered.map((n) => toComment(n.row, viewerId)),
      nextCursor: roots.rows.length > q.data.limit && last ? encodeSortCursor(`c:${sort}`, last.sort_key, last.id) : null,
    });
  } catch (err) {
    fail(res, err, 'list comments', { id });
  }
});

const createCommentSchema = commentBodySchema.extend({
  parentId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid('parentId must be a valid UUID').optional()),
});

// POST /hub/posts/:id/comments {body, parentId?} -> 201 { comment }
hubRouter.post('/posts/:id/comments', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = createCommentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:comment:${user.sub}`, COMMENTS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const post = await client.query(`SELECT 1 FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN} FOR UPDATE`, [id]);
    if (!post.rows[0]) {
      await rollback(client);
      return res.status(404).json({ error: 'post_not_found' });
    }
    let depth = 0;
    if (parsed.data.parentId) {
      const parent = await client.query<{ depth: number }>(
        'SELECT depth FROM hub_comments WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL',
        [parsed.data.parentId, id]
      );
      if (!parent.rows[0]) {
        await rollback(client);
        return res.status(404).json({ error: 'parent_not_found' });
      }
      depth = parent.rows[0].depth + 1;
      if (depth > MAX_COMMENT_DEPTH) {
        await rollback(client);
        return res.status(400).json({ error: 'max_depth', message: `Replies can be nested at most ${MAX_COMMENT_DEPTH} levels deep.` });
      }
    }
    const commentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO hub_comments (id, post_id, user_id, username, body, parent_id, depth)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [commentId, id, user.sub, user.username, parsed.data.body, parsed.data.parentId ?? null, depth]
    );
    await client.query('UPDATE hub_posts SET comment_count = comment_count + 1 WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.status(201).json({ comment: await loadComment(commentId, user.sub) });
  } catch (err) {
    await rollback(client);
    fail(res, err, 'create comment', { id, userId: user.sub });
  } finally {
    client.release();
  }
});

// PATCH /hub/comments/:id {body} (author only) -> { comment }
hubRouter.patch('/comments/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = commentBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:comment-edit:${user.sub}`, COMMENT_EDITS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    const { rows } = await pool.query<{ user_id: string }>('SELECT user_id FROM hub_comments WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'comment_not_found' });
    if (rows[0].user_id !== user.sub) return res.status(403).json({ error: 'forbidden' });
    await pool.query('UPDATE hub_comments SET body = $2, edited_at = now() WHERE id = $1 AND deleted_at IS NULL', [id, parsed.data.body]);
    res.json({ comment: await loadComment(id, user.sub) });
  } catch (err) {
    fail(res, err, 'edit comment', { id });
  }
});

// DELETE /hub/comments/:id (soft; author, community mod/owner, or admin) -> { ok: true }
hubRouter.delete('/comments/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const user = req.user!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ user_id: string; post_id: string; community_id: string }>(
      `SELECT c.user_id, c.post_id, p.community_id
       FROM hub_comments c JOIN hub_posts p ON p.id = c.post_id
       WHERE c.id = $1 AND c.deleted_at IS NULL FOR UPDATE OF c`,
      [id]
    );
    if (!rows[0]) {
      await rollback(client);
      return res.status(404).json({ error: 'comment_not_found' });
    }
    if (rows[0].user_id !== user.sub && !(await canModerate(client, user, rows[0].community_id))) {
      await rollback(client);
      return res.status(403).json({ error: 'forbidden' });
    }
    await removeTargetKarma(client, 'comment', id, rows[0].user_id);
    await client.query('UPDATE hub_comments SET deleted_at = now() WHERE id = $1', [id]);
    await client.query('UPDATE hub_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = $1', [rows[0].post_id]);
    await client.query('COMMIT');
    logger.info({ commentId: id, by: user.sub }, 'hub: comment deleted');
    res.json({ ok: true });
  } catch (err) {
    await rollback(client);
    fail(res, err, 'delete comment', { id });
  } finally {
    client.release();
  }
});

// ---------- reports ----------

const reportSchema = z.object({
  reason: z
    .string({ required_error: 'reason is required', invalid_type_error: 'reason must be a string' })
    .trim()
    .min(1, 'reason must not be empty')
    .max(300, 'reason must be at most 300 characters'),
});

// POST /hub/posts/:id/report -> { ok: true }   (one report per user per post; >=5 reports hide the post)
hubRouter.post('/posts/:id/report', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = reportSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;
  try {
    const exists = await pool.query('SELECT 1 FROM hub_posts WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'post_not_found' });
    await pool.query(
      'INSERT INTO hub_reports (post_id, user_id, reason) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO NOTHING',
      [id, user.sub, parsed.data.reason]
    );
    logger.warn({ postId: id, by: user.sub, reason: parsed.data.reason }, 'hub: post reported');
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'report post', { id });
  }
});

// ---------- media ----------

// GET /hub/media/:file  (public). Content-Type comes from the extension map, never sniffed.
hubRouter.get('/media/:file', (req: Request, res: Response) => {
  const file = req.params.file;
  const contentType = contentTypeForFile(file);
  if (!contentType) return res.status(400).json({ error: 'invalid_filename' });
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline; filename="img"');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.sendFile(path.join(HUB_UPLOADS_DIR, file), { cacheControl: false, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err, file }, 'hub: media serve failed');
      res.removeHeader('Cache-Control');
      res.removeHeader('Content-Disposition');
      res.status(404).json({ error: 'not_found' });
    }
  });
});

// Communities, search, user hub profiles (see hubCommunities.ts).
hubRouter.use(communitiesRouter);
