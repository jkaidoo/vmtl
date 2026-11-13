-- Two-factor sign-in (TOTP). The secret is stored to verify codes; totp_recovery
-- holds a JSON array of hashed one-time recovery codes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery TEXT;
