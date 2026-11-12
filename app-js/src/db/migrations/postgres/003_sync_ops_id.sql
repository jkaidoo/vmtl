-- The runtime auto-appends RETURNING id to PostgreSQL inserts, so sync_ops needs
-- an id column even though op_id is its primary key.
ALTER TABLE sync_ops ADD COLUMN IF NOT EXISTS id BIGSERIAL;
