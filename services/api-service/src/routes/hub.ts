import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { extractBearerToken, verifyAccessToken } from '@streaming/auth-shared';
import { pool } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { isAdminEmail } from '../streamService';
import { sendInvalidInput, uuidSchema } from '../validation';
import { contentTypeForFile, decodeCursor, detectImageExt, encodeCursor } from '../hubImage';

// Elonix Hub: public Instagram-style feed of trade screenshots.
// Mounted at /hub; the gateway maps /api/hub/ -> api-service /hub/.
export const hubRouter = Router();

export const HUB_UPLOADS_DIR = process.env.HUB_UPLOADS_DIR
  ? path.resolve(process.env.HUB_UPLOADS_DIR)
  : path.join(__dirname, '..', '..', 'hub-uploads');
fs.mkdirSync(HUB_UPLOADS_DIR, { recursive: true });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REPORT_HIDE_THRESHOLD = 5;
const POSTS_PER_HOUR = 10;
const COMMENTS_PER_HOUR = 20;

// ---------- helpers ----------

/** Optional auth: a valid Bearer token sets req.user; missing/invalid -> anonymous viewer. */
function optionalAuth(req: Request, _res: Response, next: NextFunction) {
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

function fail(res: Response, err: unknown, what: string, ctx: Record<string, unknown> = {}) {
  logger.error({ err, ...ctx }, `hub: ${what} failed`);
  return res.status(500).json({ error: 'internal_error' });
}

function parseId(req: Request, res: Response, name = 'id'): string | undefined {
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

function rateLimited(res: Response, retryAfterMs: number) {
  const sec = Math.ceil(retryAfterMs / 1000);
  res.setHeader('Retry-After', String(sec));
  return res.status(429).json({
    error: 'rate_limited',
    message: `You are doing that too fast. Try again in ${sec}s.`,
    retryAfterMs,
  });
}

const POST_SELECT = `
  p.id, p.user_id, p.username, p.caption, p.image_file, p.symbol, p.side, p.pnl_percent,
  p.like_count, p.comment_count, p.created_at,
  to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
  EXISTS (SELECT 1 FROM hub_likes l WHERE l.post_id = p.id AND l.user_id = $1::uuid) AS liked_by_me`;

const NOT_HIDDEN = `p.deleted_at IS NULL
  AND (SELECT COUNT(*) FROM hub_reports r WHERE r.post_id = p.id) < ${REPORT_HIDE_THRESHOLD}`;

interface PostRow {
  id: string;
  user_id: string;
  username: string;
  caption: string;
  image_file: string;
  symbol: string | null;
  side: string | null;
  pnl_percent: string | null;
  like_count: number;
  comment_count: number;
  created_at: Date;
  cursor_ts: string;
  liked_by_me: boolean;
}

function toPost(row: PostRow, viewerId: string | null) {
  return {
    id: row.id,
    author: { id: row.user_id, username: row.username },
    caption: row.caption,
    imageUrl: `/api/hub/media/${row.image_file}`,
    symbol: row.symbol,
    side: row.side,
    pnlPercent: row.pnl_percent === null ? null : Number(row.pnl_percent),
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: row.liked_by_me,
    mine: viewerId !== null && row.user_id === viewerId,
    createdAt: row.created_at.toISOString(),
  };
}

async function loadPost(id: string, viewerId: string | null): Promise<ReturnType<typeof toPost> | null> {
  const { rows } = await pool.query<PostRow>(
    `SELECT ${POST_SELECT} FROM hub_posts p WHERE p.id = $2 AND ${NOT_HIDDEN}`,
    [viewerId, id]
  );
  return rows[0] ? toPost(rows[0], viewerId) : null;
}

const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string({ invalid_type_error: `${label} must be a string` })
      .trim()
      .max(max, `${label} must be at most ${max} characters`)
      .optional()
  );

const cursorField = z.preprocess((v) => (v === '' ? undefined : v), z.string().max(300).optional());

// ---------- feed ----------

const feedQuerySchema = z.object({
  cursor: cursorField,
  limit: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : Number(v)),
    z
      .number({ invalid_type_error: 'limit must be a number' })
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(30, 'limit must be at most 30')
      .default(12)
  ),
});

