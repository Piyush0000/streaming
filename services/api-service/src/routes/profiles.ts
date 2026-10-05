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
import { sendInvalidInput, uuidSchema } from '../validation';
import { HUB_CONTENT_TYPES, detectImageExt } from '../hubImage';
import {
  AVATAR_FILE_RE,
  avatarPresetFor,
  avatarPresetSchema,
  avatarUrlFor,
  effectiveDisplayName,
  parseIdList,
  profilePatchSchema,
} from '../profile';

// User profiles, avatars and user-to-user blocks. Mounted at /users BEFORE
// usersRouter (follows); the gateway maps /api/users/ -> api-service /users/.
// Email is only ever returned by GET /users/me/profile, to its owner.
export const profilesRouter = Router();

// Separate volume from hub/chat uploads so each can be sized, backed up and purged on its own.
export const AVATAR_UPLOADS_DIR = process.env.AVATAR_UPLOADS_DIR
  ? path.resolve(process.env.AVATAR_UPLOADS_DIR)
  : path.join(__dirname, '..', '..', 'avatar-uploads');
fs.mkdirSync(AVATAR_UPLOADS_DIR, { recursive: true });

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const PROFILE_WRITES_PER_HOUR = 30;
const AVATAR_WRITES_PER_HOUR = 10;
const BLOCK_WRITES_PER_HOUR = 120;
const REPORTS_PER_HOUR = 10;

function fail(res: Response, err: unknown, what: string, ctx: Record<string, unknown> = {}) {
  logger.error({ err, ...ctx }, `profiles: ${what} failed`);
  return res.status(500).json({ error: 'internal_error' });
}

function parseUserParam(req: Request, res: Response, name = 'id'): string | undefined {
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

interface ProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_file: string | null;
  avatar_preset: string | null;
  created_at: Date;
}

const PROFILE_SELECT = `
  SELECT u.id, u.username, u.created_at, p.display_name, p.bio, p.avatar_file, p.avatar_preset
  FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id`;

function toPublic(row: ProfileRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: effectiveDisplayName(row.display_name, row.username),
    bio: row.bio ?? '',
    avatarUrl: avatarUrlFor(row.avatar_file),
    avatarPreset: avatarPresetFor(row.avatar_preset),
    joinedAt: row.created_at.toISOString(),
  };
}

async function loadProfile(id: string): Promise<ProfileRow | null> {
  const { rows } = await pool.query<ProfileRow>(`${PROFILE_SELECT} WHERE u.id = $1`, [id]);
  return rows[0] ?? null;
}

function unlinkAvatar(file: string | null | undefined) {
  if (!file || !AVATAR_FILE_RE.test(file)) return;
  fs.promises.unlink(path.join(AVATAR_UPLOADS_DIR, file)).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') logger.error({ err: e, file }, 'profiles: failed to remove old avatar');
  });
}

// ---------- own profile ----------

// GET /users/me/profile -> { profile }  (includes the owner's own email)
profilesRouter.get('/me/profile', requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.sub;
  try {
    const row = await loadProfile(me);
    if (!row) return res.status(404).json({ error: 'user_not_found' });
    res.json({ profile: { ...toPublic(row), email: req.user!.email } });
  } catch (err) {
    fail(res, err, 'get own profile', { me });
  }
});

