import { ApiError } from './api';
import { SHARED_ERRORS } from './errorMessages';

const HUB_BASE = `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/hub`;

export interface HubAuthor {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
}
export type HubSide = 'long' | 'short' | 'spot';
export type HubPostType = 'image' | 'text' | 'link';
export type HubSort = 'hot' | 'new' | 'top';
export type HubTime = 'day' | 'week' | 'month' | 'year' | 'all';
export type VoteValue = 1 | 0 | -1;

export interface HubCommunityRef {
  slug: string;
  name: string;
}
export interface HubPost {
  id: string;
  type: HubPostType;
  title: string;
  body: string;
  linkUrl: string | null;
  flair: string | null;
  community: HubCommunityRef | null;
  author: HubAuthor;
  caption: string;
  imageUrl: string | null;
  symbol: string | null;
  side: HubSide | null;
  pnlPercent: number | null;
  score: number;
  upCount: number;
  downCount: number;
  myVote: VoteValue;
  saved: boolean;
  commentCount: number;
  mine: boolean;
  pinned: boolean;
  createdAt: string;
}
export interface HubComment {
  id: string;
  parentId: string | null;
  depth: number;
  author: HubAuthor;
  body: string;
  score: number;
  myVote: VoteValue;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}
export interface HubCommunity {
  slug: string;
  name: string;
  description: string;
  memberCount: number;
  postCount: number;
  joined: boolean;
}
export interface HubUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarPreset: string | null;
  bio: string;
  joinedAt: string | null;
  postKarma: number;
  commentKarma: number;
  postCount: number;
  commentCount: number;
}
export interface HubUserComment extends HubComment {
  post: { id: string; title: string; community: HubCommunityRef | null } | null;
}
export interface VoteResult {
  score: number;
  upCount: number;
  downCount: number;
  myVote: VoteValue;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface PostQuery {
  sort?: HubSort;
  t?: HubTime;
  community?: string;
  author?: string;
  feed?: 'joined';
  cursor?: string | null;
  limit?: number;
}

const HUB_ERRORS: Record<string, string> = SHARED_ERRORS;

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
    throw new ApiError(0, 'network_error', SHARED_ERRORS.network_error, {});
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    let code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    if (res.status === 413) code = 'payload_too_large';
    if (res.status === 429) code = 'rate_limited';
    if (res.status === 404 && !HUB_ERRORS[code]) code = 'not_found';
    const message =
      (typeof json.message === 'string' && json.message) || HUB_ERRORS[code] || `Request failed (${res.status}).`;
    throw new ApiError(res.status, code, message, json);
  }
  return json as T;
}

