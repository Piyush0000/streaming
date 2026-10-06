import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { avatarPresetFor, avatarUrlFor, effectiveDisplayName } from '../profile';
import { feedSince, isNewAccount, normalizeJoinSource, parseFeedLimit } from '../activity';

// "Who just joined" feed. Mounted at /activity; gateway maps /api/activity/.
// Never exposes email.
export const activityRouter = Router();

activityRouter.use(requireAuth);

async function limited(res: Response, key: string, limit: number, windowSec: number): Promise<boolean> {
  const rl = await hitRateLimit(key, limit, windowSec);
  if (rl.allowed) return false;
  const sec = Math.ceil(rl.retryAfterMs / 1000);
  res.setHeader('Retry-After', String(sec));
  res.status(429).json({ error: 'rate_limited', message: `Too many requests. Try again in ${sec}s.`, retryAfterMs: rl.retryAfterMs });
  return true;
}

activityRouter.post('/joined', async (req: Request, res: Response) => {
  const uid = req.user!.sub;
  try {
    if (await limited(res, `rl:activity:join:${uid}`, 10, 3600)) return;
    const source = normalizeJoinSource((req.body as { source?: unknown } | undefined)?.source);
    const u = await pool.query<{ username: string; created_at: Date; display_name: string | null }>(
      `SELECT u.username, u.created_at, p.display_name
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [uid]
    );
    const row = u.rows[0];
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!isNewAccount(row.created_at)) return res.json({ recorded: false, reason: 'not_new' });
    const ins = await pool.query(
      `INSERT INTO join_events (user_id, username, display_name, source)
       VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING`,
      [uid, row.username, effectiveDisplayName(row.display_name, row.username), source]
    );
    return res.json({ recorded: (ins.rowCount ?? 0) > 0 });
  } catch (err) {
    logger.error({ err }, 'activity: joined failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});

activityRouter.get('/recent', async (req: Request, res: Response) => {
  const uid = req.user!.sub;
  try {
    if (await limited(res, `rl:activity:recent:${uid}`, 20, 60)) return;
    const since = feedSince(req.query.since);
    const limit = parseFeedLimit(req.query.limit);
    const r = await pool.query(
      `SELECT j.id, j.user_id, j.username, j.source, j.created_at,
              p.display_name, p.avatar_file, p.avatar_preset
       FROM join_events j LEFT JOIN user_profiles p ON p.user_id = j.user_id
       WHERE j.created_at > $2 AND j.user_id <> $1
         AND NOT EXISTS (SELECT 1 FROM user_blocks b
                         WHERE (b.blocker_id = $1 AND b.blocked_id = j.user_id)
                            OR (b.blocker_id = j.user_id AND b.blocked_id = $1))
       ORDER BY j.created_at DESC LIMIT $3`,
      [uid, since, limit]
    );
    return res.json({
      events: r.rows.map((x) => ({
        id: x.id,
        userId: x.user_id,
        displayName: effectiveDisplayName(x.display_name, x.username),
        username: x.username,
        avatarUrl: avatarUrlFor(x.avatar_file),
        avatarPreset: avatarPresetFor(x.avatar_preset),
        source: x.source,
        createdAt: new Date(x.created_at).toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, 'activity: recent failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});