// GET /hub/posts?cursor=&limit= -> { posts, nextCursor }
hubRouter.get('/posts', optionalAuth, async (req: Request, res: Response) => {
  const parsed = feedQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const { limit } = parsed.data;
  const viewerId = req.user?.sub ?? null;
  let cur: { ts: string; id: string } | null = null;
  if (parsed.data.cursor) {
    cur = decodeCursor(parsed.data.cursor);
    if (!cur) return res.status(400).json({ error: 'invalid_input', message: 'cursor: invalid cursor' });
  }
  try {
    const params: unknown[] = [viewerId, limit + 1];
    let cursorSql = '';
    if (cur) {
      params.push(cur.ts, cur.id);
      cursorSql = 'AND (p.created_at, p.id) < ($3::timestamptz, $4::uuid)';
    }
    const { rows } = await pool.query<PostRow>(
      `SELECT ${POST_SELECT} FROM hub_posts p
       WHERE ${NOT_HIDDEN} ${cursorSql}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $2`,
      params
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      posts: page.map((r) => toPost(r, viewerId)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.cursor_ts, last.id) : null,
    });
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
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, fieldSize: 8 * 1024, parts: 12 },
});

const createPostSchema = z.object({
  caption: optionalText(500, 'caption'),
  symbol: optionalText(20, 'symbol'),
  side: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
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

// POST /hub/posts (multipart) -> 201 { post }
hubRouter.post('/posts', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:post:${user.sub}`, POSTS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);

  upload.single('image')(req, res, async (uploadErr: unknown) => {
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
    const parsed = createPostSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidInput(res, parsed.error);
    if (!req.file || req.file.size === 0) {
      return res.status(400).json({ error: 'no_image', message: 'image: an image file is required' });
    }
    // Type comes from magic bytes only; client mime type / filename are ignored.
    const ext = detectImageExt(req.file.buffer);
    if (!ext) {
      return res
        .status(415)
        .json({ error: 'unsupported_image', message: 'Only PNG, JPEG, WebP and GIF images are allowed.' });
    }
    const postId = crypto.randomUUID();
    const file = `${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(HUB_UPLOADS_DIR, file);
    try {
      await fs.promises.writeFile(filePath, req.file.buffer, { flag: 'wx' });
    } catch (err) {
      return fail(res, err, 'write image', { userId: user.sub });
    }
    try {
      const d = parsed.data;
      const { rows } = await pool.query<PostRow>(
        `WITH p AS (
           INSERT INTO hub_posts (id, user_id, username, caption, image_file, symbol, side, pnl_percent)
           VALUES ($2, $1, $3, $4, $5, $6, $7, $8)
           RETURNING *
         )
         SELECT p.id, p.user_id, p.username, p.caption, p.image_file, p.symbol, p.side, p.pnl_percent,
                p.like_count, p.comment_count, p.created_at, '' AS cursor_ts, false AS liked_by_me
         FROM p`,
        [user.sub, postId, user.username, d.caption ?? '', file, d.symbol ?? null, d.side ?? null, d.pnlPercent ?? null]
      );
      logger.info({ userId: user.sub, postId, file }, 'hub: post created');
      res.status(201).json({ post: toPost(rows[0], user.sub) });
    } catch (err) {
      fs.promises
        .unlink(filePath)
        .catch((e) => logger.error({ err: e, filePath }, 'hub: failed to clean up orphan image'));
      fail(res, err, 'create post', { userId: user.sub });
    }
  });
});

// DELETE /hub/posts/:id (author or admin) -> { ok: true }
hubRouter.delete('/posts/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const user = req.user!;
  try {
    const { rows } = await pool.query('SELECT user_id FROM hub_posts WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'post_not_found' });
    if (rows[0].user_id !== user.sub && !isAdminEmail(user.email)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await pool.query('UPDATE hub_posts SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
    logger.info({ postId: id, by: user.sub }, 'hub: post deleted');
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'delete post', { id });
  }
});

// ---------- likes ----------

async function setLike(req: Request, res: Response, like: boolean) {
  const id = parseId(req, res);
  if (!id) return;
  const me = req.user!.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the post row so concurrent like/unlike serialise on the counter.
    const post = await client.query(`SELECT 1 FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN} FOR UPDATE`, [id]);
    if (!post.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'post_not_found' });
    }
    if (like) {
      const ins = await client.query(
        'INSERT INTO hub_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, me]
      );
      if (ins.rowCount) await client.query('UPDATE hub_posts SET like_count = like_count + 1 WHERE id = $1', [id]);
    } else {
      const del = await client.query('DELETE FROM hub_likes WHERE post_id = $1 AND user_id = $2', [id, me]);
      if (del.rowCount) {
        await client.query('UPDATE hub_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [id]);
      }
    }
    const { rows } = await client.query('SELECT like_count FROM hub_posts WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ liked: like, likeCount: rows[0].like_count });
  } catch (err) {
    await client.query('ROLLBACK').catch((e) => logger.error({ err: e }, 'hub: rollback failed'));
    fail(res, err, like ? 'like' : 'unlike', { id, userId: me });
  } finally {
    client.release();
  }
}

