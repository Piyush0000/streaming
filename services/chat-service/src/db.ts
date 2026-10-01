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

export async function getRecentMessages(channelId: string, limit = 50): Promise<Message[]> {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT * FROM messages WHERE channel_id = $1 ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [channelId, limit]
  );
  return rows.map(toMessage);
}
