-- User profiles, user-to-user blocks, user reports.
-- Idempotent. user ids have no FK on purpose (users live in auth-service's
-- table; shared DB, separate ownership). chat-service reads user_blocks.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 32),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 190),
  avatar_file TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID NOT NULL,
  blocked_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
-- "Who blocked author X?" (used per chat message for live per-recipient filtering).
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS user_reports (
  reporter_id UUID NOT NULL,
  reported_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(reason) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_id, reported_id),
  CHECK (reporter_id <> reported_id)
);