// POST/DELETE /hub/posts/:id/like (idempotent) -> { liked, likeCount }
hubRouter.post('/posts/:id/like', requireAuth, (req, res) => setLike(req, res, true));
hubRouter.delete('/posts/:id/like', requireAuth, (req, res) => setLike(req, res, false));

// ---------- comments ----------

interface CommentRow {
  id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: Date;
  cursor_ts: string;
}

function toComment(row: CommentRow, viewerId: string | null) {
  return {
    id: row.id,
    author: { id: row.user_id, username: row.username },
    body: row.body,
    createdAt: row.created_at.toISOString(),
    mine: viewerId !== null && row.user_id === viewerId,
  };
}

const COMMENTS_PAGE = 20;

// GET /hub/posts/:id/comments?cursor= -> { comments, nextCursor }   (oldest first)
hubRouter.get('/posts/:id/comments', optionalAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const q = z.object({ cursor: cursorField }).safeParse(req.query);
  if (!q.success) return sendInvalidInput(res, q.error);
  let cur: { ts: string; id: string } | null = null;
  if (q.data.cursor) {
    cur = decodeCursor(q.data.cursor);
    if (!cur) return res.status(400).json({ error: 'invalid_input', message: 'cursor: invalid cursor' });
  }
  const viewerId = req.user?.sub ?? null;
  try {
    const exists = await pool.query(`SELECT 1 FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN}`, [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'post_not_found' });
    const params: unknown[] = [id, COMMENTS_PAGE + 1];
    let cursorSql = '';
    if (cur) {
      params.push(cur.ts, cur.id);
      cursorSql = 'AND (c.created_at, c.id) > ($3::timestamptz, $4::uuid)';
    }
    const { rows } = await pool.query<CommentRow>(
      `SELECT c.id, c.user_id, c.username, c.body, c.created_at,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
       FROM hub_comments c
       WHERE c.post_id = $1 AND c.deleted_at IS NULL ${cursorSql}
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $2`,
      params
    );
    const page = rows.slice(0, COMMENTS_PAGE);
    const last = page[page.length - 1];
    res.json({
      comments: page.map((r) => toComment(r, viewerId)),
      nextCursor: rows.length > COMMENTS_PAGE && last ? encodeCursor(last.cursor_ts, last.id) : null,
    });
  } catch (err) {
    fail(res, err, 'list comments', { id });
  }
});

const commentSchema = z.object({
  body: z
    .string({ required_error: 'body is required', invalid_type_error: 'body must be a string' })
    .trim()
    .min(1, 'body must not be empty')
    .max(300, 'body must be at most 300 characters'),
});

// POST /hub/posts/:id/comments -> 201 { comment }
hubRouter.post('/posts/:id/comments', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = commentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:comment:${user.sub}`, COMMENTS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const post = await client.query(`SELECT 1 FROM hub_posts p WHERE p.id = $1 AND ${NOT_HIDDEN} FOR UPDATE`, [id]);
    if (!post.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'post_not_found' });
    }
    const { rows } = await client.query<CommentRow>(
      `INSERT INTO hub_comments (id, post_id, user_id, username, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, username, body, created_at, '' AS cursor_ts`,
      [crypto.randomUUID(), id, user.sub, user.username, parsed.data.body]
    );
    await client.query('UPDATE hub_posts SET comment_count = comment_count + 1 WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.status(201).json({ comment: toComment(rows[0], user.sub) });
  } catch (err) {
    await client.query('ROLLBACK').catch((e) => logger.error({ err: e }, 'hub: rollback failed'));
    fail(res, err, 'create comment', { id, userId: user.sub });
  } finally {
    client.release();
  }
});

// DELETE /hub/comments/:id (author or admin) -> { ok: true }
hubRouter.delete('/comments/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const user = req.user!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT user_id, post_id FROM hub_comments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [id]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'comment_not_found' });
    }
    if (rows[0].user_id !== user.sub && !isAdminEmail(user.email)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }
    await client.query('UPDATE hub_comments SET deleted_at = now() WHERE id = $1', [id]);
    await client.query('UPDATE hub_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = $1', [
      rows[0].post_id,
    ]);
    await client.query('COMMIT');
    logger.info({ commentId: id, by: user.sub }, 'hub: comment deleted');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch((e) => logger.error({ err: e }, 'hub: rollback failed'));
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

// POST /hub/posts/:id/report -> { ok: true }   (one report per user per post; repeats are no-ops)
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
