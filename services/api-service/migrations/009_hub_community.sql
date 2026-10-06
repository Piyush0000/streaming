-- Elonix Hub -> community platform: communities, typed posts, votes, threaded
-- comments, saves, karma. Idempotent and safe on a populated database: every
-- statement is guarded and old rows are backfilled in this same migration.
-- user ids have no FK on purpose (users live in auth-service's table).

-- ---------- scoring functions (single source of truth; mirrored in src/hubLogic.ts) ----------

-- Reddit "hot": sign(s)*log10(max(|s|,1)) + (created_epoch - 1134028003) / 45000.
-- Stored in hub_posts.hot_rank and refreshed on every vote.
CREATE OR REPLACE FUNCTION hub_hot_rank(score INT, created TIMESTAMPTZ) RETURNS NUMERIC AS $$
  SELECT round(
    sign(score::numeric) * log(greatest(abs(score), 1)::numeric)
    + (extract(epoch FROM created)::numeric - 1134028003) / 45000.0,
    7)
$$ LANGUAGE sql IMMUTABLE;

-- Reddit "controversial": (up+down) ^ (min/max); 0 unless both sides voted.
CREATE OR REPLACE FUNCTION hub_controversy(up INT, down INT) RETURNS NUMERIC AS $$
  SELECT CASE WHEN up <= 0 OR down <= 0 THEN 0::numeric
    ELSE round(power((up + down)::numeric, least(up, down)::numeric / greatest(up, down)::numeric), 6) END
$$ LANGUAGE sql IMMUTABLE;

-- Reddit "best" comment sort: lower bound of the Wilson score interval (z = 1.281551565545, 80%).
CREATE OR REPLACE FUNCTION hub_wilson(up INT, down INT) RETURNS NUMERIC AS $$
  SELECT CASE WHEN up + down <= 0 THEN 0::numeric ELSE round((
    ( (up::float8 / (up + down)) + 1.6423744151508406 / (2.0 * (up + down))
      - 1.281551565545 * sqrt( ((up::float8 / (up + down)) * (1.0 - up::float8 / (up + down)) + 1.6423744151508406 / (4.0 * (up + down))) / (up + down) )
    ) / (1.0 + 1.6423744151508406 / (up + down)))::numeric, 8) END
$$ LANGUAGE sql IMMUTABLE;

-- ---------- communities ----------

CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9_]{3,21}$'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_count INT NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  post_count INT NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  is_default BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_communities_slug ON communities(slug);
CREATE INDEX IF NOT EXISTS idx_communities_members ON communities(member_count DESC, slug);

CREATE TABLE IF NOT EXISTS community_members (
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'mod', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_members_user ON community_members(user_id);

-- Default communities (fixed ids so hub_posts.community_id can default to 'general').
INSERT INTO communities (id, slug, name, description, is_default) VALUES
  ('00000000-0000-4000-8000-000000000001', 'general', 'General', 'Everything trading and community related that does not fit elsewhere.', true),
  ('00000000-0000-4000-8000-000000000002', 'crypto', 'Crypto', 'Discuss coins, protocols, on-chain activity and market structure.', true),
  ('00000000-0000-4000-8000-000000000003', 'signals', 'Signals', 'Trade ideas and setups: entries, targets, invalidation and the reasoning behind them.', true),
  ('00000000-0000-4000-8000-000000000004', 'journal', 'Journal', 'Share your trade journal, results, lessons learned and screenshots.', true),
  ('00000000-0000-4000-8000-000000000005', 'memes', 'Memes', 'Trading humor and memes. Keep it fun and respectful.', true),
  ('00000000-0000-4000-8000-000000000006', 'help', 'Help', 'New to trading or to Elonix? Ask questions here.', true)
ON CONFLICT (slug) DO NOTHING;

-- ---------- hub_posts extensions ----------

ALTER TABLE hub_posts ALTER COLUMN image_file DROP NOT NULL;

ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'image' CHECK (type IN ('image', 'text', 'link'));
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS title TEXT CHECK (title IS NULL OR char_length(title) <= 150);
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000);
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS link_url TEXT CHECK (link_url IS NULL OR (char_length(link_url) <= 500 AND link_url ~* '^https?://'));
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS community_id UUID NOT NULL
  DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES communities(id);
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS flair TEXT CHECK (flair IS NULL OR char_length(flair) <= 24);
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0;
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS up_count INT NOT NULL DEFAULT 0 CHECK (up_count >= 0);
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS down_count INT NOT NULL DEFAULT 0 CHECK (down_count >= 0);
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS hot_rank NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE hub_posts ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Backfill old rows: title from the first caption line, body = caption.
UPDATE hub_posts
SET title = COALESCE(NULLIF(left(btrim(split_part(btrim(caption), E'\n', 1)), 150), ''), 'Untitled trade')
WHERE title IS NULL;
UPDATE hub_posts SET body = caption WHERE body = '' AND caption <> '';
ALTER TABLE hub_posts ALTER COLUMN title SET DEFAULT 'Untitled trade';
ALTER TABLE hub_posts ALTER COLUMN title SET NOT NULL;

