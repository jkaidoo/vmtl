-- Unified API staff enrichment + the OU-change workflow.
-- After a directory sign-in VMTL looks the staff up in the KNUST Unified API and
-- stores their organisational unit and staff attributes here. pending_org_unit_id
-- holds an org unit the source now reports that differs from the current one,
-- awaiting admin action (then auto-applied after a grace period). can_drive marks
-- a Transport Officer who also operates trips as a driver.
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_rank          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_category      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_type          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS college_name        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_name     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unified_synced_at   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_org_unit_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_org_since   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_drive           INTEGER NOT NULL DEFAULT 0;
