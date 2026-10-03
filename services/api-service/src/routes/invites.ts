import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { requireAuth } from '../middleware/requireAuth';
import { sendInvalidInput } from '../validation';
import type {
  ChannelInvite,
  CreatedInvite,
  InviteAcceptResponse,
  InviteInvalidReason,
  InvitePreview,
  InviteStatus,
} from '@streaming/shared-types';
import {
  loadChannelRow,
  privateMemberCapMessage,
  rejectStreamChannel,
  resolveChannel,
  sendForbidden,
  toChannel,
  withTransaction,
  countMembers,
} from '../channelService';

/** /channels/:id/invites (owner / mod). */
export const channelInvitesRouter = Router();
/** /invites/:token (any signed-in user). */
export const invitesRouter = Router();

const DEFAULT_EXPIRY_HOURS = 24 * 7;
const MAX_EXPIRY_HOURS = 24 * 30;
const MAX_ACTIVE_INVITES_PER_CHANNEL = 50;

const createInviteSchema = z.object({
  expiresInHours: z
    .number({ invalid_type_error: 'expiresInHours must be a number' })
    .int('expiresInHours must be a whole number of hours')
    .min(1, 'expiresInHours must be at least 1')
    .max(MAX_EXPIRY_HOURS, `expiresInHours must be at most ${MAX_EXPIRY_HOURS}`)
    .optional(),
  maxUses: z
    .number({ invalid_type_error: 'maxUses must be a number' })
    .int('maxUses must be a whole number')
    .min(1, 'maxUses must be at least 1')
    .max(1000, 'maxUses must be at most 1000')
    .nullable()
    .optional(),
});

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url'); // 192 bits, URL-safe
}

function invalidReason(inv: any, now = Date.now()): Exclude<InviteInvalidReason, 'not_found'> | undefined {
  if (inv.revoked_at) return 'revoked';
  if (new Date(inv.expires_at).getTime() <= now) return 'expired';
  if (inv.max_uses !== null && inv.uses >= inv.max_uses) return 'exhausted';
  return undefined;
}

function internalError(res: Response, err: unknown, msg: string) {
  logger.error({ err }, msg);
  return res.status(500).json({ error: 'internal_error' });
}

const invalidMessages: Record<string, string> = {
  expired: 'This invite link has expired.',
  revoked: 'This invite link was revoked.',
  exhausted: 'This invite link has reached its maximum number of uses.',
};

// --- Channel-scoped (owner / mod) -----------------------------------------

channelInvitesRouter.post('/:id/invites', requireAuth, async (req: Request, res: Response) => {
  const parsed = createInviteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.canManageMembers) return sendForbidden(res, 'Only the owner or a moderator can create invites.');

    const { rows: active } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM channel_invites
       WHERE channel_id = $1 AND revoked_at IS NULL AND expires_at > now()
         AND (max_uses IS NULL OR uses < max_uses)`,
      [ch.row.id]
    );
    if (active[0].n >= MAX_ACTIVE_INVITES_PER_CHANNEL) {
      return res.status(409).json({
        error: 'too_many_invites',
        message: `This channel already has ${MAX_ACTIVE_INVITES_PER_CHANNEL} active invites. Revoke one first.`,
      });
    }

    const hours = parsed.data.expiresInHours ?? DEFAULT_EXPIRY_HOURS;
    const maxUses = parsed.data.maxUses ?? null;
    const { rows } = await pool.query(
      `INSERT INTO channel_invites (token, channel_id, created_by, expires_at, max_uses)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5)
       RETURNING token, expires_at, max_uses`,
      [newToken(), ch.row.id, req.user!.sub, hours, maxUses]
    );
    logger.info({ channelId: ch.row.id, by: req.user!.sub, hours, maxUses }, 'invite created');
    const body: CreatedInvite = { token: rows[0].token, expiresAt: rows[0].expires_at, maxUses: rows[0].max_uses };
    res.status(201).json(body);
  } catch (err) {
    internalError(res, err, 'create invite failed');
  }
});

channelInvitesRouter.get('/:id/invites', requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.canManageMembers) return sendForbidden(res, 'Only the owner or a moderator can view invites.');
    const { rows } = await pool.query(
      `SELECT i.*, u.username AS created_by_username
       FROM channel_invites i LEFT JOIN users u ON u.id = i.created_by
       WHERE i.channel_id = $1 AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC LIMIT 100`,
      [ch.row.id]
    );
    const invites: ChannelInvite[] = rows.map((r) => {
      const reason = invalidReason(r);
      const status: InviteStatus = reason === 'expired' ? 'expired' : reason === 'exhausted' ? 'exhausted' : 'active';
      return {
        token: r.token,
        createdBy: r.created_by,
        createdByUsername: r.created_by_username ?? 'unknown',
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        maxUses: r.max_uses,
        uses: r.uses,
        status,
      };
    });
    res.json({ invites });
  } catch (err) {
    internalError(res, err, 'list invites failed');
  }
});

// Revoke (idempotent for an already-revoked invite of this channel).
channelInvitesRouter.delete('/:id/invites/:token', requireAuth, async (req: Request, res: Response) => {
  try {
    const ch = await resolveChannel(req, res);
    if (!ch) return;
    if (rejectStreamChannel(res, ch)) return;
    if (!ch.canManageMembers) return sendForbidden(res, 'Only the owner or a moderator can revoke invites.');
    const { rows } = await pool.query(
      `UPDATE channel_invites SET revoked_at = COALESCE(revoked_at, now())
       WHERE token = $1 AND channel_id = $2 RETURNING token`,
      [req.params.token.slice(0, 128), ch.row.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'invite_not_found', message: 'Invite not found.' });
    logger.info({ channelId: ch.row.id, by: req.user!.sub }, 'invite revoked');
    res.json({ ok: true });
  } catch (err) {
    internalError(res, err, 'revoke invite failed');
  }
});

// --- Public (signed-in) ----------------------------------------------------

// Always 200; check `valid` / `reason`.
invitesRouter.get('/:token', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, c.name, c.kind, c.visibility,
              (SELECT COUNT(*)::int FROM channel_members WHERE channel_id = c.id) AS member_count,
              EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $2) AS already_member
       FROM channel_invites i JOIN channels c ON c.id = i.channel_id
       WHERE i.token = $1`,
      [req.params.token.slice(0, 128), req.user!.sub]
    );
    const inv = rows[0];
    if (!inv) {
      const body: InvitePreview = { valid: false, reason: 'not_found', channel: null, alreadyMember: false };
      return res.json(body);
    }
    const reason = invalidReason(inv);
    const body: InvitePreview = {
      valid: !reason,
      ...(reason ? { reason } : {}),
      channel: {
        id: inv.channel_id,
        name: inv.name,
        kind: inv.kind,
        visibility: inv.visibility,
        memberCount: inv.member_count,
      },
      alreadyMember: inv.already_member,
    };
    res.json(body);
  } catch (err) {
    internalError(res, err, 'preview invite failed');
  }
});

