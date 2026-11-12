-- Idempotency ledger for offline sync: a client sends X-Op-Id with each queued
-- mutation; the server records the (successful) result so a replay is a no-op.
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,
  status     INTEGER NOT NULL DEFAULT 200,
  result     TEXT,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_sync_ops_created ON sync_ops(created_at);
