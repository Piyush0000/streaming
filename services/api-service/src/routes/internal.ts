import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../env';
import { logger } from '../logger';
import { sendInvalidInput, uuidSchema } from '../validation';
import { getChannelAccess, getStreamRow, toStream } from '../streamService';
import { endStream } from './streams';

/**
 * Service-to-service endpoints (chat-service, media-service). Guarded by the
 * shared `x-internal-secret` header. NOT exposed by the public gateway:
 * services/gateway/nginx.conf only proxies explicit public prefixes and has
 * no /internal route.
 */
export const internalRouter = Router();

function secretsEqual(provided: string, expected: string): boolean {
  // Hash both sides so lengths are equal and the comparison is constant-time.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['x-internal-secret'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided || !secretsEqual(provided, env.INTERNAL_API_SECRET)) {
    logger.warn({ path: req.path, ip: req.ip }, 'internal request rejected: bad or missing secret');
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

internalRouter.use(requireInternalSecret);

const accessQuerySchema = z.object({
  userId: uuidSchema,
  email: z.string().max(320).default(''),
});

// GET /internal/channels/:id/access?userId=&email=
internalRouter.get('/channels/:id/access', async (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: 'invalid_input', message: `id: ${idParsed.error.issues[0].message}` });
  }
  const q = accessQuerySchema.safeParse(req.query);
  if (!q.success) return sendInvalidInput(res, q.error);
  try {
    const access = await getChannelAccess(idParsed.data, q.data.userId, q.data.email);
    if (!access) return res.status(404).json({ error: 'channel_not_found' });
    res.json(access);
  } catch (err) {
    logger.error({ err, channelId: req.params.id }, 'internal access lookup failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /internal/streams/:id/end  (media-service host-absent timeout)
internalRouter.post('/streams/:id/end', async (req: Request, res: Response) => {
  const idParsed = uuidSchema.safeParse(req.params.id);
  if (!idParsed.success) {
    return res.status(400).json({ error: 'invalid_input', message: `id: ${idParsed.error.issues[0].message}` });
  }
  try {
    const row = await getStreamRow(idParsed.data);
    if (!row) return res.status(404).json({ error: 'stream_not_found' });
    const ended = await endStream(idParsed.data);
    if (!ended) return res.status(409).json({ error: 'stream_already_ended' });
    logger.info({ streamId: idParsed.data }, 'stream ended via internal endpoint');
    res.json({ stream: toStream(ended) });
  } catch (err) {
    logger.error({ err, streamId: req.params.id }, 'internal end stream failed');
    res.status(500).json({ error: 'internal_error' });
  }
});
