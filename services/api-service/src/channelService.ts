import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import type { Channel, ChannelRole } from '@streaming/shared-types';
import { pool } from './db';
import { env } from './env';
import { logger } from './logger';
import { uuidSchema } from './validation';
import { effectiveMaxParticipants, isAdminEmail } from './streamService';

export type Queryable = Pick<PoolClient, 'query'>;

/** A channel row joined with the caller's role and the member count. */
const CHANNEL_VIEW_SQL = `
  SELECT c.*, m.role AS my_role,
         (SELECT COUNT(*)::int FROM channel_members WHERE channel_id = c.id) AS member_count
  FROM channels c
  LEFT JOIN channel_members m ON m.channel_id = c.id AND m.user_id = $1`;

export function toChannel(row: any): Channel {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    kind: row.kind,
    createdBy: row.created_by,
    createdAt: row.created_at,
    visibility: row.visibility,
    maxParticipants: row.max_participants ?? null,
    effectiveMaxParticipants: effectiveMaxParticipants(row.kind, row.max_participants),
    myRole: (row.my_role ?? null) as ChannelRole | null,
    memberCount: row.member_count ?? 0,
  };
}

export async function listChannelRows(userId: string): Promise<any[]> {
  const { rows } = await pool.query(
    `${CHANNEL_VIEW_SQL}
     WHERE c.kind <> 'stream' AND (c.visibility = 'public' OR m.user_id IS NOT NULL)
     ORDER BY c.created_at ASC`,
    [userId]
  );
  return rows;
}

export async function loadChannelRow(channelId: string, userId: string, db: Queryable = pool): Promise<any | undefined> {
  const { rows } = await db.query(`${CHANNEL_VIEW_SQL} WHERE c.id = $2`, [userId, channelId]);
  return rows[0];
}

export function parseUuidParam(
  res: Response,
  name: string,
  value: string | undefined
): string | undefined {
  const parsed = uuidSchema.safeParse(value);
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

export function sendChannelNotFound(res: Response): Response {
  return res.status(404).json({ error: 'channel_not_found', message: 'Channel not found.' });
}

export function sendForbidden(res: Response, message: string, error = 'forbidden'): Response {
  return res.status(403).json({ error, message });
}

export interface ResolvedChannel {
  row: any;
  role: ChannelRole | null;
  isOwner: boolean;
  /** owner or mod */
  canManageMembers: boolean;
}

/**
 * Loads the channel for the caller. Responds 404 `channel_not_found` (identical
 * for "does not exist" and "private and you are not a member") so a private
 * channel's existence never leaks. Platform admins (STREAM_ADMIN_EMAILS) may
 * view private channels but hold no management role there.
 * Returns undefined after having sent the response.
 */
export async function resolveChannel(req: Request, res: Response): Promise<ResolvedChannel | undefined> {
  const id = parseUuidParam(res, 'id', req.params.id);
  if (!id) return undefined;
  const row = await loadChannelRow(id, req.user!.sub);
  const role = (row?.my_role ?? null) as ChannelRole | null;
  if (!row || (row.visibility === 'private' && !role && !isAdminEmail(req.user!.email))) {
    sendChannelNotFound(res);
    return undefined;
  }
  return { row, role, isOwner: role === 'owner', canManageMembers: role === 'owner' || role === 'mod' };
}

/** Management endpoints (edit/delete/members/invites) do not apply to stream channels. */
export function rejectStreamChannel(res: Response, ch: ResolvedChannel): boolean {
  if (ch.row.kind === 'stream') {
    res.status(400).json({
      error: 'unsupported_channel_kind',
      message: 'Stream channels are managed through the /streams endpoints.',
    });
    return true;
  }
  return false;
}

export async function countMembers(channelId: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM channel_members WHERE channel_id = $1', [channelId]);
  return rows[0].n;
}

export function privateMemberCapMessage(): string {
  return `This private channel has reached its member limit (${env.PRIVATE_CHANNEL_MAX_MEMBERS}).`;
}

/** Runs `fn` in a transaction on a dedicated client; rolls back on throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) => logger.error({ err: rollbackErr }, 'rollback failed'));
    throw err;
  } finally {
    client.release();
  }
}
