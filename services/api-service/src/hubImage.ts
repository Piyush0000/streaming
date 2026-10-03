// Pure helpers for Elonix Hub image handling. No imports from env/db so they
// can be unit tested in isolation.

export type HubImageExt = 'png' | 'jpg' | 'webp' | 'gif';

/**
 * Detects the image type from magic bytes ONLY. The client-supplied mime type
 * and filename are never consulted. Returns null for anything unsupported.
 */
export function detectImageExt(buf: Buffer): HubImageExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

export const HUB_MEDIA_FILE_RE = /^[a-f0-9-]{36}\.(png|jpe?g|webp|gif)$/;

export const HUB_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function contentTypeForFile(file: string): string | null {
  if (!HUB_MEDIA_FILE_RE.test(file)) return null;
  const ext = file.slice(file.lastIndexOf('.') + 1);
  return HUB_CONTENT_TYPES[ext] ?? null;
}

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(cursor: string): { ts: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const i = raw.lastIndexOf('|');
    if (i < 1) return null;
    const ts = raw.slice(0, i);
    const id = raw.slice(i + 1);
    if (!UUID_RE.test(id) || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}
