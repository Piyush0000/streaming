-- Private channels, channel members/roles, invite links, per-channel capacity.
-- Safe on a populated database and idempotent (every statement is guarded).

-- 1. Visibility + optional participant limit (voice rooms). NULL = platform default.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));
ALTER TABLE channels ADD COLUMN IF NOT EXISTS max_participants INT
  CHECK (max_participants IS NULL OR max_participants >= 2);

-- 2. Membership. user_id has no FK on purpose: users live in auth-service's
--    table (shared DB, separate ownership).
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'mod', 'member')),
  added_by UUID,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);
-- Exactly one owner per channel.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel_members_one_owner
  ON channel_members(channel_id) WHERE role = 'owner';

-- 3. Invite links.
CREATE TABLE IF NOT EXISTS channel_invites (
  token TEXT PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INT CHECK (max_uses IS NULL OR max_uses >= 1),
  uses INT NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channel_invites_channel ON channel_invites(channel_id);

-- 4. Backfill: every existing channel (stream channels too) gets its creator as owner.
INSERT INTO channel_members (channel_id, user_id, role, added_by)
SELECT id, created_by, 'owner', created_by FROM channels
ON CONFLICT (channel_id, user_id) DO NOTHING;
