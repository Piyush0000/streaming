import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { logger } from '../logger';
import { hitRateLimit } from '../rateLimit';
import { requireAuth } from '../middleware/requireAuth';
import { isAdminEmail } from '../streamService';
import { sendInvalidInput } from '../validation';
import { avatarPresetFor, avatarUrlFor, effectiveDisplayName } from '../profile';
import { decodeCursor, encodeCursor } from '../hubImage';
import { containsPattern, createCommunitySchema, normalizeSlug, isValidSlug } from '../hubLogic';
import { cursorField, limitField, listPosts } from '../hubFeed';
import {
  NOT_BLOCKED,
  NOT_HIDDEN,
  POST_FROM,
  POST_SELECT,
  PostRow,
  badInput,
  fail,
  optionalAuth,
  rateLimited,
  rollback,
  toPost,
} from '../hubShared';

// Communities, search and per-user hub profiles. Mounted inside hubRouter (so /api/hub/...).
export const communitiesRouter = Router();

const COMMUNITIES_PER_DAY = 10;
const MEMBERSHIP_PER_HOUR = 60;
const SEARCHES_PER_MINUTE = 30;
const MOD_ACTIONS_PER_HOUR = 60;
const SEARCH_LIMIT = 20;

// ---------- communities ----------

interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  member_count: number;
  post_count: number;
  is_default: boolean;
  created_at: Date;
  my_role: 'owner' | 'mod' | 'member' | null;
}

// $1 = viewer id.
const COMMUNITY_SELECT = `
  c.id, c.slug, c.name, c.description, c.member_count, c.post_count, c.is_default, c.created_at, m.role AS my_role
  FROM communities c
  LEFT JOIN community_members m ON m.community_id = c.id AND m.user_id = $1::uuid`;

function toCommunity(r: CommunityRow) {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    memberCount: r.member_count,
    postCount: r.post_count,
    joined: r.my_role !== null,
    role: r.my_role,
    isDefault: r.is_default,
    createdAt: r.created_at.toISOString(),
  };
}

async function loadCommunity(slug: string, viewerId: string | null): Promise<CommunityRow | null> {
  const { rows } = await pool.query<CommunityRow>(`SELECT ${COMMUNITY_SELECT} WHERE c.slug = $2`, [viewerId, slug]);
  return rows[0] ?? null;
}

function parseSlug(req: Request, res: Response): string | undefined {
  const slug = normalizeSlug(String(req.params.slug ?? ''));
  if (!isValidSlug(slug)) {
    res.status(404).json({ error: 'community_not_found' });
    return undefined;
  }
  return slug;
}

const listQuerySchema = z.object({
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(50).optional()),
  joined: z.preprocess((v) => v === 'true' || v === '1', z.boolean()),
  limit: limitField(30, 50),
});

// GET /hub/communities?q=&joined=true&limit= -> { communities: [{slug,name,description,memberCount,postCount,joined,role,isDefault,createdAt}] }
communitiesRouter.get('/communities', optionalAuth, async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const viewerId = req.user?.sub ?? null;
  if (parsed.data.joined && !viewerId) return res.status(401).json({ error: 'missing_token' });
  try {
    const params: unknown[] = [viewerId, parsed.data.limit];
    const where: string[] = [];
    if (parsed.data.q) {
      params.push(containsPattern(parsed.data.q));
      where.push(`(c.slug ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    if (parsed.data.joined) where.push('m.user_id IS NOT NULL');
    const { rows } = await pool.query<CommunityRow>(
      `SELECT ${COMMUNITY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.member_count DESC, c.slug ASC LIMIT $2`,
      params
    );
    res.json({ communities: rows.map(toCommunity) });
  } catch (err) {
    fail(res, err, 'list communities');
  }
});

// POST /hub/communities {slug,name,description} -> 201 { community }  (10/day per user; creator becomes owner + member)
communitiesRouter.post('/communities', requireAuth, async (req: Request, res: Response) => {
  const parsed = createCommunitySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:community:${user.sub}`, COMMUNITIES_PER_DAY, 86400);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = crypto.randomUUID();
    await client.query(
      'INSERT INTO communities (id, slug, name, description, created_by, member_count) VALUES ($1, $2, $3, $4, $5, 1)',
      [id, parsed.data.slug, parsed.data.name, parsed.data.description, user.sub]
    );
    await client.query("INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'owner')", [id, user.sub]);
    await client.query('COMMIT');
    logger.info({ slug: parsed.data.slug, by: user.sub }, 'hub: community created');
    const row = await loadCommunity(parsed.data.slug, user.sub);
    res.status(201).json({ community: row ? toCommunity(row) : null });
  } catch (err) {
    await rollback(client);
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'slug_taken', message: 'A community with that name already exists.' });
    }
    fail(res, err, 'create community', { userId: user.sub });
  } finally {
    client.release();
  }
});

