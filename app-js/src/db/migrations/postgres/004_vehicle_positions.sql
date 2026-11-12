-- Live vehicle positions: the latest GPS fix per vehicle, upserted on vehicle_id.
-- Driver devices POST their location while on an in-progress trip; the Live Map
-- reads the scoped set. An explicit id column is kept because the runtime
-- auto-appends RETURNING id to PostgreSQL inserts.
CREATE TABLE IF NOT EXISTS vehicle_positions (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  INTEGER NOT NULL UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  heading     DOUBLE PRECISION,
  speed       DOUBLE PRECISION,
  accuracy    DOUBLE PRECISION,
  trip_id     INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_recorded ON vehicle_positions(recorded_at DESC);
