'use strict';

// SQLite connection + schema for the VMTL app. The schema is created with
// CREATE TABLE IF NOT EXISTS so a fresh database comes up ready, and additive
// `ensureColumn` migrations keep an existing database in step after upgrades.
// Dates are stored as ISO text (datetime('now')); booleans as 0/1; money as REAL.
// Ported from the Laravel migrations under backend/database/migrations.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const postgresMode = String(process.env.DB_RUNTIME || '').trim().toLowerCase() === 'postgres';
const DB_FILE = postgresMode ? ':memory:' : (process.env.VMTL_DB || path.join(__dirname, '..', '..', 'data', 'vmtl.sqlite'));
if (DB_FILE !== ':memory:') {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const existedBeforeOpen = DB_FILE !== ':memory:' && fs.existsSync(DB_FILE);
const db = new Database(DB_FILE);
db.dataFile = DB_FILE;
db.createdThisStart = DB_FILE !== ':memory:' && !existedBeforeOpen;
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
-- Roles & capabilities (runtime-editable RBAC) --------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,              -- matches RoleType
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS role_capabilities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (role_id, capability)
);

-- Flat departments (vestigial; org_units is the live hierarchy) ----------------
CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Organisational unit tree (College/Faculty/Department/Unit/Office/Directorate) -
CREATE TABLE IF NOT EXISTS org_units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT,
  type       TEXT NOT NULL DEFAULT 'unit',       -- institution/college/faculty/department/unit/office/directorate
  parent_id  INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  path       TEXT,                                -- materialised ancestor path, e.g. /1/2/5/
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_units_type ON org_units(type);
CREATE INDEX IF NOT EXISTS idx_org_units_path ON org_units(path);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);

-- Users (people who can sign in) ----------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  email              TEXT UNIQUE NOT NULL,
  password_hash      TEXT,                         -- null for directory-only accounts
  role_id            INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  department_id      INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  org_unit_id        INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  phone              TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  is_super_admin     INTEGER NOT NULL DEFAULT 0,   -- break-glass System Administrator
  directory_provider TEXT,                         -- 'ldap' | 'ad' | null (local)
  avatar             TEXT,                          -- client-compressed data URL
  last_login_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);