// GET /hub/communities/:slug -> { community, mods: [{id, username, role}] }
communitiesRouter.get('/communities/:slug', optionalAuth, async (req: Request, res: Response) => {
  const slug = parseSlug(req, res);
  if (!slug) return;
  try {
    const row = await loadCommunity(slug, req.user?.sub ?? null);
    if (!row) return res.status(404).json({ error: 'community_not_found' });
    const mods = await pool.query<{ id: string; username: string; role: string }>(
      `SELECT u.id, u.username, m.role FROM community_members m JOIN users u ON u.id = m.user_id
       WHERE m.community_id = $1 AND m.role IN ('owner', 'mod') ORDER BY m.role DESC, m.joined_at ASC LIMIT 50`,
      [row.id]
    );
    res.json({ community: toCommunity(row), mods: mods.rows });
  } catch (err) {
    fail(res, err, 'get community', { slug });
  }
});

async function setMembership(req: Request, res: Response, join: boolean) {
  const slug = parseSlug(req, res);
  if (!slug) return;
  const user = req.user!;
  const rl = await hitRateLimit(`rl:hub:join:${user.sub}`, MEMBERSHIP_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Row lock serialises counter updates for this community.
    const c = await client.query<{ id: string }>('SELECT id FROM communities WHERE slug = $1 FOR UPDATE', [slug]);
    if (!c.rows[0]) {
      await rollback(client);
      return res.status(404).json({ error: 'community_not_found' });
    }
    const id = c.rows[0].id;
    if (join) {
      const ins = await client.query(
        "INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
        [id, user.sub]
      );
      if (ins.rowCount) await client.query('UPDATE communities SET member_count = member_count + 1 WHERE id = $1', [id]);
    } else {
      const cur = await client.query<{ role: string }>('SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2', [id, user.sub]);
      if (cur.rows[0]?.role === 'owner') {
        await rollback(client);
        return res.status(400).json({ error: 'owner_cannot_leave', message: 'The owner cannot leave their community.' });
      }
      const del = await client.query('DELETE FROM community_members WHERE community_id = $1 AND user_id = $2', [id, user.sub]);
      if (del.rowCount) await client.query('UPDATE communities SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1', [id]);
    }
    const { rows } = await client.query<{ member_count: number }>('SELECT member_count FROM communities WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ joined: join, memberCount: rows[0].member_count });
  } catch (err) {
    await rollback(client);
    fail(res, err, join ? 'join community' : 'leave community', { slug });
  } finally {
    client.release();
  }
}
// POST/DELETE /hub/communities/:slug/join (idempotent) -> { joined, memberCount }
communitiesRouter.post('/communities/:slug/join', requireAuth, (req, res) => setMembership(req, res, true));
communitiesRouter.delete('/communities/:slug/join', requireAuth, (req, res) => setMembership(req, res, false));

const usernameSchema = z.string().trim().min(1).max(64);

async function ownerOrAdmin(req: Request, res: Response, slug: string): Promise<string | null> {
  const user = req.user!;
  const c = await pool.query<{ id: string }>('SELECT id FROM communities WHERE slug = $1', [slug]);
  if (!c.rows[0]) {
    res.status(404).json({ error: 'community_not_found' });
    return null;
  }
  if (!isAdminEmail(user.email)) {
    const r = await pool.query("SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2 AND role = 'owner'", [c.rows[0].id, user.sub]);
    if (!r.rows[0]) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
  }
  return c.rows[0].id;
}

// POST /hub/communities/:slug/mods {username} (owner/admin) -> { ok: true }
communitiesRouter.post('/communities/:slug/mods', requireAuth, async (req: Request, res: Response) => {
  const slug = parseSlug(req, res);
  if (!slug) return;
  const body = z.object({ username: usernameSchema }).safeParse(req.body ?? {});
  if (!body.success) return sendInvalidInput(res, body.error);
  const rl = await hitRateLimit(`rl:hub:mod:${req.user!.sub}`, MOD_ACTIONS_PER_HOUR, 3600);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  try {
    const communityId = await ownerOrAdmin(req, res, slug);
    if (!communityId) return;
    const u = await pool.query<{ id: string }>('SELECT id FROM users WHERE lower(username) = lower($1)', [body.data.username]);
    if (!u.rows[0]) return res.status(404).json({ error: 'user_not_found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM communities WHERE id = $1 FOR UPDATE', [communityId]);
      const ins = await client.query(
        `INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'mod')
         ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'mod' WHERE community_members.role = 'member'`,
        [communityId, u.rows[0].id]
      );
      void ins;
      // member_count must reflect actual rows (new member rows are inserted when the target had not joined).
      await client.query(
        'UPDATE communities SET member_count = (SELECT count(*) FROM community_members WHERE community_id = $1) WHERE id = $1',
        [communityId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await rollback(client);
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'add mod', { slug });
  }
});

// DELETE /hub/communities/:slug/mods/:username (owner/admin) -> { ok: true }
communitiesRouter.delete('/communities/:slug/mods/:username', requireAuth, async (req: Request, res: Response) => {
  const slug = parseSlug(req, res);
  if (!slug) return;
  const name = usernameSchema.safeParse(req.params.username);
  if (!name.success) return sendInvalidInput(res, name.error);
  try {
    const communityId = await ownerOrAdmin(req, res, slug);
    if (!communityId) return;
    await pool.query(
      `UPDATE community_members SET role = 'member'
       WHERE community_id = $1 AND role = 'mod'
         AND user_id = (SELECT id FROM users WHERE lower(username) = lower($2))`,
      [communityId, name.data]
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'remove mod', { slug });
  }
});

// ---------- search ----------

const searchSchema = z.object({
  q: z.string({ required_error: 'q is required' }).trim().min(2, 'q must be at least 2 characters').max(100, 'q must be at most 100 characters'),
  type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['posts', 'communities', 'users']).default('posts')),
  community: z.preprocess((v) => (v === '' ? undefined : typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().max(40).optional()),
});

// GET /hub/search?q=&type=posts|communities|users&community= -> { type, posts | communities | users } (max 20)
communitiesRouter.get('/search', optionalAuth, async (req: Request, res: Response) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return sendInvalidInput(res, parsed.error);
  const viewerId = req.user?.sub ?? null;
  const rl = await hitRateLimit(`rl:hub:search:${viewerId ?? req.ip ?? 'anon'}`, SEARCHES_PER_MINUTE, 60);
  if (!rl.allowed) return rateLimited(res, rl.retryAfterMs);
  const { q, type, community } = parsed.data;
  const pattern = containsPattern(q);
  try {
    if (type === 'posts') {
      const params: unknown[] = [viewerId, SEARCH_LIMIT, pattern];
      let communitySql = '';
      if (community) {
        params.push(community);
        communitySql = 'AND c.slug = $4';
      }
      const { rows } = await pool.query<PostRow>(
        `SELECT ${POST_SELECT} ${POST_FROM}
         WHERE ${NOT_HIDDEN} AND ${NOT_BLOCKED} AND (p.title ILIKE $3 OR p.body ILIKE $3) ${communitySql}
         ORDER BY p.created_at DESC, p.id DESC LIMIT $2`,
        params
      );
      return res.json({ type, posts: rows.map((r) => toPost(r, viewerId)) });
    }
    if (type === 'communities') {
      const { rows } = await pool.query<CommunityRow>(
        `SELECT ${COMMUNITY_SELECT} WHERE c.slug ILIKE $3 OR c.name ILIKE $3
         ORDER BY c.member_count DESC, c.slug ASC LIMIT $2`,
        [viewerId, SEARCH_LIMIT, pattern]
      );
      return res.json({ type, communities: rows.map(toCommunity) });
    }
    const { rows } = await pool.query<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_file: string | null;
      avatar_preset: string | null;
    }>(
      `SELECT u.id, u.username, p.display_name, p.avatar_file, p.avatar_preset
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE (u.username ILIKE $3 OR p.display_name ILIKE $3)
         AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = $1::uuid AND ub.blocked_id = u.id)
       ORDER BY u.username ASC LIMIT $2`,
      [viewerId, SEARCH_LIMIT, pattern]
    );
    res.json({
      type,
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: effectiveDisplayName(r.display_name, r.username),
        avatarUrl: avatarUrlFor(r.avatar_file),
        avatarPreset: avatarPresetFor(r.avatar_preset),
      })),
    });
  } catch (err) {
    fail(res, err, 'search');
  }
});