// PATCH /users/me/profile { displayName?, bio? } -> { profile }   (empty displayName resets to username)
profilesRouter.patch('/me/profile', requireAuth, async (req: Request, res: Response) => {
  const parsed = profilePatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const me = req.user!.sub;
  const rl = await hitRateLimit(`rl:profile:write:${me}`, PROFILE_WRITES_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    // Absent fields keep their stored value (COALESCE on the update branch, defaults on insert).
    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, bio)
       VALUES ($1, COALESCE($2::text, ''), COALESCE($3::text, ''))
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = COALESCE($2::text, user_profiles.display_name),
         bio = COALESCE($3::text, user_profiles.bio),
         updated_at = now()`,
      [me, parsed.data.displayName ?? null, parsed.data.bio ?? null]
    );
    const row = await loadProfile(me);
    if (!row) return res.status(404).json({ error: 'user_not_found' });
    res.json({ profile: { ...toPublic(row), email: req.user!.email } });
  } catch (err) {
    fail(res, err, 'update profile', { me });
  }
});

// ---------- avatar ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 2, fieldSize: 1024, parts: 4 },
});

// POST /users/me/avatar (multipart, field "image", <=2MB) -> { avatarUrl }
profilesRouter.post('/me/avatar', requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.sub;
  const rl = await hitRateLimit(`rl:profile:avatar:${me}`, AVATAR_WRITES_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);

  upload.single('image')(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'image_too_large', message: 'Avatar must be 2MB or smaller.' });
      }
      logger.warn({ err: uploadErr, userId: me }, 'profiles: avatar upload parse failed');
      return res.status(400).json({
        error: 'upload_failed',
        message: uploadErr instanceof Error ? uploadErr.message : 'upload failed',
      });
    }
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
    const file = `${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(AVATAR_UPLOADS_DIR, file);
    try {
      await fs.promises.writeFile(filePath, req.file.buffer, { flag: 'wx' });
    } catch (err) {
      return fail(res, err, 'write avatar', { userId: me });
    }
    try {
      // Read the previous file name first so it can be removed after the swap.
      const prev = await pool.query<{ avatar_file: string | null }>(
        'SELECT avatar_file FROM user_profiles WHERE user_id = $1',
        [me]
      );
      await pool.query(
        `INSERT INTO user_profiles (user_id, avatar_file) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET avatar_file = $2, avatar_preset = NULL, updated_at = now()`,
        [me, file]
      );
      unlinkAvatar(prev.rows[0]?.avatar_file);
      logger.info({ userId: me, file }, 'profiles: avatar updated');
      res.json({ avatarUrl: avatarUrlFor(file), avatarPreset: null });
    } catch (err) {
      unlinkAvatar(file);
      fail(res, err, 'save avatar', { userId: me });
    }
  });
});

// DELETE /users/me/avatar (idempotent) -> { avatarUrl: null }
profilesRouter.delete('/me/avatar', requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.sub;
  const rl = await hitRateLimit(`rl:profile:avatar:${me}`, AVATAR_WRITES_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    const prev = await pool.query<{ avatar_file: string | null }>(
      'SELECT avatar_file FROM user_profiles WHERE user_id = $1',
      [me]
    );
    await pool.query('UPDATE user_profiles SET avatar_file = NULL, avatar_preset = NULL, updated_at = now() WHERE user_id = $1', [me]);
    unlinkAvatar(prev.rows[0]?.avatar_file);
    res.json({ avatarUrl: null });
  } catch (err) {
    fail(res, err, 'delete avatar', { me });
  }
});

