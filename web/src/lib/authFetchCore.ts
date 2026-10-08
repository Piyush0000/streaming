/**
 * Fetch wrapper logic for /api/* calls that carry `Authorization: Bearer`:
 *  - always sends the LATEST access token (stale closures never matter)
 *  - on 401 invalid_token/token_expired/missing_token: ONE refresh + ONE retry
 * Pure (fetch + session manager injected) so it is unit testable.
 */

export interface AuthFetchManager {
  getAccessToken(): string | null;
  ensureFresh(marginMs?: number): Promise<string | null>;
  refreshNow(req?: { staleAccessToken?: string | null }): Promise<string | null>;
}

export interface AuthFetchOptions {
  baseFetch: typeof fetch;
  manager: AuthFetchManager;
  origin: string;
  /**
   * Extra absolute API base URLs (e.g. dev `http://localhost:4002`, `http://localhost:4003/uploads`)
   * whose requests are intercepted too. The auth service base must NOT be listed.
   */
  apiBases?: string[];
  /** Absolute auth-service base(s) that must never be intercepted (refresh would recurse). */
  authBases?: string[];
}

const RETRY_CODES = new Set(['invalid_token', 'token_expired', 'missing_token']);

/** Auth endpoints are never intercepted (refresh would recurse; login/google carry no session). */
export function shouldIntercept(url: URL, origin: string, apiBases: string[] = [], authBases: string[] = []): boolean {
  const href = url.href;
  if (authBases.some((b) => b && href.startsWith(b))) return false;
  if (url.origin === origin) {
    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) return false;
    return url.pathname === '/api' || url.pathname.startsWith('/api/');
  }
  return apiBases.some((b) => b.startsWith('http') && href.startsWith(b));
}

function bodyIsReplayable(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === 'string') return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  return false; // ReadableStream and anything unknown
}

function isBearer(value: string | null): boolean {
  return !!value && /^bearer\s+/i.test(value);
}

export function createAuthFetch(opts: AuthFetchOptions): typeof fetch {
  const { baseFetch, manager, origin } = opts;
  const apiBases = opts.apiBases ?? [];
  const authBases = opts.authBases ?? [];

  return async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url: URL;
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      url = new URL(raw, origin);
    } catch {
      return baseFetch(input, init);
    }
    if (!shouldIntercept(url, origin, apiBases, authBases)) return baseFetch(input, init);

    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const headers = new Headers(init?.headers ?? (isRequest ? (input as Request).headers : undefined));
    if (!isBearer(headers.get('Authorization'))) return baseFetch(input, init);
    if (!manager.getAccessToken()) return baseFetch(input, init); // nothing newer than the caller's token

    // Replayable copy of a Request input, made BEFORE the first send consumes its body.
    const replay = isRequest && !(input as Request).bodyUsed ? (input as Request).clone() : null;
    const replayable = isRequest ? replay !== null : bodyIsReplayable(init?.body);

    const send = (token: string, req: RequestInfo | URL): Promise<Response> => {
      const h = new Headers(headers);
      h.set('Authorization', `Bearer ${token}`);
      return baseFetch(req, { ...init, headers: h });
    };

    // After sleep / long idle the token may already be expired: refresh first, saving a 401 round trip.
    const token = (await manager.ensureFresh()) ?? manager.getAccessToken();
    if (!token) return baseFetch(input, init);

    const res = await send(token, input);
    if (res.status !== 401) return res;

    let code: unknown;
    try {
      code = ((await res.clone().json()) as { error?: unknown })?.error;
    } catch {
      return res;
    }
    if (typeof code !== 'string' || !RETRY_CODES.has(code)) return res;
    if (!replayable) return res; // can't resend the body; the next request uses the refreshed token

    const fresh = await manager.refreshNow({ staleAccessToken: token });
    if (!fresh || fresh === token) return res;
    return send(fresh, replay ?? input);
  } as typeof fetch;
}
