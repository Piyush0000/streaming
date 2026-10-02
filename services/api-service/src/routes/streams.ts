import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { logger } from '../logger';
import { redisPub } from '../redis';
import { requireAuth } from '../middleware/requireAuth';
import { sendInvalidInput, uuidSchema } from '../validation';
import { publishStreamEvent } from '@streaming/events';
import { STREAM_MAX_WARNINGS } from '@streaming/shared-types';
import type {
  ModerationResult,
  StreamEvent,
  StreamModerationEvent,
} from '@streaming/shared-types';
import {
  computeEligibility,
  getModerationState,
  getStreamRow,
  hasAcceptedGuidelines,
  isAdminEmail,
  listModerationState,
  toStream,
  viewerState,
} from '../streamService';

export const streamsRouter = Router();

const createStreamSchema = z.object({
  title: z
    .string({ required_error: 'title is required', invalid_type_error: 'title must be a string' })
    .trim()
    .min(1, 'title must not be empty')
    .max(100, 'title must be at most 100 characters'),
  description: z
    .string({ invalid_type_error: 'description must be a string' })
    .trim()
    .max(500, 'description must be at most 500 characters')
    .optional(),
});

const moderationSchema = z.object({
  targetUserId: z
    .string({ required_error: 'targetUserId is required', invalid_type_error: 'targetUserId must be a string' })
    .uuid('targetUserId must be a valid UUID'),
  action: z.enum(['warn', 'mute', 'unmute', 'kick', 'ban', 'unban'], {
    errorMap: () => ({ message: 'action must be one of warn, mute, unmute, kick, ban, unban' }),
  }),
  reason: z.string().trim().max(300, 'reason must be at most 300 characters').optional(),
});

const listQuerySchema = z.object({
  status: z
    .enum(['live', 'ended', 'all'], { errorMap: () => ({ message: 'status must be live, ended or all' }) })
    .default('live'),
});

/** Best-effort publish: the DB write already committed, so a Redis failure is logged loudly, not fatal. */
export async function emitStreamEvent(event: StreamEvent): Promise<void> {
  try {
    await publishStreamEvent(redisPub, event);
  } catch (err) {
    logger.error({ err, event }, 'failed to publish stream event (clients rely on authoritative checks)');
  }
}

/** Ends a live stream. Returns the ended row, or undefined if it was not live. */
export async function endStream(id: string): Promise<any | undefined> {
  const { rows } = await pool.query(
    `UPDATE streams SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'live' RETURNING *`,
    [id]
  );
  if (rows[0]) {
    logger.info({ streamId: id }, 'stream ended');
    await emitStreamEvent({ type: 'stream-ended', streamId: id });
  }
  return rows[0];
}

function parseId(req: Request, res: Response): string | undefined {
  const parsed = uuidSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_input',
      message: `id: ${parsed.error.issues[0].message}`,
      details: parsed.error.issues,
    });
    return undefined;
  }
  return parsed.data;
}

