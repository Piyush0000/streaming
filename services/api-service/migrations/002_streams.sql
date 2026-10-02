-- Live streams: audio rooms (+ optional host screen-share) with moderation,
-- a minimal follow system (follower counts gate who may host), and
-- community-guideline acceptances.

-- 1. Allow stream channels. 001_init.sql's inline CHECK is auto-named
--    channels_kind_check by Postgres; drop it (if present) and widen it.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_kind_check;
ALTER TABLE channels
  ADD CONSTRAINT channels_kind_check CHECK (kind IN ('text', 'voice', 'stream'));

-- 2. A stream's id IS its channel id (created together in one transaction).
CREATE TABLE IF NOT EXISTS streams (
  id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  host_id UUID NOT NULL,
  host_username TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('live', 'ended')) DEFAULT 'live',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- A host may have at most one live stream.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_streams_one_live_per_host
  ON streams(host_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS idx_streams_status_started ON streams(status, started_at DESC);

-- 3. Follows.
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL,
  followee_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- 4. Moderation log. Current state is DERIVED from this append-only log:
--    warnings = count of 'warn'; muted = latest of (mute, unmute) is 'mute';
--    banned = latest of (ban, unban) is 'ban'.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('warn', 'mute', 'unmute', 'kick', 'ban', 'unban')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moderation_stream_target
  ON moderation_actions(stream_id, target_user_id, created_at);

-- 5. Community guidelines acceptance (per guideline version).
CREATE TABLE IF NOT EXISTS guideline_acceptances (
  user_id UUID NOT NULL,
  version INT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);