// ---------- user hub profiles (NOT under /api/users/*, which profiles.ts owns) ----------

interface HubUserRow {
  id: string;
  username: string;
  created_at: Date;
  display_name: string | null;
  bio: string | null;
  avatar_file: string | null;
  avatar_preset: string | null;
  post_karma: number;
  comment_karma: number;
  post_count: number;
  comment_count: number;
}

/** Resolves a username (case-insensitive); null when unknown or blocked by the viewer. */
async function resolveHubUser(username: string, viewerId: string | null) {
  const { rows } = await pool.query<HubUserRow>(
    `SELECT u.id, u.username, u.created_at, p.display_name, p.bio, p.avatar_file, p.avatar_preset,
            COALESCE(k.post_karma, 0) AS post_karma, COALESCE(k.comment_karma, 0) AS comment_karma,
            (SELECT count(*)::int FROM hub_posts x WHERE x.user_id = u.id AND x.deleted_at IS NULL) AS post_count,
            (SELECT count(*)::int FROM hub_comments x WHERE x.user_id = u.id AND x.deleted_at IS NULL) AS comment_count
     FROM users u
     LEFT JOIN user_profiles p ON p.user_id = u.id
     LEFT JOIN hub_karma k ON k.user_id = u.id
     WHERE lower(u.username) = lower($2)
       AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = $1::uuid AND ub.blocked_id = u.id)`,
    [viewerId, username]
  );
  return rows[0] ?? null;
}