-- Vehicles --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_number        TEXT UNIQUE NOT NULL,
  registration_number   TEXT UNIQUE NOT NULL,
  make                  TEXT,
  model                 TEXT,
  year                  INTEGER,
  vehicle_type          TEXT,                       -- pickup/suv_midsize/saloon/bus_*/van/…
  colour                TEXT,
  capacity              INTEGER NOT NULL DEFAULT 1,
  current_odometer      INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'available',
  org_unit_id           INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  acquisition_date      TEXT,
  insurance_expiry      TEXT,
  roadworthy_expiry     TEXT,
  service_interval_km   INTEGER,
  last_service_date     TEXT,
  last_service_odometer INTEGER,
  notes                 TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON vehicles(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_active ON vehicles(active);

-- Drivers ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL, -- optional login link
  name           TEXT NOT NULL,
  employee_id    TEXT UNIQUE,
  phone          TEXT,
  licence_number TEXT,
  licence_expiry TEXT,
  status         TEXT NOT NULL DEFAULT 'available',
  org_unit_id    INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_org ON drivers(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_drivers_user ON drivers(user_id);

-- Vehicle requests ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_requests (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number         TEXT UNIQUE NOT NULL,
  requester_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id          INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  org_unit_id            INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  travel_date            TEXT NOT NULL,
  requested_start_time   TEXT NOT NULL,
  expected_end_time      TEXT NOT NULL,
  destination            TEXT NOT NULL,
  additional_destination TEXT,
  purpose                TEXT NOT NULL,
  passenger_count        INTEGER NOT NULL DEFAULT 1,
  contact_number         TEXT,
  special_requirements   TEXT,
  remarks                TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending',
  is_goodwill            INTEGER NOT NULL DEFAULT 0,
  goodwill_reason        TEXT,
  is_external            INTEGER NOT NULL DEFAULT 0,
  external_org           TEXT,
  expected_duration_days INTEGER,
  start_odometer         INTEGER,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON vehicle_requests(status, travel_date);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON vehicle_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_requests_org ON vehicle_requests(org_unit_id);

-- Approval log entries --------------------------------------------------------
CREATE TABLE IF NOT EXISTS request_approvals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_request_id INTEGER NOT NULL REFERENCES vehicle_requests(id) ON DELETE CASCADE,
  approver_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action             TEXT NOT NULL,                -- approved | rejected | changes_requested
  comment            TEXT,
  approved_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_approvals_request ON request_approvals(vehicle_request_id);

-- Trips -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_number        TEXT UNIQUE NOT NULL,
  vehicle_request_id INTEGER NOT NULL REFERENCES vehicle_requests(id) ON DELETE CASCADE,
  vehicle_id         INTEGER NOT NULL REFERENCES vehicles(id),
  driver_id          INTEGER NOT NULL REFERENCES drivers(id),
  scheduled_start    TEXT NOT NULL,
  scheduled_end      TEXT NOT NULL,
  actual_start       TEXT,
  actual_end         TEXT,
  starting_odometer  INTEGER,
  ending_odometer    INTEGER,
  distance           INTEGER,
  duration_minutes   INTEGER,
  status             TEXT NOT NULL DEFAULT 'scheduled',
  start_notes        TEXT,
  end_notes          TEXT,
  admin_remarks      TEXT,
  assigned_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ended_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_window ON trips(vehicle_id, scheduled_start, scheduled_end);
CREATE INDEX IF NOT EXISTS idx_trips_driver_window ON trips(driver_id, scheduled_start, scheduled_end);

-- Mid-trip added destinations (driver accepts/declines) -----------------------
CREATE TABLE IF NOT EXISTS trip_stops (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id      INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  destination  TEXT NOT NULL,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops(trip_id, status);

-- Maintenance records ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_records (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id            INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_type      TEXT NOT NULL,
  service_date          TEXT NOT NULL,
  odometer              INTEGER,
  description           TEXT,
  cost                  REAL,
  service_provider      TEXT,
  next_service_date     TEXT,
  next_service_odometer INTEGER,
  remarks               TEXT,
  recorded_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance_records(vehicle_id, service_date);

-- Odometer readings (audit of every reading) ----------------------------------
CREATE TABLE IF NOT EXISTS odometer_readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  trip_id     INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  reading     INTEGER NOT NULL,
  source      TEXT NOT NULL,                       -- trip_start | trip_end | correction | maintenance
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_odometer_vehicle ON odometer_readings(vehicle_id, created_at);

-- Fuel purchase logs ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id        INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id         INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  recorded_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  purchase_date     TEXT NOT NULL,
  odometer          INTEGER NOT NULL,
  previous_odometer INTEGER,
  litres            REAL NOT NULL,
  price_per_litre   REAL NOT NULL,
  total_cost        REAL NOT NULL,
  fuel_type         TEXT,
  station           TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_logs(vehicle_id, purchase_date);

-- Append-only audit ledger ----------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  action      TEXT NOT NULL,                       -- e.g. request.approved, trip.started
  description TEXT,
  entity_type TEXT,
  entity_id   INTEGER,
  old_values  TEXT,                                 -- JSON
  new_values  TEXT,                                 -- JSON
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC, id DESC);

-- System settings (key/value; type-tagged) ------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT UNIQUE NOT NULL,
  value      TEXT,
  type       TEXT NOT NULL DEFAULT 'string',       -- string|integer|boolean|json
  "group"    TEXT NOT NULL DEFAULT 'general',
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_settings_group ON system_settings("group");

-- In-app notifications (database channel) -------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,                      -- uuid
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  data       TEXT NOT NULL,                         -- JSON payload
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- Web Push subscriptions ------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL,
  endpoint_hash    TEXT NOT NULL,                   -- sha256(endpoint)
  public_key       TEXT NOT NULL,                   -- p256dh
  auth_token       TEXT NOT NULL,                   -- auth
  content_encoding TEXT NOT NULL DEFAULT 'aesgcm',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, endpoint_hash)
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Idempotency ledger for offline sync ----------------------------------------
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,
  status     INTEGER NOT NULL DEFAULT 200,
  result     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Live vehicle positions (latest fix per vehicle) ----------------------------
CREATE TABLE IF NOT EXISTS vehicle_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER NOT NULL UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  heading     REAL,
  speed       REAL,
  accuracy    REAL,
  trip_id     INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicle_positions_recorded ON vehicle_positions(recorded_at DESC);
`);

// --- Additive migrations for pre-existing databases --------------------------
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// (room for future upgrades, e.g.)
// ensureColumn('vehicles', 'new_column', 'TEXT');

// Directory (LDAP/AD) saved sign-in cache (see 005_directory_auth.sql).
ensureColumn('users', 'directory_cache_hash', 'TEXT');
ensureColumn('users', 'directory_cache_at', 'INTEGER');     // epoch milliseconds
ensureColumn('users', 'directory_cache_source', 'TEXT');    // directory id that accepted the password

// Unified API staff enrichment + OU-change workflow (see 006_staff_unified.sql).
ensureColumn('users', 'staff_id', 'TEXT');                  // Unified API staff number
ensureColumn('users', 'staff_rank', 'TEXT');
ensureColumn('users', 'designation', 'TEXT');
ensureColumn('users', 'staff_category', 'TEXT');
ensureColumn('users', 'staff_type', 'TEXT');
ensureColumn('users', 'college_name', 'TEXT');              // raw Unified API college
ensureColumn('users', 'department_name', 'TEXT');           // raw Unified API department
ensureColumn('users', 'unified_synced_at', 'TEXT');
ensureColumn('users', 'pending_org_unit_id', 'INTEGER');    // OU the source now reports, awaiting admin action
ensureColumn('users', 'pending_org_since', 'TEXT');
ensureColumn('users', 'can_drive', 'INTEGER NOT NULL DEFAULT 0'); // a Transport Officer who also drives

// Driver pre-trip inspection checklist, captured at trip start (JSON).
ensureColumn('trips', 'start_checklist', 'TEXT');

db.exec(`CREATE TABLE IF NOT EXISTS fleet_files (
 id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
 kind TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
 data_base64 TEXT, storage_key TEXT, uploaded_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fleet_files_entity ON fleet_files(entity_type,entity_id,kind);
CREATE TABLE IF NOT EXISTS transport_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, notes TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_schedules (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES transport_events(id),
 trip_id INTEGER NOT NULL UNIQUE REFERENCES trips(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS schedule_expenses (
 id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_id INTEGER NOT NULL REFERENCES event_schedules(id),
 category TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>=0), description TEXT NOT NULL,
 expense_date TEXT NOT NULL, fuel_log_id INTEGER REFERENCES fuel_logs(id), recorded_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
ensureColumn('fleet_files','storage_profile','TEXT');
ensureColumn('fleet_files','upload_key','TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_files_upload_key ON fleet_files(upload_key)');

// --- Fleet operations extensions (incidents, route history, work orders, ------
// --- ratings, driver duty, parts & tyres) ------------------------------------
db.exec(`
-- Incident & accident reports -------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
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
  latitude        REAL,
  longitude       REAL,
  description     TEXT NOT NULL,
  injuries        INTEGER NOT NULL DEFAULT 0,
  injury_details  TEXT,
  third_party     TEXT,
  estimated_cost  REAL,
  claim_reference TEXT,
  resolution      TEXT,
  reported_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_vehicle ON incidents(vehicle_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(org_unit_id);

-- Trip GPS breadcrumb trail (route history / playback) ------------------------
CREATE TABLE IF NOT EXISTS trip_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  heading     REAL,
  speed       REAL,
  accuracy    REAL,
  recorded_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trip_positions_trip ON trip_positions(trip_id, recorded_at);

-- Geofences + breach events ---------------------------------------------------
CREATE TABLE IF NOT EXISTS geofences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'inclusion',  -- inclusion | exclusion
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  radius_m    INTEGER NOT NULL,
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE TABLE IF NOT EXISTS geofence_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  geofence_id INTEGER NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  trip_id     INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,                      -- enter | exit
  latitude    REAL,
  longitude   REAL,
  occurred_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_geofence_events_fence ON geofence_events(geofence_id, occurred_at);

-- Preventive-maintenance work orders ------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
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
  labour_cost           REAL,
  parts_cost            REAL,
  total_cost            REAL,
  maintenance_record_id INTEGER REFERENCES maintenance_records(id) ON DELETE SET NULL,
  assigned_to           TEXT,
  remarks               TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status, due_date);

-- Requester trip feedback / ratings -------------------------------------------
CREATE TABLE IF NOT EXISTS trip_ratings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id           INTEGER NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  request_id        INTEGER REFERENCES vehicle_requests(id) ON DELETE SET NULL,
  rated_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  driver_id         INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  rating            INTEGER NOT NULL,             -- overall 1..5
  punctuality       INTEGER,                      -- 1..5
  vehicle_condition INTEGER,                      -- 1..5
  comment           TEXT,
  flagged           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trip_ratings_driver ON trip_ratings(driver_id);

-- Driver duty & roster --------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_duties (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  org_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  duty_type   TEXT NOT NULL DEFAULT 'shift',
  status      TEXT NOT NULL DEFAULT 'scheduled',
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_driver_duties_driver ON driver_duties(driver_id, start_at);

-- Tyre & spare-parts inventory ------------------------------------------------
CREATE TABLE IF NOT EXISTS parts_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number   TEXT,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'part',     -- tyre | part | fluid | battery | other
  org_unit_id   INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  unit          TEXT,
  quantity      REAL NOT NULL DEFAULT 0,
  reorder_level REAL,
  unit_cost     REAL,
  location      TEXT,
  size          TEXT,                             -- tyre size, e.g. 265/65R17
  brand         TEXT,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts_inventory(category, active);

-- Stock movements / fitments to a vehicle -------------------------------------
CREATE TABLE IF NOT EXISTS part_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id       INTEGER NOT NULL REFERENCES parts_inventory(id) ON DELETE CASCADE,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL,                    -- receipt | fitment | adjustment
  quantity      REAL NOT NULL,                    -- +in / -out
  odometer      INTEGER,
  position      TEXT,                             -- e.g. front-left (tyres)
  unit_cost     REAL,
  note          TEXT,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_part_movements_part ON part_movements(part_id, created_at);
CREATE INDEX IF NOT EXISTS idx_part_movements_vehicle ON part_movements(vehicle_id);
`);

// --- Transport Schedule (walkin-scheduler parity; drivers are the pool) -------
// Mirrors migrations/postgres/010_transport_schedule.sql.
db.exec(`
CREATE TABLE IF NOT EXISTS ts_event_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ts_centres (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  region     TEXT,
  is_kumasi  INTEGER NOT NULL DEFAULT 0,
  max_cap    INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ts_event_type_centres (
  event_type_id          INTEGER NOT NULL REFERENCES ts_event_types(id) ON DELETE CASCADE,
  centre_id              INTEGER NOT NULL REFERENCES ts_centres(id) ON DELETE CASCADE,
  default_drivers_needed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_type_id, centre_id)
);
CREATE TABLE IF NOT EXISTS ts_driver_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ts_driver_group_members (
  group_id   INTEGER NOT NULL REFERENCES ts_driver_groups(id) ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, driver_id)
);
CREATE TABLE IF NOT EXISTS ts_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type_id      INTEGER NOT NULL REFERENCES ts_event_types(id),
  code               TEXT,
  title              TEXT NOT NULL,
  start_date         TEXT,
  end_date           TEXT,
  start_time         TEXT,
  end_time           TEXT,
  status             TEXT NOT NULL DEFAULT 'planned',
  workflow           TEXT NOT NULL DEFAULT 'draft',
  revision           INTEGER NOT NULL DEFAULT 0,
  reviewed_revision  INTEGER,
  public_token       TEXT UNIQUE,
  published_snapshot TEXT,
  centre_order       TEXT,
  lead_role_label    TEXT,
  driver_role_label  TEXT,
  extra_role_labels  TEXT,
  report_options     TEXT,
  publish_options    TEXT,
  org_unit_id        INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ts_events_type ON ts_events(event_type_id);
CREATE TABLE IF NOT EXISTS ts_event_centres (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  centre_id      INTEGER NOT NULL REFERENCES ts_centres(id),
  drivers_needed INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  UNIQUE (event_id, centre_id)
);
CREATE INDEX IF NOT EXISTS idx_ts_event_centres_event ON ts_event_centres(event_id);
CREATE TABLE IF NOT EXISTS ts_event_pool (
  event_id    INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, driver_id)
);
CREATE TABLE IF NOT EXISTS ts_event_driver_groups (
  event_id INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES ts_driver_groups(id) ON DELETE RESTRICT,
  PRIMARY KEY (event_id, group_id)
);
CREATE TABLE IF NOT EXISTS ts_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  centre_id  INTEGER NOT NULL REFERENCES ts_centres(id),
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  role       TEXT,
  role_name  TEXT,
  traveled   INTEGER NOT NULL DEFAULT 0,
  contacted  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_ts_assignments_event ON ts_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_ts_assignments_driver ON ts_assignments(driver_id);
CREATE TABLE IF NOT EXISTS ts_event_supervisors (
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, driver_id)
);
CREATE TABLE IF NOT EXISTS ts_availability (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id    INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('available','unavailable')),
  notes        TEXT,
  contacted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contacted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_ts_availability_event ON ts_availability(event_id);
CREATE TABLE IF NOT EXISTS ts_availability_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('available','unavailable','unconfirmed')),
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ts_availability_links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token        TEXT NOT NULL UNIQUE,
  event_id     INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id    INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  response     TEXT CHECK (response IN ('available','unavailable')),
  responded_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ts_availability_links_token ON ts_availability_links(token);
CREATE TABLE IF NOT EXISTS ts_schedule_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  revision   INTEGER NOT NULL,
  snapshot   TEXT NOT NULL,
  actor_id   INTEGER,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ts_versions_event ON ts_schedule_versions(event_id, revision);
CREATE TABLE IF NOT EXISTS ts_driver_leave (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER,
  reviewed_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ts_leave_driver ON ts_driver_leave(driver_id, status, start_date, end_date);
CREATE TABLE IF NOT EXISTS ts_roster_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id      INTEGER NOT NULL REFERENCES drivers(id),
  replacement_id INTEGER REFERENCES drivers(id),
  kind           TEXT NOT NULL,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  requested_by   INTEGER,
  reviewed_by    INTEGER,
  decision_note  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ts_message_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  channel    TEXT NOT NULL DEFAULT 'sms',
  subject    TEXT,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ts_notifications (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id           INTEGER REFERENCES ts_events(id) ON DELETE SET NULL,
  channel            TEXT NOT NULL,
  recipient_count    INTEGER DEFAULT 0,
  status             TEXT,
  message            TEXT,
  detail             TEXT,
  recipient_snapshot TEXT,
  sent_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
module.exports.ensureColumn = ensureColumn;
