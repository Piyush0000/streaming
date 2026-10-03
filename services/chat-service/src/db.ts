import { Pool } from 'pg';
import { env } from './env';
import type { Message, MessageAttachment } from '@streaming/shared-types';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

export async function pingDb(): Promise<void> {
  await pool.query('SELECT 1');
}

function toMessage(row: any): Message {
  const attachment: MessageAttachment | null = row.attachment_url
    ? {
        url: row.attachment_url,
        filename: row.attachment_filename,
        mimeType: row.attachment_mime_type,
        size: Number(row.attachment_size),
      }
    : null;
  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    username: row.username,
    content: row.content,
    createdAt: row.created_at,
    attachment,
  };
}

export async function insertMessage(input: {
  channelId: string;
  userId: string;
  username: string;
  content: string;
  attachment?: MessageAttachment | null;
}): Promise<Message> {
  const { rows } = await pool.query(
    `INSERT INTO messages (channel_id, user_id, username, content, attachment_url, attachment_filename, attachment_mime_type, attachment_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      input.channelId,
      input.userId,
      input.username,
      input.content,
      input.attachment?.url ?? null,
      input.attachment?.filename ?? null,
      input.attachment?.mimeType ?? null,
      input.attachment?.size ?? null,
    ]
  );
  return toMessage(rows[0]);
}

/** Looks up a not-yet-deleted message's author, scoped to its channel. */
export async function getLiveMessageAuthor(
  channelId: string,
  messageId: string
): Promise<{ userId: string } | undefined> {
  const { rows } = await pool.query(
    `SELECT user_id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [messageId, channelId]
  );
  return rows[0] ? { userId: rows[0].user_id } : undefined;
}

/** Soft-deletes a message. Returns false if it was already deleted / not found. */
export async function softDeleteMessage(
  channelId: string,
  messageId: string,
  deletedBy: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE messages SET deleted_at = now(), deleted_by = $3
     WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
    [messageId, channelId, deletedBy]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Fallback when api-service is unreachable: channels live in the same
 * Postgres, so ask it directly whether a channel is a stream.
 * Returns undefined if the channel row doesn't exist.
 */
export async function getChannelGateFromDb(
  channelId: string
): Promise<{ kind: string; visibility: string } | undefined> {
  const { rows } = await pool.query('SELECT kind, visibility FROM channels WHERE id = $1', [channelId]);
  return rows[0] ? { kind: rows[0].kind, visibility: rows[0].visibility } : undefined;
}

/**
 * Hard-deletes every message of a deleted channel (triggered by the
 * `channel-deleted` event). Idempotent: every chat-service instance runs it.
 * Uploaded files referenced by those messages are left on disk.
 */
export async function purgeChannelMessages(channelId: string): Promise<number> {
  const { rowCount } = await pool.query('DELETE FROM messages WHERE channel_id = $1', [channelId]);
  return rowCount ?? 0;
}

export async function getRecentMessages(channelId: string, limit = 50): Promise<Message[]> {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT * FROM messages WHERE channel_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [channelId, limit]
  );
  return rows.map(toMessage);
}
