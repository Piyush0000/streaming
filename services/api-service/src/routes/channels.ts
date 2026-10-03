import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { requireAuth } from '../middleware/requireAuth';
import { sendInvalidInput } from '../validation';
import type { ChannelMember, ChannelRole } from '@streaming/shared-types';
import {
  listChannelRows,
  loadChannelRow,
  parseUuidParam,
  privateMemberCapMessage,
  rejectStreamChannel,
  resolveChannel,
  sendForbidden,
  toChannel,
  withTransaction,
  countMembers,
} from '../channelService';
import { emitStreamEvent } from './streams';

export const channelsRouter = Router();

const maxPeersMessage = `maxParticipants must be an integer between 2 and ${env.VOICE_ROOM_MAX_PEERS}`;
const maxParticipantsSchema = z
  .number({ invalid_type_error: 'maxParticipants must be a number' })
  .int(maxPeersMessage)
  .min(2, maxPeersMessage)
  .max(env.VOICE_ROOM_MAX_PEERS, maxPeersMessage);

const nameSchema = z
  .string({ required_error: 'name is required', invalid_type_error: 'name must be a string' })
  .min(2, 'name must be at least 2 characters')
  .max(64, 'name must be at most 64 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'name may only contain letters, numbers, underscores and hyphens');

const visibilitySchema = z.enum(['public', 'private'], {
  errorMap: () => ({ message: 'visibility must be public or private' }),
});

const createChannelSchema = z.object({
  name: nameSchema,
  topic: z.string({ invalid_type_error: 'topic must be a string' }).max(256, 'topic must be at most 256 characters').optional(),
  kind: z.enum(['text', 'voice'], { errorMap: () => ({ message: 'kind must be text or voice' }) }).default('text'),
  visibility: visibilitySchema.default('public'),
  maxParticipants: maxParticipantsSchema.optional(),
});

const updateChannelSchema = z
  .object({
    name: nameSchema.optional(),
    topic: z
      .string({ invalid_type_error: 'topic must be a string or null' })
      .max(256, 'topic must be at most 256 characters')
      .nullable()
      .optional(),
    visibility: visibilitySchema.optional(),
    maxParticipants: maxParticipantsSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'provide at least one field to change' });

const addMemberSchema = z
  .object({
    username: z.string({ invalid_type_error: 'username must be a string' }).trim().min(1, 'username must not be empty').max(64).optional(),
    email: z.string({ invalid_type_error: 'email must be a string' }).trim().min(1, 'email must not be empty').max(320).optional(),
  })
  .refine((v) => (v.username !== undefined) !== (v.email !== undefined), {
    message: 'provide exactly one of username or email',
  });

const roleSchema = z.object({
  role: z.enum(['mod', 'member'], { errorMap: () => ({ message: 'role must be mod or member' }) }),
});

function internalError(res: Response, err: unknown, msg: string, extra: Record<string, unknown> = {}) {
  logger.error({ err, ...extra }, msg);
  return res.status(500).json({ error: 'internal_error' });
}

// --- Channels -------------------------------------------------------------

// Public channels + private channels the caller belongs to. kind='stream' is
// never listed (the UI lists streams via GET /streams?status=live).
channelsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await listChannelRows(req.user!.sub);
    res.json({ channels: rows.map(toChannel) });
  } catch (err) {
    internalError(res, err, 'list channels failed');
  }
});

// Private + not a member -> 404 channel_not_found (same as an unknown id).
channelsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    res.json({ channel: toChannel(ch.row) });
  } catch (err) {
    internalError(res, err, 'get channel failed');
  }
});

channelsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const d = parsed.data;
  if (d.maxParticipants !== undefined && d.kind !== 'voice') {
    return res.status(400).json({
      error: 'invalid_input',
      message: 'maxParticipants: only voice channels have a participant limit',
    });
  }
  const userId = req.user!.sub;
  try {
    const channelId = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO channels (name, topic, kind, created_by, visibility, max_participants)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [d.name, d.topic ?? null, d.kind, userId, d.visibility, d.maxParticipants ?? null]
      );
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id, role, added_by) VALUES ($1, $2, 'owner', $2)`,
        [ins.rows[0].id, userId]
      );
      return ins.rows[0].id as string;
    });
    const row = await loadChannelRow(channelId, userId);
    res.status(201).json({ channel: toChannel(row) });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'channel_name_taken', message: 'A channel with that name already exists.' });
    }
    internalError(res, err, 'create channel failed');
  }
});

// Owner only.
channelsRouter.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const parsed = updateChannelSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const d = parsed.data;
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.isOwner) return sendForbidden(res, 'Only the channel owner can edit this channel.');
    if (d.maxParticipants != null && ch.row.kind !== 'voice') {
      return res.status(400).json({
        error: 'invalid_input',
        message: 'maxParticipants: only voice channels have a participant limit',
      });
    }

    const visibilityChanged = d.visibility !== undefined && d.visibility !== ch.row.visibility;
    if (visibilityChanged && d.visibility === 'private') {
      const n = await countMembers(ch.row.id);
      if (n > env.PRIVATE_CHANNEL_MAX_MEMBERS) {
        return res.status(409).json({
          error: 'channel_full',
          message: `This channel has ${n} members, more than the private channel limit (${env.PRIVATE_CHANNEL_MAX_MEMBERS}).`,
        });
      }
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (d.name !== undefined) add('name', d.name);
    if (d.topic !== undefined) add('topic', d.topic);
    if (d.visibility !== undefined) add('visibility', d.visibility);
    if (d.maxParticipants !== undefined) add('max_participants', d.maxParticipants);
    vals.push(ch.row.id);
    await pool.query(`UPDATE channels SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);

    if (visibilityChanged) {
      await emitStreamEvent({ type: 'channel-visibility-changed', channelId: ch.row.id, visibility: d.visibility });
    }
    logger.info({ channelId: ch.row.id, by: req.user!.sub, changes: Object.keys(d) }, 'channel updated');
    res.json({ channel: toChannel(await loadChannelRow(ch.row.id, req.user!.sub)) });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'channel_name_taken', message: 'A channel with that name already exists.' });
    }
    internalError(res, err, 'update channel failed');
  }
});

// Owner only. Cascades members + invites; chat-service purges the messages and
// ejects live participants on the `channel-deleted` event. Uploaded files stay on disk.
channelsRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.isOwner) return sendForbidden(res, 'Only the channel owner can delete this channel.');
    await pool.query('DELETE FROM channels WHERE id = $1', [ch.row.id]);
    await emitStreamEvent({ type: 'channel-deleted', channelId: ch.row.id });
    logger.info({ channelId: ch.row.id, by: req.user!.sub }, 'channel deleted');
    res.json({ ok: true });
  } catch (err) {
    internalError(res, err, 'delete channel failed');
  }
});

// --- Members --------------------------------------------------------------

const ROLE_ORDER = `CASE m.role WHEN 'owner' THEN 0 WHEN 'mod' THEN 1 ELSE 2 END`;

function toMember(row: any): ChannelMember {
  return { userId: row.user_id, username: row.username ?? 'unknown', role: row.role, joinedAt: row.joined_at };
}

channelsRouter.get('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    const { rows } = await pool.query(
      `SELECT m.user_id, u.username, m.role, m.joined_at
       FROM channel_members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = $1
       ORDER BY ${ROLE_ORDER}, m.joined_at ASC`,
      [ch.row.id]
    );
    res.json({ members: rows.map(toMember) });
  } catch (err) {
    internalError(res, err, 'list members failed');
  }
});

