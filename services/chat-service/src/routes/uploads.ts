import path from 'path';
import { Router, Request, Response } from 'express';
import type { MessageAttachment } from '@streaming/shared-types';
import { logger } from '../logger';
import { requireAuth } from '../middleware/requireAuth';
import { checkUploadRateLimit } from '../rateLimit';
import { upload, UPLOADS_DIR, isSafeUploadFilename } from '../upload';

export const uploadsRouter = Router();

// POST /uploads — multipart/form-data, field name "file". Requires auth so
// only logged-in users can write to disk. Returns attachment metadata the
// client then sends along with a chat:send message.
uploadsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  // Per-user limit, checked BEFORE the body is parsed/written to disk.
  const rl = await checkUploadRateLimit(req.user!.sub);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil(rl.retryAfterMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'rate_limited',
      message: `You are uploading too fast. Try again in ${retryAfterSec}s.`,
      retryAfterMs: rl.retryAfterMs,
    });
  }
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'upload failed';
      const status = message === 'file type not allowed' ? 415 : 400;
      return res.status(status).json({ error: 'upload_failed', message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'no_file' });
    }

    const attachment: MessageAttachment = {
      url: `/uploads/${req.file.filename}`,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    };
    res.status(201).json({ attachment });
  });
});

// GET /uploads/:filename — serves a previously uploaded file back.
uploadsRouter.get('/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  if (!isSafeUploadFilename(filename)) {
    return res.status(400).json({ error: 'invalid_filename' });
  }
  const filePath = path.join(UPLOADS_DIR, filename);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      logger.warn({ err, filename }, 'upload not found');
      res.status(404).json({ error: 'not_found' });
    }
  });
});