// ---- defensive normalizers: never crash on missing/odd fields ----
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const vote = (v: unknown): VoteValue => (v === 1 || v === -1 ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cursorOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function normalizeAuthor(v: unknown): HubAuthor {
  const a = obj(v);
  return {
    id: str(a.id),
    username: str(a.username, 'deleted'),
    displayName: strOrNull(a.displayName),
    avatarUrl: strOrNull(a.avatarUrl),
    avatarPreset: strOrNull(a.avatarPreset),
  };
}
function normalizeCommunityRef(v: unknown): HubCommunityRef | null {
  const c = obj(v);
  const slug = str(c.slug);
  return slug ? { slug, name: str(c.name, slug) } : null;
}
export function normalizePost(v: unknown): HubPost {
  const p = obj(v);
  const imageUrl = strOrNull(p.imageUrl);
  const type: HubPostType = p.type === 'text' || p.type === 'link' || p.type === 'image' ? p.type : imageUrl ? 'image' : 'text';
  const side = p.side === 'long' || p.side === 'short' || p.side === 'spot' ? p.side : null;
  const up = num(p.upCount);
  const down = num(p.downCount);
  const caption = str(p.caption);
  return {
    id: str(p.id),
    type,
    title: str(p.title) || caption.slice(0, 150),
    body: str(p.body),
    linkUrl: strOrNull(p.linkUrl),
    flair: strOrNull(p.flair),
    community: normalizeCommunityRef(p.community),
    author: normalizeAuthor(p.author),
    caption,
    imageUrl,
    symbol: strOrNull(p.symbol),
    side,
    pnlPercent: typeof p.pnlPercent === 'number' && Number.isFinite(p.pnlPercent) ? p.pnlPercent : null,
    score: typeof p.score === 'number' ? p.score : up - down,
    upCount: up,
    downCount: down,
    myVote: vote(p.myVote),
    saved: p.saved === true,
    commentCount: num(p.commentCount),
    mine: p.mine === true,
    pinned: p.pinned === true,
    createdAt: str(p.createdAt, new Date(0).toISOString()),
  };
}
export function normalizeComment(v: unknown): HubComment {
  const c = obj(v);
  return {
    id: str(c.id),
    parentId: strOrNull(c.parentId),
    depth: Math.max(0, Math.floor(num(c.depth))),
    author: normalizeAuthor(c.author),
    body: str(c.body),
    score: num(c.score),
    myVote: vote(c.myVote),
    mine: c.mine === true,
    createdAt: str(c.createdAt, new Date(0).toISOString()),
    editedAt: strOrNull(c.editedAt),
    deleted: c.deleted === true,
  };
}
export function normalizeCommunity(v: unknown): HubCommunity {
  const c = obj(v);
  const slug = str(c.slug);
  return {
    slug,
    name: str(c.name, slug),
    description: str(c.description),
    memberCount: num(c.memberCount),
    postCount: num(c.postCount),
    joined: c.joined === true,
  };
}
export function normalizeUser(v: unknown): HubUser {
  const u = obj(v);
  return {
    id: str(u.id),
    username: str(u.username),
    displayName: str(u.displayName) || str(u.username),
    avatarUrl: strOrNull(u.avatarUrl),
    avatarPreset: strOrNull(u.avatarPreset),
    bio: str(u.bio),
    joinedAt: strOrNull(u.joinedAt),
    postKarma: num(u.postKarma),
    commentKarma: num(u.commentKarma),
    postCount: num(u.postCount),
    commentCount: num(u.commentCount),
  };
}
function normalizeVote(v: unknown, fallback: VoteValue): VoteResult {
  const r = obj(v);
  const up = num(r.upCount);
  const down = num(r.downCount);
  return {
    score: typeof r.score === 'number' ? r.score : up - down,
    upCount: up,
    downCount: down,
    myVote: r.myVote === undefined ? fallback : vote(r.myVote),
  };
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function postPage(token: string | null, path: string): Promise<Page<HubPost>> {
  const r = obj(await hubRequest<unknown>(token, 'GET', path));
  return { items: arr(r.posts).map(normalizePost), nextCursor: cursorOf(r.nextCursor) };
}

export const hubApi = {
  listPosts: (token: string | null, q: PostQuery = {}) =>
    postPage(
      token,
      `/posts${qs({
        sort: q.sort,
        t: q.sort === 'top' ? q.t : undefined,
        community: q.community,
        author: q.author,
        feed: q.feed,
        cursor: q.cursor,
        limit: q.limit ?? 12,
      })}`
    ),
  /** Used by the landing-page teaser. */
  listRecent: async (limit = 3) => (await postPage(null, `/posts${qs({ limit, sort: 'hot' })}`)).items,
  getPost: async (token: string | null, id: string) =>
    normalizePost(obj(await hubRequest<unknown>(token, 'GET', `/posts/${encodeURIComponent(id)}`)).post),
  createPost: async (token: string, body: FormData | Record<string, unknown>) =>
    normalizePost(obj(await hubRequest<unknown>(token, 'POST', '/posts', body)).post),
  deletePost: (token: string, id: string) => hubRequest<unknown>(token, 'DELETE', `/posts/${id}`),
  votePost: async (token: string, id: string, value: VoteValue) =>
    normalizeVote(await hubRequest<unknown>(token, 'POST', `/posts/${id}/vote`, { value }), value),
  savePost: (token: string, id: string, saved: boolean) =>
    hubRequest<unknown>(token, saved ? 'POST' : 'DELETE', `/posts/${id}/save`),
  listSaved: (token: string, cursor?: string | null) => postPage(token, `/saved${qs({ cursor, limit: 12 })}`),
  report: (token: string, id: string, reason: string) =>
    hubRequest<unknown>(token, 'POST', `/posts/${id}/report`, { reason }),
  pinPost: (token: string, id: string) => hubRequest<unknown>(token, 'POST', `/posts/${id}/pin`),

  listComments: async (
    token: string | null,
    id: string,
    sort: 'best' | 'new' | 'top',
    cursor?: string | null
  ): Promise<Page<HubComment>> => {
    const r = obj(await hubRequest<unknown>(token, 'GET', `/posts/${id}/comments${qs({ sort, cursor })}`));
    return { items: arr(r.comments).map(normalizeComment), nextCursor: cursorOf(r.nextCursor) };
  },
  addComment: async (token: string, id: string, body: string, parentId?: string | null): Promise<HubComment | null> => {
    const r = obj(
      await hubRequest<unknown>(token, 'POST', `/posts/${id}/comments`, parentId ? { body, parentId } : { body })
    );
    return r.comment ? normalizeComment(r.comment) : null;
  },
  editComment: (token: string, id: string, body: string) =>
    hubRequest<unknown>(token, 'PATCH', `/comments/${id}`, { body }),
  deleteComment: (token: string, id: string) => hubRequest<unknown>(token, 'DELETE', `/comments/${id}`),
  voteComment: async (token: string, id: string, value: VoteValue) =>
    normalizeVote(await hubRequest<unknown>(token, 'POST', `/comments/${id}/vote`, { value }), value),

  listCommunities: async (token: string | null, q?: string): Promise<HubCommunity[]> =>
    arr(obj(await hubRequest<unknown>(token, 'GET', `/communities${qs({ q })}`)).communities).map(normalizeCommunity),
  getCommunity: async (token: string | null, slug: string) => {
    const r = obj(await hubRequest<unknown>(token, 'GET', `/communities/${encodeURIComponent(slug)}`));
    return normalizeCommunity(r.community ?? r);
  },
  createCommunity: async (token: string, body: { slug: string; name: string; description: string }) => {
    const r = obj(await hubRequest<unknown>(token, 'POST', '/communities', body));
    return normalizeCommunity(r.community ?? r);
  },
  join: (token: string, slug: string, joined: boolean) =>
    hubRequest<unknown>(token, joined ? 'POST' : 'DELETE', `/communities/${encodeURIComponent(slug)}/join`),

  getUser: async (token: string | null, username: string) =>
    normalizeUser(obj(await hubRequest<unknown>(token, 'GET', `/users/${encodeURIComponent(username)}`)).user),
  userPosts: (token: string | null, username: string, cursor?: string | null) =>
    postPage(token, `/users/${encodeURIComponent(username)}/posts${qs({ cursor, limit: 12 })}`),
  userComments: async (token: string | null, username: string, cursor?: string | null): Promise<Page<HubUserComment>> => {
    const r = obj(
      await hubRequest<unknown>(token, 'GET', `/users/${encodeURIComponent(username)}/comments${qs({ cursor, limit: 15 })}`)
    );
    return {
      items: arr(r.comments).map((c) => {
        const p = obj(obj(c).post);
        return {
          ...normalizeComment(c),
          post: p.id ? { id: str(p.id), title: str(p.title, 'Post'), community: normalizeCommunityRef(p.community) } : null,
        };
      }),
      nextCursor: cursorOf(r.nextCursor),
    };
  },
  searchPosts: (token: string | null, q: string, cursor?: string | null) =>
    postPage(token, `/search${qs({ q, type: 'posts', cursor })}`),
  searchCommunities: async (token: string | null, q: string) =>
    arr(obj(await hubRequest<unknown>(token, 'GET', `/search${qs({ q, type: 'communities' })}`)).communities).map(
      normalizeCommunity
    ),
  searchUsers: async (token: string | null, q: string) =>
    arr(obj(await hubRequest<unknown>(token, 'GET', `/search${qs({ q, type: 'users' })}`)).users).map(normalizeUser),
};

export function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 330 ? 'numeric' : undefined });
}

/** 1234 -> 1.2k */
export function compactCount(n: number): string {
  const a = Math.abs(n);
  if (a < 1000) return String(n);
  if (a < 1e6) return `${(n / 1000).toFixed(a < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
}

/** Deterministic banner/icon gradient from a community slug. */
export function gradientForSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (slug.charCodeAt(i) + ((h << 5) - h)) | 0;
  const hue = Math.abs(h) % 360;
  return `linear-gradient(120deg, hsl(${hue}, 70%, 38%), hsl(${(hue + 55) % 360}, 65%, 28%) 60%, hsl(${(hue + 120) % 360}, 60%, 22%))`;
}

/** Hostname of an http(s) link, or null. Only the host is ever shown for link posts. */
export function linkHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

export const hubPath = {
  home: '/elonixhub',
  post: (id: string) => `/elonixhub/post/${encodeURIComponent(id)}`,
  community: (slug: string) => `/elonixhub/c/${encodeURIComponent(slug)}`,
  user: (name: string) => `/elonixhub/u/${encodeURIComponent(name)}`,
  submit: '/elonixhub/submit',
  search: (q: string) => `/elonixhub/search?q=${encodeURIComponent(q)}`,
};

/** localStorage with try/catch; storage can be unavailable. */
export function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