// Owner / mod: add an existing user by username or email as a plain member.
channelsRouter.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.canManageMembers) return sendForbidden(res, 'Only the owner or a moderator can add members.');

    const { username, email } = parsed.data;
    const { rows: found } =
      username !== undefined
        ? await pool.query(
            `SELECT id, username FROM users WHERE lower(username) = lower($1)
             ORDER BY (username = $1) DESC LIMIT 1`,
            [username]
          )
        : await pool.query(`SELECT id, username FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    const target = found[0];
    if (!target) {
      return res.status(404).json({ error: 'user_not_found', message: 'No user matches that username or email.' });
    }

    const result = await withTransaction(async (client) => {
      // Row lock on the channel serialises concurrent adds / invite accepts so the cap holds.
      const lock = await client.query('SELECT visibility FROM channels WHERE id = $1 FOR UPDATE', [ch.row.id]);
      if (!lock.rows[0]) return 'gone' as const;
      const existing = await client.query(
        'SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2',
        [ch.row.id, target.id]
      );
      if (existing.rows[0]) return 'already' as const;
      if (lock.rows[0].visibility === 'private' && (await countMembers(ch.row.id, client)) >= env.PRIVATE_CHANNEL_MAX_MEMBERS) {
        return 'full' as const;
      }
      const ins = await client.query(
        `INSERT INTO channel_members (channel_id, user_id, role, added_by) VALUES ($1, $2, 'member', $3)
         RETURNING user_id, role, joined_at`,
        [ch.row.id, target.id, req.user!.sub]
      );
      return { ...ins.rows[0], username: target.username };
    });

    if (result === 'gone') return res.status(404).json({ error: 'channel_not_found', message: 'Channel not found.' });
    if (result === 'already') {
      return res.status(409).json({ error: 'already_member', message: `${target.username} is already a member.` });
    }
    if (result === 'full') return res.status(409).json({ error: 'channel_full', message: privateMemberCapMessage() });
    logger.info({ channelId: ch.row.id, by: req.user!.sub, userId: target.id }, 'member added');
    res.status(201).json({ member: toMember(result) });
  } catch (err) {
    internalError(res, err, 'add member failed');
  }
});

// Remove a member, or leave (userId === caller).
channelsRouter.delete('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetId = parseUuidParam(res, 'userId', req.params.userId);
  if (!targetId) return;
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    const me = req.user!.sub;
    const self = targetId === me;

    const { rows } = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [
      ch.row.id,
      targetId,
    ]);
    const targetRole = (rows[0]?.role ?? null) as ChannelRole | null;

    if (self) {
      if (!targetRole) return res.status(404).json({ error: 'member_not_found', message: 'You are not a member of this channel.' });
      if (targetRole === 'owner') {
        return sendForbidden(res, 'The owner cannot leave the channel. Delete the channel instead.', 'owner_cannot_leave');
      }
    } else {
      if (!ch.canManageMembers) return sendForbidden(res, 'Only the owner or a moderator can remove members.');
      if (!targetRole) return res.status(404).json({ error: 'member_not_found', message: 'That user is not a member.' });
      if (targetRole === 'owner') return sendForbidden(res, 'The channel owner cannot be removed.', 'cannot_remove_owner');
      if (targetRole === 'mod' && !ch.isOwner) return sendForbidden(res, 'Moderators cannot remove other moderators.');
    }

    // Guard on role so a concurrent role change cannot slip an owner/mod past the checks above.
    const del = await pool.query(
      `DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2 AND role = $3`,
      [ch.row.id, targetId, targetRole]
    );
    if ((del.rowCount ?? 0) === 0) {
      return res.status(409).json({ error: 'forbidden', message: 'Membership changed concurrently; please retry.' });
    }
    if (ch.row.visibility === 'private') {
      await emitStreamEvent({
        type: 'channel-member-removed',
        channelId: ch.row.id,
        userId: targetId,
        reason: self ? 'left' : 'removed',
      });
    }
    logger.info({ channelId: ch.row.id, by: me, userId: targetId, self }, 'member removed');
    res.json({ ok: true });
  } catch (err) {
    internalError(res, err, 'remove member failed');
  }
});

// Owner only: promote to mod / demote to member.
channelsRouter.patch('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  const targetId = parseUuidParam(res, 'userId', req.params.userId);
  if (!targetId) return;
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.isOwner) return sendForbidden(res, 'Only the channel owner can change roles.');
    const { rows } = await pool.query('SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2', [
      ch.row.id,
      targetId,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'member_not_found', message: 'That user is not a member.' });
    if (rows[0].role === 'owner') return sendForbidden(res, "The owner's role cannot be changed.", 'cannot_change_owner');
    const upd = await pool.query(
      `UPDATE channel_members SET role = $3
       WHERE channel_id = $1 AND user_id = $2 AND role <> 'owner'
       RETURNING user_id, role, joined_at, (SELECT username FROM users WHERE id = $2) AS username`,
      [ch.row.id, targetId, parsed.data.role]
    );
    if (!upd.rows[0]) return res.status(404).json({ error: 'member_not_found', message: 'That user is not a member.' });
    logger.info({ channelId: ch.row.id, by: req.user!.sub, userId: targetId, role: parsed.data.role }, 'member role changed');
    res.json({ member: toMember(upd.rows[0]) });
  } catch (err) {
    internalError(res, err, 'change role failed');
  }
});