// Atomic: channel row lock -> invite row lock -> membership + use count in one tx.
invitesRouter.post('/:token/accept', requireAuth, async (req: Request, res: Response) => {
  const token = req.params.token.slice(0, 128);
  const userId = req.user!.sub;
  try {
    const pre = await pool.query('SELECT channel_id FROM channel_invites WHERE token = $1', [token]);
    if (!pre.rows[0]) return res.status(404).json({ error: 'invite_not_found', message: 'This invite link is not valid.' });
    const channelId: string = pre.rows[0].channel_id;

    type Outcome =
      | { kind: 'ok'; alreadyMember: boolean }
      | { kind: 'invalid'; reason: Exclude<InviteInvalidReason, 'not_found'> }
      | { kind: 'gone' }
      | { kind: 'full' };

    const outcome = await withTransaction<Outcome>(async (client) => {
      // The channel lock serialises every membership change on this channel (accepts, direct adds).
      const ch = await client.query('SELECT visibility, kind FROM channels WHERE id = $1 FOR UPDATE', [channelId]);
      if (!ch.rows[0]) return { kind: 'gone' };

      const member = await client.query('SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2', [
        channelId,
        userId,
      ]);
      if (member.rows[0]) return { kind: 'ok', alreadyMember: true }; // idempotent: no use consumed

      const inv = (await client.query('SELECT * FROM channel_invites WHERE token = $1 FOR UPDATE', [token])).rows[0];
      if (!inv) return { kind: 'gone' };
      const reason = invalidReason(inv);
      if (reason) return { kind: 'invalid', reason };

      if (ch.rows[0].visibility === 'private' && (await countMembers(channelId, client)) >= env.PRIVATE_CHANNEL_MAX_MEMBERS) {
        return { kind: 'full' };
      }
      await client.query(
        `INSERT INTO channel_members (channel_id, user_id, role, added_by) VALUES ($1, $2, 'member', $3)`,
        [channelId, userId, inv.created_by]
      );
      await client.query('UPDATE channel_invites SET uses = uses + 1 WHERE token = $1', [token]);
      return { kind: 'ok', alreadyMember: false };
    });

    if (outcome.kind === 'gone') {
      return res.status(404).json({ error: 'invite_not_found', message: 'This invite link is not valid.' });
    }
    if (outcome.kind === 'invalid') {
      return res
        .status(410)
        .json({ error: `invite_${outcome.reason}`, message: invalidMessages[outcome.reason] });
    }
    if (outcome.kind === 'full') {
      return res.status(409).json({ error: 'channel_full', message: privateMemberCapMessage() });
    }
    logger.info({ channelId, userId, alreadyMember: outcome.alreadyMember }, 'invite accepted');
    const row = await loadChannelRow(channelId, userId);
    const body: InviteAcceptResponse = { channel: toChannel(row), alreadyMember: outcome.alreadyMember };
    res.json(body);
  } catch (err) {
    internalError(res, err, 'accept invite failed');
  }
});
