ALTER TABLE fleet_files ADD COLUMN IF NOT EXISTS upload_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_files_upload_key ON fleet_files(upload_key);