// PATCH /users/me/avatar-preset { preset: <allowlisted id> | null } -> { avatarUrl: null, avatarPreset }
// Choosing a preset removes the uploaded photo; null clears the preset.
profilesRouter.patch('/me/avatar-preset', requireAuth, async (req: Request, res: Response) => {
  const parsed = avatarPresetSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const me = req.user!.sub;
  const rl = await hitRateLimit(`rl:profile:avatar:${me}`, AVATAR_WRITES_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    const preset = parsed.data.preset;
    const prev = await pool.query<{ avatar_file: string | null }>(
      'SELECT avatar_file FROM user_profiles WHERE user_id = $1',
      [me]
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, avatar_preset) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         avatar_preset = $2,
         avatar_file = CASE WHEN $2::text IS NULL THEN user_profiles.avatar_file ELSE NULL END,
         updated_at = now()`,
      [me, preset]
    );
    if (preset) unlinkAvatar(prev.rows[0]?.avatar_file);
    const row = await loadProfile(me);
    res.json({ avatarUrl: avatarUrlFor(row?.avatar_file), avatarPreset: avatarPresetFor(row?.avatar_preset) });
  } catch (err) {
    fail(res, err, 'set avatar preset', { me });
  }
});

// GET /users/avatar/:file (public; <img> cannot send a Bearer token).
// Content-Type from the extension map, never sniffed; same hardening as hub media.
profilesRouter.get('/avatar/:file', (req: Request, res: Response) => {
  const file = req.params.file;
  if (!AVATAR_FILE_RE.test(file)) return res.status(400).json({ error: 'invalid_filename' });
  res.setHeader('Content-Type', HUB_CONTENT_TYPES[file.slice(file.lastIndexOf('.') + 1)]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline; filename="img"');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  // File names are fresh UUIDs per upload, so they are safe to cache forever.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.sendFile(path.join(AVATAR_UPLOADS_DIR, file), { cacheControl: false, dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err, file }, 'profiles: avatar serve failed');
      res.removeHeader('Cache-Control');
      res.removeHeader('Content-Disposition');
      res.status(404).json({ error: 'not_found' });
    }
  });
});

// ---------- lookups ----------

// GET /users/profiles?ids=a,b,c (auth, max 50) -> { profiles: [{ id, username, displayName, avatarUrl }] }
// Unknown ids are simply omitted.
profilesRouter.get('/profiles', requireAuth, async (req: Request, res: Response) => {
  const parsed = parseIdList(req.query.ids);
  if ('error' in parsed) return res.status(400).json({ error: 'invalid_input', message: parsed.error });
  try {
    const { rows } = await pool.query<ProfileRow>(`${PROFILE_SELECT} WHERE u.id = ANY($1::uuid[])`, [parsed.ids]);
    res.json({
      profiles: rows.map((r) => {
        const p = toPublic(r);
        return {
          id: p.id,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          avatarPreset: p.avatarPreset,
        };
      }),
    });
  } catch (err) {
    fail(res, err, 'batch profiles');
  }
});

// ---------- blocks ----------
// NOTE: static paths (/me/blocks) are registered before the /:id routes.

// GET /users/me/blocks -> { blocks: [{ id, username, displayName, avatarUrl, blockedAt }] }
profilesRouter.get('/me/blocks', requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.sub;
  try {
    const { rows } = await pool.query<ProfileRow & { blocked_at: Date }>(
      `SELECT u.id, u.username, u.created_at, p.display_name, p.bio, p.avatar_file, p.avatar_preset, b.created_at AS blocked_at
       FROM user_blocks b
       JOIN users u ON u.id = b.blocked_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC, u.id`,
      [me]
    );
    res.json({
      blocks: rows.map((r) => {
        const p = toPublic(r);
        return {
          id: p.id,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          avatarPreset: p.avatarPreset,
          blockedAt: r.blocked_at.toISOString(),
        };
      }),
    });
  } catch (err) {
    fail(res, err, 'list blocks', { me });
  }
});

async function setBlock(req: Request, res: Response, block: boolean) {
  const target = parseUserParam(req, res);
  if (!target) return;
  const me = req.user!.sub;
  if (target === me) {
    return res.status(400).json({ error: 'cannot_block_self', message: 'You cannot block yourself.' });
  }
  const rl = await hitRateLimit(`rl:profile:block:${me}`, BLOCK_WRITES_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    if (block) {
      const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [target]);
      if (!exists.rows[0]) return res.status(404).json({ error: 'user_not_found' });
      await pool.query('INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        me,
        target,
      ]);
    } else {
      await pool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [me, target]);
    }
    // Deliberately no event/notification to the blocked user.
    res.json({ blocked: block });
  } catch (err) {
    fail(res, err, block ? 'block' : 'unblock', { me, target });
  }
}

// POST/DELETE /users/:id/block (idempotent) -> { blocked }
profilesRouter.post('/:id/block', requireAuth, (req, res) => setBlock(req, res, true));
profilesRouter.delete('/:id/block', requireAuth, (req, res) => setBlock(req, res, false));

// ---------- report ----------

const reportSchema = z.object({
  reason: z
    .string({ required_error: 'reason is required', invalid_type_error: 'reason must be a string' })
    .trim()
    .min(1, 'reason must not be empty')
    .max(300, 'reason must be at most 300 characters'),
});

// POST /users/:id/report { reason } -> { ok: true }  (one report per reporter/target; repeats are no-ops)
profilesRouter.post('/:id/report', requireAuth, async (req: Request, res: Response) => {
  const target = parseUserParam(req, res);
  if (!target) return;
  const parsed = reportSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const me = req.user!.sub;
  if (target === me) {
    return res.status(400).json({ error: 'cannot_report_self', message: 'You cannot report yourself.' });
  }
  const rl = await hitRateLimit(`rl:profile:report:${me}`, REPORTS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [target]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'user_not_found' });
    await pool.query(
      'INSERT INTO user_reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [me, target, parsed.data.reason]
    );
    logger.warn({ reporter: me, reported: target, reason: parsed.data.reason }, 'profiles: user reported');
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'report user', { me, target });
  }
});

// ---------- public profile ----------

// GET /users/:id/profile -> { profile }  (no email) + blockedByMe for the viewer
profilesRouter.get('/:id/profile', requireAuth, async (req: Request, res: Response) => {
  const id = parseUserParam(req, res);
  if (!id) return;
  try {
    const row = await loadProfile(id);
    if (!row) return res.status(404).json({ error: 'user_not_found' });
    const blocked = await pool.query('SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [
      req.user!.sub,
      id,
    ]);
    res.json({ profile: { ...toPublic(row), blockedByMe: blocked.rows.length > 0 } });
  } catch (err) {
    fail(res, err, 'get profile', { id });
  }
});
