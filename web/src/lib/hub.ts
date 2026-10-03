import { ApiError } from './api';

const HUB_BASE = `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/hub`;

export interface HubAuthor {
  id: string;
  username: string;
}
export type HubSide = 'long' | 'short' | 'spot';
export interface HubPost {
  id: string;
  author: HubAuthor;
  caption: string;
  imageUrl: string;
  symbol: string | null;
  side: HubSide | null;
  pnlPercent: number | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  mine: boolean;
  createdAt: string;
}
export interface HubComment {
  id: string;
  author: HubAuthor;
  body: string;
  createdAt: string;
  mine: boolean;
}

const HUB_ERRORS: Record<string, string> = {
  unsupported_image: 'That image type is not supported. Use PNG, JPG, WebP or GIF.',
  rate_limited: 'You are doing that too fast. Please wait a moment.',
  payload_too_large: 'That image is too large (max 5MB).',
  invalid_token: 'Your session has expired. Please sign in again.',
  missing_token: 'Your session has expired. Please sign in again.',
  forbidden: 'You do not have permission to do that.',
  not_found: 'That post no longer exists.',
};

async function hubRequest<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${HUB_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.', {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    let code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    if (res.status === 413) code = 'payload_too_large';
    if (res.status === 429) code = 'rate_limited';
    const message =
      (typeof json.message === 'string' && json.message) || HUB_ERRORS[code] || `Request failed (${res.status}).`;
    throw new ApiError(res.status, code, message, json);
  }
  return json as T;
}

export const hubApi = {
  listPosts: (token: string | null, cursor?: string | null, limit = 12) =>
    hubRequest<{ posts: HubPost[]; nextCursor: string | null }>(
      token,
      'GET',
      `/posts?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    ),
  createPost: (token: string, form: FormData) => hubRequest<{ post: HubPost }>(token, 'POST', '/posts', form),
  deletePost: (token: string, id: string) => hubRequest<unknown>(token, 'DELETE', `/posts/${id}`),
  like: (token: string, id: string, liked: boolean) =>
    hubRequest<{ liked: boolean; likeCount: number }>(token, liked ? 'POST' : 'DELETE', `/posts/${id}/like`),
  listComments: (token: string | null, id: string, cursor?: string | null) =>
    hubRequest<{ comments: HubComment[]; nextCursor: string | null }>(
      token,
      'GET',
      `/posts/${id}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    ),
  addComment: (token: string, id: string, body: string) =>
    hubRequest<{ comment: HubComment }>(token, 'POST', `/posts/${id}/comments`, { body }),
  deleteComment: (token: string, id: string) => hubRequest<unknown>(token, 'DELETE', `/comments/${id}`),
  report: (token: string, id: string, reason: string) =>
    hubRequest<{ ok: boolean }>(token, 'POST', `/posts/${id}/report`, { reason }),
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
