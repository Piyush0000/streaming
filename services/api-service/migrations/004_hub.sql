-- Elonix Hub: public feed of trade screenshots, likes, comments, reports.
-- Safe on a populated database and idempotent (every statement is guarded).
-- user_id has no FK on purpose: users live in auth-service's table (shared DB,
-- separate ownership). username is denormalised at write time for cheap feeds.

CREATE TABLE IF NOT EXISTS hub_posts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  username TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption) <= 500),
  image_file TEXT NOT NULL,
  symbol TEXT CHECK (symbol IS NULL OR char_length(symbol) <= 20),
  side TEXT CHECK (side IS NULL OR side IN ('long', 'short', 'spot')),
  pnl_percent NUMERIC,
  like_count INT NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count INT NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
-- Feed ordering: newest first, id as tiebreaker (keyset pagination).
CREATE INDEX IF NOT EXISTS idx_hub_posts_feed ON hub_posts(created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_posts_user ON hub_posts(user_id);

CREATE TABLE IF NOT EXISTS hub_likes (
  post_id UUID NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS hub_comments (
  id UUID PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hub_comments_post ON hub_comments(post_id, created_at, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS hub_reports (
  post_id UUID NOT NULL REFERENCES hub_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