// GET /streams/eligibility  (declared BEFORE /:id)
streamsRouter.get('/eligibility', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await computeEligibility(req.user!.sub, req.user!.email));
  } catch (err) {
    logger.error({ err, userId: req.user!.sub }, 'eligibility failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /streams?status=live|ended|all (default live)
streamsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  try {
    const { status } = parsed.data;
    const { rows } = await pool.query(
      `SELECT * FROM streams WHERE ($1 = 'all' OR status = $1) ORDER BY started_at DESC LIMIT 100`,
      [status]
    );
    res.json({ streams: rows.map(toStream) });
  } catch (err) {
    logger.error({ err }, 'list streams failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /streams { title, description? }
streamsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createStreamSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;

  try {
    if (!(await hasAcceptedGuidelines(user.sub))) {
      return res.status(403).json({
        error: 'guidelines_not_accepted',
        message: 'You must accept the current community guidelines before hosting a stream.',
      });
    }
    const eligibility = await computeEligibility(user.sub, user.email);
    if (!eligibility.eligible) {
      logger.info({ userId: user.sub, eligibility }, 'stream creation denied: not eligible');
      return res.status(403).json({
        error: 'not_eligible',
        message: 'You are not eligible to host a stream.',
        ...eligibility,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT id FROM streams WHERE host_id = $1 AND status = 'live'`,
        [user.sub]
      );
      if (existing.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'already_live',
          message: 'You already have a live stream. End it before starting another.',
          streamId: existing.rows[0].id,
        });
      }
      const name = `stream-${crypto.randomBytes(5).toString('hex')}`;
      const channel = await client.query(
        `INSERT INTO channels (name, topic, kind, created_by) VALUES ($1, $2, 'stream', $3) RETURNING id`,
        [name, parsed.data.title.slice(0, 256), user.sub]
      );
      const stream = await client.query(
        `INSERT INTO streams (id, host_id, host_username, title, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [channel.rows[0].id, user.sub, user.username, parsed.data.title, parsed.data.description ?? null]
      );
      await client.query('COMMIT');
      logger.info({ streamId: stream.rows[0].id, hostId: user.sub }, 'stream created');
      return res.status(201).json({ stream: toStream(stream.rows[0]) });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Race: two concurrent creates both passed the SELECT; the partial unique index decides.
      if (err?.code === '23505') {
        return res.status(409).json({
          error: 'already_live',
          message: 'You already have a live stream. End it before starting another.',
        });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err, userId: user.sub }, 'create stream failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /streams/:id -> { stream, me: { isHost, isAdmin, banned, muted, warnings } }
streamsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const row = await getStreamRow(id);
    if (!row) return res.status(404).json({ error: 'stream_not_found' });
    const me = await viewerState(row, req.user!.sub, req.user!.email);
    res.json({ stream: toStream(row), me });
  } catch (err) {
    logger.error({ err, streamId: id }, 'get stream failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /streams/:id/end  (host or admin)
streamsRouter.post('/:id/end', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const row = await getStreamRow(id);
    if (!row) return res.status(404).json({ error: 'stream_not_found' });
    if (row.host_id !== req.user!.sub && !isAdminEmail(req.user!.email)) {
      return res.status(403).json({ error: 'forbidden', message: 'Only the host or an admin can end this stream.' });
    }
    const ended = await endStream(id);
    if (!ended) return res.status(409).json({ error: 'stream_already_ended' });
    res.json({ stream: toStream(ended) });
  } catch (err) {
    logger.error({ err, streamId: id }, 'end stream failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /streams/:id/moderation  (host or admin) -> { users: ModerationUserState[] }
streamsRouter.get('/:id/moderation', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    const row = await getStreamRow(id);
    if (!row) return res.status(404).json({ error: 'stream_not_found' });
    if (row.host_id !== req.user!.sub && !isAdminEmail(req.user!.email)) {
      return res.status(403).json({ error: 'forbidden', message: 'Only the host or an admin can view moderation state.' });
    }
    res.json({ users: await listModerationState(id), maxWarnings: STREAM_MAX_WARNINGS });
  } catch (err) {
    logger.error({ err, streamId: id }, 'list moderation failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /streams/:id/moderation { targetUserId, action, reason? }  (host or admin)
streamsRouter.post('/:id/moderation', requireAuth, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = moderationSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const { targetUserId, action, reason } = parsed.data;
  const actor = req.user!;

  try {
    const stream = await getStreamRow(id);
    if (!stream) return res.status(404).json({ error: 'stream_not_found' });
    if (stream.host_id !== actor.sub && !isAdminEmail(actor.email)) {
      return res.status(403).json({ error: 'forbidden', message: 'Only the host or an admin can moderate this stream.' });
    }
    if (stream.status !== 'live') {
      return res.status(409).json({ error: 'stream_ended', message: 'This stream has ended.' });
    }
    if (targetUserId === actor.sub) {
      return res.status(400).json({ error: 'cannot_target_self', message: 'You cannot moderate yourself.' });
    }
    if (targetUserId === stream.host_id) {
      return res.status(403).json({ error: 'cannot_target_host', message: 'The host cannot be moderated.' });
    }
    const target = await pool.query('SELECT id, email FROM users WHERE id = $1', [targetUserId]);
    if (!target.rows[0]) return res.status(404).json({ error: 'user_not_found' });
    if (isAdminEmail(target.rows[0].email)) {
      return res.status(403).json({ error: 'cannot_target_admin', message: 'Platform admins cannot be moderated.' });
    }

    // Serialize concurrent actions on the same (stream, target) so the
    // warning count / derived state can't race (e.g. two simultaneous warns).
    const client = await pool.connect();
    let result: ModerationResult;
    let event: StreamModerationEvent;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mod:${id}:${targetUserId}`]);
      const state = await getModerationState(id, targetUserId, client);

      const conflict = (code: string, message: string) => {
        res.status(409).json({ error: code, message });
        return client.query('ROLLBACK');
      };
      if (action === 'mute' && state.muted) { await conflict('already_muted', 'User is already muted.'); return; }
      if (action === 'unmute' && !state.muted) { await conflict('not_muted', 'User is not muted.'); return; }
      if (action === 'ban' && state.banned) { await conflict('already_banned', 'User is already banned.'); return; }
      if (action === 'unban' && !state.banned) { await conflict('not_banned', 'User is not banned.'); return; }
      if (action === 'warn' && state.banned) { await conflict('already_banned', 'User is banned; cannot warn.'); return; }

      let recordedKind = action;
      let recordedReason = reason ?? null;
      let warningsAfter: number | undefined;
      let autoEscalated = false;

      if (action === 'warn') {
        if (state.warnings >= STREAM_MAX_WARNINGS) {
          // Warning limit exceeded: the punishment is an automatic ban.
          recordedKind = 'ban';
          recordedReason = `Auto: exceeded ${STREAM_MAX_WARNINGS} warnings`;
          warningsAfter = STREAM_MAX_WARNINGS;
          autoEscalated = true;
        } else {
          warningsAfter = state.warnings + 1;
        }
      }

      await client.query(
        `INSERT INTO moderation_actions (stream_id, target_user_id, actor_user_id, kind, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, targetUserId, actor.sub, recordedKind, recordedReason]
      );
      await client.query('COMMIT');

      result = autoEscalated
        ? { action: 'ban', autoEscalated: true, warnings: STREAM_MAX_WARNINGS }
        : action === 'warn'
          ? { action: 'warn', warnings: warningsAfter, max: STREAM_MAX_WARNINGS }
          : { action: recordedKind };
      event = {
        type: 'moderation',
        streamId: id,
        targetUserId,
        action: recordedKind,
        byUserId: actor.sub,
        ...(recordedReason ? { reason: recordedReason } : {}),
        ...(warningsAfter !== undefined ? { warnings: warningsAfter } : {}),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    logger.info({ streamId: id, actor: actor.sub, targetUserId, requested: action, recorded: result.action, autoEscalated: result.autoEscalated === true }, 'moderation action recorded');
    await emitStreamEvent(event);
    res.json(result);
  } catch (err) {
    logger.error({ err, streamId: id }, 'moderation failed');
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  }
});
