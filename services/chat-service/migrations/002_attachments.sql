-- File/image uploads in chat: a message has at most one attachment in
-- Phase 1, so plain columns on `messages` are simpler than a join table.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
