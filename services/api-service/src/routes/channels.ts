import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { logger } from '../logger';
import { requireAuth } from '../middleware/requireAuth';
import type { Channel } from '@streaming/shared-types';

export const channelsRouter = Router();

function toChannel(row: any): Channel {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    kind: row.kind,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const createChannelSchema = z.object({
  name: z.string().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  topic: z.string().max(256).optional(),
  kind: z.enum(['text', 'voice']).default('text'),
});

// All channels are public in Phase 1 — no permission checks beyond "is logged in".
// kind='stream' channels are NEVER listed here (live or ended): the UI lists
// live streams via GET /streams?status=live instead. GET /channels/:id still
// resolves a stream channel by id.
channelsRouter.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM channels WHERE kind <> 'stream' ORDER BY created_at ASC`
    );
    res.json({ channels: rows.map(toChannel) });
  } catch (err) {
    logger.error({ err }, 'list channels failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

channelsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ channel: toChannel(rows[0]) });
  } catch (err) {
    logger.error({ err }, 'get channel failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

channelsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.issues });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO channels (name, topic, kind, created_by) VALUES ($1, $2, $3, $4) RETURNING *`,
      [parsed.data.name, parsed.data.topic ?? null, parsed.data.kind, req.user!.sub]
    );
    res.status(201).json({ channel: toChannel(rows[0]) });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'channel_name_taken' });
    }
    logger.error({ err }, 'create channel failed');
    res.status(500).json({ error: 'internal_error' });
  }
});
