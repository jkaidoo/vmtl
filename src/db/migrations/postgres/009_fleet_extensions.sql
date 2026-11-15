-- Fleet operations extensions: incidents, route history + geofences, work
-- orders, trip ratings, driver duty/roster, parts & tyre inventory.
-- Mirrors the SQLite tables added in src/db/sqlite.js. Money / coordinates are
-- DOUBLE PRECISION, booleans INTEGER, timestamps TEXT (UTC), matching the rest.

CREATE TABLE IF NOT EXISTS incidents (
  id              SERIAL PRIMARY KEY,
  incident_number TEXT UNIQUE NOT NULL,
  vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id       INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  trip_id         INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  org_unit_id     INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  incident_type   TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'minor',
  status          TEXT NOT NULL DEFAULT 'reported',
  occurred_at     TEXT NOT NULL,
  location_text   TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  description     TEXT NOT NULL,
  injuries        INTEGER NOT NULL DEFAULT 0,
  injury_details  TEXT,
  third_party     TEXT,
  estimated_cost  DOUBLE PRECISION,
  claim_reference TEXT,
  resolution      TEXT,
  reported_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at      TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_vehicle ON incidents(vehicle_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(org_unit_id);

CREATE TABLE IF NOT EXISTS trip_positions (
  id          SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  heading     DOUBLE PRECISION,
  speed       DOUBLE PRECISION,
  accuracy    DOUBLE PRECISION,
  recorded_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_trip_positions_trip ON trip_positions(trip_id, recorded_at);

CREATE TABLE IF NOT EXISTS geofences (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'inclusion',
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER NOT NULL,
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  deleted_at  TEXT
);
CREATE TABLE IF NOT EXISTS geofence_events (
  id          SERIAL PRIMARY KEY,
  geofence_id INTEGER NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  trip_id     INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  occurred_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_geofence_events_fence ON geofence_events(geofence_id, occurred_at);

CREATE TABLE IF NOT EXISTS work_orders (
  id                    SERIAL PRIMARY KEY,
  work_order_number     TEXT UNIQUE NOT NULL,
  vehicle_id            INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  org_unit_id           INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  maintenance_type      TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal',
  status                TEXT NOT NULL DEFAULT 'open',
  description           TEXT,
  service_provider      TEXT,
  scheduled_date        TEXT,
  due_date              TEXT,
  completed_date        TEXT,
  odometer              INTEGER,
  labour_cost           DOUBLE PRECISION,
  parts_cost            DOUBLE PRECISION,
  total_cost            DOUBLE PRECISION,
  maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE SET NULL,
  assigned_to           TEXT,
  remarks               TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at            TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status, due_date);

CREATE TABLE IF NOT EXISTS trip_ratings (
  id                SERIAL PRIMARY KEY,
  trip_id           INTEGER NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  request_id        INTEGER REFERENCES vehicle_requests(id) ON DELETE SET NULL,
  rated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  driver_id         INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  rating            INTEGER NOT NULL,
  punctuality       INTEGER,
  vehicle_condition INTEGER,
  comment           TEXT,
  flagged           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at        TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_trip_ratings_driver ON trip_ratings(driver_id);

CREATE TABLE IF NOT EXISTS driver_duties (
  id          SERIAL PRIMARY KEY,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  duty_type   TEXT NOT NULL DEFAULT 'shift',
  status      TEXT NOT NULL DEFAULT 'scheduled',
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_driver_duties_driver ON driver_duties(driver_id, start_at);

CREATE TABLE IF NOT EXISTS parts_inventory (
  id            SERIAL PRIMARY KEY,
  part_number   TEXT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'part',
  org_unit_id   INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  unit          TEXT,
  quantity      DOUBLE PRECISION NOT NULL DEFAULT 0,
  reorder_level DOUBLE PRECISION,
  unit_cost     DOUBLE PRECISION,
  location      TEXT,
  size          TEXT,
  brand         TEXT,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  updated_at    TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts_inventory(category, active);

CREATE TABLE IF NOT EXISTS part_movements (
  id            SERIAL PRIMARY KEY,
  part_id       INTEGER NOT NULL REFERENCES parts_inventory(id) ON DELETE CASCADE,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  odometer      INTEGER,
  position      TEXT,
  unit_cost     DOUBLE PRECISION,
  note          TEXT,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_part_movements_part ON part_movements(part_id, created_at);
CREATE INDEX IF NOT EXISTS idx_part_movements_vehicle ON part_movements(vehicle_id);
