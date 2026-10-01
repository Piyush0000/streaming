import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

// Local disk, behind a Docker volume in both compose files (see
// infra/docker-compose.{dev,prod}.yml) so uploads survive container
// restarts, same pattern as the postgres-data named volume.
export const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — plenty for Phase 1, keeps disk usage sane.

// Loose, Phase-1-grade blocklist: reject obviously dangerous executable
// types. Not a hardened content-scanning system, just enough to stop someone
// casually dropping a .exe/.sh into chat.
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.ps1',
  '.vbs',
  '.js',
  '.jar',
  '.app',
  '.dmg',
  '.apk',
  '.scr',
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-sh',
  'application/x-bat',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/java-archive',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    // Never trust the client-supplied filename for the on-disk name (path
    // traversal, collisions) — keep only the extension, generate the rest.
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 16);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('file type not allowed'));
      return;
    }
    cb(null, true);
  },
});

/** Filenames generated above are always `<uuid><ext>` — reject anything else before touching the filesystem. */
export function isSafeUploadFilename(filename: string): boolean {
  return /^[a-f0-9-]{36}(\.[a-zA-Z0-9]{1,16})?$/.test(filename);
}
