-- Google Sign-In support: password is now optional (Google-authenticated
-- users never set one), and we store the stable Google subject id (not just
-- email, which can theoretically change) plus an optional profile picture.

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
