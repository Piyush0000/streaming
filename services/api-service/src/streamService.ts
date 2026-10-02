import type { PoolClient } from 'pg';
import type {
  Stream,
  StreamEligibility,
  StreamViewerState,
  ChannelAccess,
  ModerationUserState,
} from '@streaming/shared-types';
import { pool } from './db';
import { env } from './env';
import { checkPremium } from './lr21Bridge';
import { GUIDELINES_VERSION } from './guidelines';

type Queryable = Pick<PoolClient, 'query'>;

export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && env.STREAM_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export function toStream(row: any): Stream {
  return {
    id: row.id,
    hostId: row.host_id,
    hostUsername: row.host_username,
    title: row.title,
    description: row.description,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export async function getStreamRow(id: string, db: Queryable = pool): Promise<any | undefined> {
  const { rows } = await db.query('SELECT * FROM streams WHERE id = $1', [id]);
  return rows[0];
}

export interface ModerationState {
  warnings: number;
  muted: boolean;
  banned: boolean;
}

/** Derives a user's current standing in a stream from the append-only moderation log. */
export async function getModerationState(
  streamId: string,
  userId: string,
  db: Queryable = pool
): Promise<ModerationState> {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE kind = 'warn')::int AS warnings,
       (array_agg(kind ORDER BY created_at DESC, id) FILTER (WHERE kind IN ('mute','unmute')))[1] AS last_mute,
       (array_agg(kind ORDER BY created_at DESC, id) FILTER (WHERE kind IN ('ban','unban')))[1] AS last_ban
     FROM moderation_actions
     WHERE stream_id = $1 AND target_user_id = $2`,
    [streamId, userId]
  );
  const r = rows[0];
  return {
    warnings: r?.warnings ?? 0,
    muted: r?.last_mute === 'mute',
    banned: r?.last_ban === 'ban',
  };
}

/** Per-user derived state for everyone who has ever been actioned in a stream. */
export async function listModerationState(streamId: string): Promise<ModerationUserState[]> {
  const { rows } = await pool.query(
    `SELECT
       m.target_user_id AS user_id,
       u.username AS username,
       COUNT(*) FILTER (WHERE m.kind = 'warn')::int AS warnings,
       (array_agg(m.kind ORDER BY m.created_at DESC, m.id) FILTER (WHERE m.kind IN ('mute','unmute')))[1] AS last_mute,
       (array_agg(m.kind ORDER BY m.created_at DESC, m.id) FILTER (WHERE m.kind IN ('ban','unban')))[1] AS last_ban,
       MAX(m.created_at) AS last_action_at
     FROM moderation_actions m
     LEFT JOIN users u ON u.id = m.target_user_id
     WHERE m.stream_id = $1
     GROUP BY m.target_user_id, u.username
     ORDER BY MAX(m.created_at) DESC`,
    [streamId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username ?? null,
    warnings: r.warnings,
    muted: r.last_mute === 'mute',
    banned: r.last_ban === 'ban',
    lastActionAt: r.last_action_at,
  }));
}

export async function viewerState(
  stream: { id: string; host_id: string },
  userId: string,
  email: string
): Promise<StreamViewerState> {
  const mod = await getModerationState(stream.id, userId);
  return {
    isHost: stream.host_id === userId,
    isAdmin: isAdminEmail(email),
    banned: mod.banned,
    muted: mod.muted,
    warnings: mod.warnings,
  };
}

/** Access info for the internal endpoint consumed by chat-service and media-service. */
export async function getChannelAccess(
  channelId: string,
  userId: string,
  email: string
): Promise<ChannelAccess | undefined> {
  const { rows } = await pool.query('SELECT id, kind FROM channels WHERE id = $1', [channelId]);
  const channel = rows[0];
  if (!channel) return undefined;

  const base = {
    channelId,
    kind: channel.kind,
    isHost: false,
    isAdmin: false,
    banned: false,
    muted: false,
    warnings: 0,
  };
  if (channel.kind !== 'stream') return { ...base, isStream: false };

  const stream = await getStreamRow(channelId);
  if (!stream) {
    // Orphaned stream channel (should be impossible: created in one tx).
    return { ...base, isStream: true, status: 'ended' };
  }
  const me = await viewerState(stream, userId, email);
  return {
    ...base,
    isStream: true,
    status: stream.status,
    hostId: stream.host_id,
    hostUsername: stream.host_username,
    title: stream.title,
    ...me,
  };
}

export async function getFollowerCount(userId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM follows WHERE followee_id = $1', [userId]);
  return rows[0].n;
}

export async function computeEligibility(userId: string, email: string): Promise<StreamEligibility> {
  const admin = isAdminEmail(email);
  const [followerCount, premiumLookup] = await Promise.all([getFollowerCount(userId), checkPremium(email)]);
  const premium = premiumLookup.premium;
  const minFollowers = env.STREAM_MIN_FOLLOWERS;
  const eligible = admin || premium || followerCount >= minFollowers;

  const reasons: string[] = [];
  if (!eligible) {
    reasons.push(`You need at least ${minFollowers} followers to host (you have ${followerCount}).`);
    if (premiumLookup.bridge === 'unavailable') {
      reasons.push('Elonix premium status could not be verified right now; try again shortly.');
    } else if (premiumLookup.bridge === 'ok') {
      reasons.push('No active Elonix bot premium subscription found for your email.');
    } else {
      reasons.push('Elonix premium verification is not configured on this server.');
    }
  }
  return {
    eligible,
    admin,
    premium,
    followerCount,
    minFollowers,
    bridge: premiumLookup.bridge,
    reasons,
  };
}

export async function hasAcceptedGuidelines(userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM guideline_acceptances WHERE user_id = $1 AND version = $2',
    [userId, GUIDELINES_VERSION]
  );
  return rows.length > 0;
}