// GET /hub/users/:username -> { user: {id,username,displayName,avatarUrl,avatarPreset,bio,joinedAt,postKarma,commentKarma,postCount,commentCount} }
communitiesRouter.get('/users/:username', optionalAuth, async (req: Request, res: Response) => {
  const name = usernameSchema.safeParse(req.params.username);
  if (!name.success) return res.status(404).json({ error: 'user_not_found' });
  try {
    const u = await resolveHubUser(name.data, req.user?.sub ?? null);
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    res.json({
      user: {
        id: u.id,
        username: u.username,
        displayName: effectiveDisplayName(u.display_name, u.username),
        avatarUrl: avatarUrlFor(u.avatar_file),
        avatarPreset: avatarPresetFor(u.avatar_preset),
        bio: u.bio ?? '',
        joinedAt: u.created_at.toISOString(),
        postKarma: u.post_karma,
        commentKarma: u.comment_karma,
        postCount: u.post_count,
        commentCount: u.comment_count,
      },
    });
  } catch (err) {
    fail(res, err, 'get hub user');
  }
});

// GET /hub/users/:username/posts?cursor=&limit=&sort= -> { posts, nextCursor }  (same shape as /posts)
communitiesRouter.get('/users/:username/posts', optionalAuth, async (req: Request, res: Response) => {
  const name = usernameSchema.safeParse(req.params.username);
  if (!name.success) return res.status(404).json({ error: 'user_not_found' });
  const q = z
    .object({
      cursor: cursorField,
      limit: limitField(12, 30),
      sort: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['hot', 'new', 'top', 'controversial']).default('new')),
    })
    .safeParse(req.query);
  if (!q.success) return sendInvalidInput(res, q.error);
  const viewerId = req.user?.sub ?? null;
  try {
    const u = await resolveHubUser(name.data, viewerId);
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    const result = await listPosts(viewerId, { sort: q.data.sort, t: 'all', author: u.username, cursor: q.data.cursor, limit: q.data.limit });
    if (!result) return badInput(res, 'cursor: invalid cursor');
    res.json(result);
  } catch (err) {
    fail(res, err, 'list user posts');
  }
});