-- ---------- votes ----------

CREATE TABLE IF NOT EXISTS hub_post_votes (
  post_id UUID NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_post_votes_user ON hub_post_votes(user_id);

-- Old likes become upvotes.
INSERT INTO hub_post_votes (post_id, user_id, value, created_at, updated_at)
SELECT post_id, user_id, 1, created_at, created_at FROM hub_likes
ON CONFLICT (post_id, user_id) DO NOTHING;

UPDATE hub_posts p
SET up_count = s.up, down_count = s.down, score = s.up - s.down
FROM (
  SELECT post_id, count(*) FILTER (WHERE value = 1)::int AS up, count(*) FILTER (WHERE value = -1)::int AS down
  FROM hub_post_votes GROUP BY post_id
) s
WHERE s.post_id = p.id AND (p.up_count <> s.up OR p.down_count <> s.down OR p.score <> s.up - s.down);
UPDATE hub_posts SET hot_rank = hub_hot_rank(score, created_at);

-- ---------- comments: threading, votes ----------

ALTER TABLE hub_comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES hub_comments(id) ON DELETE CASCADE;
ALTER TABLE hub_comments ADD COLUMN IF NOT EXISTS depth INT NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 8);
ALTER TABLE hub_comments ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0;
ALTER TABLE hub_comments ADD COLUMN IF NOT EXISTS up_count INT NOT NULL DEFAULT 0 CHECK (up_count >= 0);
ALTER TABLE hub_comments ADD COLUMN IF NOT EXISTS down_count INT NOT NULL DEFAULT 0 CHECK (down_count >= 0);
ALTER TABLE hub_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- Comment bodies may now be up to 2000 chars (was 300).
ALTER TABLE hub_comments DROP CONSTRAINT IF EXISTS hub_comments_body_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_comments_body_len' AND conrelid = 'hub_comments'::regclass) THEN
    ALTER TABLE hub_comments ADD CONSTRAINT hub_comments_body_len CHECK (char_length(body) BETWEEN 1 AND 2000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hub_comment_votes (
  comment_id UUID NOT NULL REFERENCES hub_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_comment_votes_user ON hub_comment_votes(user_id);

-- ---------- saves ----------

CREATE TABLE IF NOT EXISTS hub_post_saves (
  post_id UUID NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_post_saves_user ON hub_post_saves(user_id, created_at DESC, post_id DESC);

-- ---------- karma (denormalised; maintained transactionally by the vote handlers) ----------
-- Karma = sum of vote values on a user's live posts / comments EXCLUDING the user's own votes.

CREATE TABLE IF NOT EXISTS hub_karma (
  user_id UUID PRIMARY KEY,
  post_karma INT NOT NULL DEFAULT 0,
  comment_karma INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION hub_recompute_karma(target UUID) RETURNS VOID AS $$
  INSERT INTO hub_karma (user_id, post_karma, comment_karma, updated_at)
  SELECT target,
    COALESCE((SELECT SUM(v.value) FROM hub_post_votes v JOIN hub_posts p ON p.id = v.post_id
              WHERE p.user_id = target AND p.deleted_at IS NULL AND v.user_id <> p.user_id), 0),
    COALESCE((SELECT SUM(v.value) FROM hub_comment_votes v JOIN hub_comments c ON c.id = v.comment_id
              WHERE c.user_id = target AND c.deleted_at IS NULL AND v.user_id <> c.user_id), 0),
    now()
  ON CONFLICT (user_id) DO UPDATE
    SET post_karma = EXCLUDED.post_karma, comment_karma = EXCLUDED.comment_karma, updated_at = now()
$$ LANGUAGE sql;

SELECT hub_recompute_karma(u.user_id)
FROM (SELECT user_id FROM hub_posts UNION SELECT user_id FROM hub_comments) u;

-- ---------- counters backfill ----------

UPDATE communities c SET
  post_count = (SELECT count(*) FROM hub_posts p WHERE p.community_id = c.id AND p.deleted_at IS NULL),
  member_count = (SELECT count(*) FROM community_members m WHERE m.community_id = c.id);

-- ---------- indexes ----------

CREATE INDEX IF NOT EXISTS idx_hub_posts_community_new ON hub_posts(community_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_posts_hot ON hub_posts(hot_rank DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_posts_community_hot ON hub_posts(community_id, hot_rank DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_posts_score ON hub_posts(score DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_posts_author ON hub_posts(user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_posts_pinned ON hub_posts(community_id) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_comments_parent ON hub_comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_comments_roots ON hub_comments(post_id, created_at DESC, id DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_comments_author ON hub_comments(user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- Trigram indexes for search, only when pg_trgm can be installed (plain ILIKE works either way).
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable (%); search falls back to sequential ILIKE', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_hub_posts_title_trgm ON hub_posts USING gin (title gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_hub_posts_body_trgm ON hub_posts USING gin (body gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_communities_slug_trgm ON communities USING gin (slug gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_communities_name_trgm ON communities USING gin (name gin_trgm_ops)';
  END IF;
END $$;
