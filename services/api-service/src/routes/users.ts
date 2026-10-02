import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { requireAuth } from '../middleware/requireAuth';
import { uuidSchema } from '../validation';
import type { FollowStats } from '@streaming/shared-types';

// Minimal follow system: follower counts gate who may host a stream.
export const usersRouter = Router();

async function stats(targetId: string, viewerId: string): Promise<FollowStats> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM follows WHERE followee_id = $1) AS followers,
       EXISTS (SELECT 1 FROM follows WHERE followee_id = $1 AND follower_id = $2) AS is_following`,
    [targetId, viewerId]
  );
  return { followers: rows[0].followers, isFollowing: rows[0].is_following };
}

function parseUserId(req: Request, res: Response): string | undefined {
  const parsed = uuidSchema.safeParse(req.params.userId);
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_input',
      message: `userId: ${parsed.error.issues[0].message}`,
      details: parsed.error.issues,
    });
    return undefined;
  }
  return parsed.data;
}

async function userExists(id: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [id]);
  return rows.length > 0;
}

// POST /users/:userId/follow  (idempotent) -> { followers, isFollowing }
usersRouter.post('/:userId/follow', requireAuth, async (req: Request, res: Response) => {
  const targetId = parseUserId(req, res);
  if (!targetId) return;
  const me = req.user!.sub;
  if (targetId === me) {
    return res.status(400).json({ error: 'cannot_follow_self', message: 'You cannot follow yourself.' });
  }
  try {
    if (!(await userExists(targetId))) return res.status(404).json({ error: 'user_not_found' });
    await pool.query(
      `INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [me, targetId]
    );
    logger.info({ follower: me, followee: targetId }, 'followed');
    res.json(await stats(targetId, me));
  } catch (err) {
    logger.error({ err, follower: me, followee: targetId }, 'follow failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /users/:userId/follow  (idempotent) -> { followers, isFollowing }
usersRouter.delete('/:userId/follow', requireAuth, async (req: Request, res: Response) => {
  const targetId = parseUserId(req, res);
  if (!targetId) return;
  const me = req.user!.sub;
  try {
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [me, targetId]);
    logger.info({ follower: me, followee: targetId }, 'unfollowed');
    res.json(await stats(targetId, me));
  } catch (err) {
    logger.error({ err, follower: me, followee: targetId }, 'unfollow failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /users/:userId/follow-stats -> { followers, isFollowing }
usersRouter.get('/:userId/follow-stats', requireAuth, async (req: Request, res: Response) => {
  const targetId = parseUserId(req, res);
  if (!targetId) return;
  try {
    res.json(await stats(targetId, req.user!.sub));
  } catch (err) {
    logger.error({ err, followee: targetId }, 'follow-stats failed');
    res.status(500).json({ error: 'internal_error' });
  }
});