// GET /hub/users/:username/comments?cursor=&limit= -> { comments: [{id,body,score,myVote,createdAt,editedAt,post:{id,title,community}}], nextCursor }
communitiesRouter.get('/users/:username/comments', optionalAuth, async (req: Request, res: Response) => {
  const name = usernameSchema.safeParse(req.params.username);
  if (!name.success) return res.status(404).json({ error: 'user_not_found' });
  const q = z.object({ cursor: cursorField, limit: limitField(20, 50) }).safeParse(req.query);
  if (!q.success) return sendInvalidInput(res, q.error);
  const viewerId = req.user?.sub ?? null;
  let cur: { ts: string; id: string } | null = null;
  if (q.data.cursor) {
    cur = decodeCursor(q.data.cursor);
    if (!cur) return badInput(res, 'cursor: invalid cursor');
  }
  try {
    const u = await resolveHubUser(name.data, viewerId);
    if (!u) return res.status(404).json({ error: 'user_not_found' });
    const params: unknown[] = [viewerId, q.data.limit + 1, u.id];
    let cursorSql = '';
    if (cur) {
      params.push(cur.ts, cur.id);
      cursorSql = 'AND (c.created_at, c.id) < ($4::timestamptz, $5::uuid)';
    }
    const { rows } = await pool.query<{
      id: string;
      body: string;
      score: number;
      my_vote: number;
      created_at: Date;
      edited_at: Date | null;
      cursor_ts: string;
      post_id: string;
      post_title: string;
      community_slug: string;
      community_name: string;
    }>(
      `SELECT c.id, c.body, c.score, COALESCE(v.value, 0)::int AS my_vote, c.created_at, c.edited_at,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
              p.id AS post_id, p.title AS post_title, cm.slug AS community_slug, cm.name AS community_name
       FROM hub_comments c
       JOIN hub_posts p ON p.id = c.post_id
       JOIN communities cm ON cm.id = p.community_id
       LEFT JOIN hub_comment_votes v ON v.comment_id = c.id AND v.user_id = $1::uuid
       WHERE c.user_id = $3 AND c.deleted_at IS NULL AND ${NOT_HIDDEN} AND ${NOT_BLOCKED} ${cursorSql}
       ORDER BY c.created_at DESC, c.id DESC LIMIT $2`,
      params
    );
    const page = rows.slice(0, q.data.limit);
    const last = page[page.length - 1];
    res.json({
      comments: page.map((r) => ({
        id: r.id,
        body: r.body,
        score: r.score,
        myVote: r.my_vote === 1 ? 1 : r.my_vote === -1 ? -1 : 0,
        createdAt: r.created_at.toISOString(),
        editedAt: r.edited_at ? r.edited_at.toISOString() : null,
        post: { id: r.post_id, title: r.post_title, community: { slug: r.community_slug, name: r.community_name } },
      })),
      nextCursor: rows.length > q.data.limit && last ? encodeCursor(last.cursor_ts, last.id) : null,
    });
  } catch (err) {
    fail(res, err, 'list user comments');
  }
});
