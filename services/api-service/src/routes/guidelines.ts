import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { logger } from '../logger';
import { requireAuth } from '../middleware/requireAuth';
import { getGuidelines, GUIDELINES_VERSION } from '../guidelines';
import { hasAcceptedGuidelines } from '../streamService';
import { sendInvalidInput } from '../validation';

export const guidelinesRouter = Router();

const acceptSchema = z.object({
  version: z.number({ required_error: 'version is required', invalid_type_error: 'version must be a number' }).int(),
});

// GET /guidelines -> { version, rules }
guidelinesRouter.get('/', requireAuth, (_req: Request, res: Response) => {
  res.json(getGuidelines());
});

// GET /guidelines/status -> { version, accepted }
guidelinesRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json({ version: GUIDELINES_VERSION, accepted: await hasAcceptedGuidelines(req.user!.sub) });
  } catch (err) {
    logger.error({ err, userId: req.user!.sub }, 'guidelines status failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /guidelines/accept { version } — must be the CURRENT version.
guidelinesRouter.post('/accept', requireAuth, async (req: Request, res: Response) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  if (parsed.data.version !== GUIDELINES_VERSION) {
    return res.status(409).json({
      error: 'guidelines_version_mismatch',
      message: `Current guidelines version is ${GUIDELINES_VERSION}; got ${parsed.data.version}.`,
      version: GUIDELINES_VERSION,
    });
  }
  try {
    await pool.query(
      `INSERT INTO guideline_acceptances (user_id, version) VALUES ($1, $2)
       ON CONFLICT (user_id, version) DO NOTHING`,
      [req.user!.sub, GUIDELINES_VERSION]
    );
    logger.info({ userId: req.user!.sub, version: GUIDELINES_VERSION }, 'guidelines accepted');
    res.json({ version: GUIDELINES_VERSION, accepted: true });
  } catch (err) {
    logger.error({ err, userId: req.user!.sub }, 'guidelines accept failed');
    res.status(500).json({ error: 'internal_error' });
  }
});
