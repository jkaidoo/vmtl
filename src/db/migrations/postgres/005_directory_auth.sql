-- Directory (LDAP/AD) saved sign-in cache.
-- When every enabled directory is unreachable, a directory account may sign in
-- with the password a directory last accepted, for a configurable window. The
-- hash is bcrypt; _at is epoch milliseconds; _source is the directory id that
-- accepted it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS directory_cache_hash   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS directory_cache_at     BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS directory_cache_source TEXT;
