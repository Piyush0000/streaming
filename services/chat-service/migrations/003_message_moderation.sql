-- Soft-delete for moderation: hosts/admins can delete any stream message,
-- authors can delete their own. Rows are kept (audit trail) but excluded
-- from history.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by UUID;
