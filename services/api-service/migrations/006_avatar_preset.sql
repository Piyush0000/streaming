-- Preset (illustrated character) avatars. Nullable; validated against an
-- allowlist in application code (src/profile.ts). Idempotent.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_preset TEXT;
