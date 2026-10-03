/**
 * "Return to where you were going" after sign-in.
 *
 * The target is only ever an in-app path (`/foo?x#y`). Anything that could
 * point off-site (`//evil.com`, `/\evil.com`, `https://...`, `javascript:`)
 * is rejected, so a crafted `state`/storage value cannot become an open redirect.
 */
const KEY = 'streaming.postLoginPath';
const MAX_AGE_MS = 30 * 60 * 1000;

export const DEFAULT_POST_LOGIN_PATH = '/channels';

/** Returns a safe same-origin in-app path, or null. */
export function sanitizeInternalPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  // Single leading slash only; no protocol-relative, backslash or control characters.
  if (value[0] !== '/' || value[1] === '/' || value[1] === '\\') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    // Never bounce back into the auth screens.
    if (url.pathname === '/login') return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export function rememberPostLoginPath(path: string): void {
  const safe = sanitizeInternalPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    /* storage unavailable: router state still carries the target */
  }
}

/** Reads (without clearing) the remembered target. */
export function peekPostLoginPath(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > MAX_AGE_MS) return null;
    return sanitizeInternalPath(parsed.path);
  } catch {
    return null;
  }
}

export function clearPostLoginPath(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Where to go after signing in: router-state target, else the remembered one, else the default. */
export function resolvePostLoginTarget(stateFrom?: unknown): string {
  return sanitizeInternalPath(stateFrom) ?? peekPostLoginPath() ?? DEFAULT_POST_LOGIN_PATH;
}
