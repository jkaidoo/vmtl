-- Transport Schedule -----------------------------------------------------------
-- A walkin-scheduler-style roster builder: an event has centres (each needing a
-- number of drivers), a pool of drivers, and assignments of drivers to centres
-- with availability tracking, supervisors, a draft→review→publish workflow,
-- reports, notifications, revision history and roster-change requests.
-- The staff pool is the existing drivers table. Mirrors the look of migration
-- 008/009: SERIAL ids, INTEGER 0/1 flags, UTC text timestamps.

-- Reference data --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_event_types (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS ts_centres (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  region     TEXT,
  is_kumasi  INTEGER NOT NULL DEFAULT 0,
  max_cap    INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS ts_event_type_centres (
  event_type_id          INTEGER NOT NULL REFERENCES ts_event_types(id) ON DELETE CASCADE,
  centre_id              INTEGER NOT NULL REFERENCES ts_centres(id) ON DELETE CASCADE,
  default_drivers_needed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_type_id, centre_id)
);

CREATE TABLE IF NOT EXISTS ts_driver_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS ts_driver_group_members (
  group_id   INTEGER NOT NULL REFERENCES ts_driver_groups(id) ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (group_id, driver_id)
);

-- Events ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_events (
  id                 SERIAL PRIMARY KEY,
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
  created_at         TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_ts_events_type ON ts_events(event_type_id);

CREATE TABLE IF NOT EXISTS ts_event_centres (
  id             SERIAL PRIMARY KEY,
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
  imported_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (event_id, driver_id)
);

CREATE TABLE IF NOT EXISTS ts_event_driver_groups (
  event_id INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES ts_driver_groups(id) ON DELETE RESTRICT,
  PRIMARY KEY (event_id, group_id)
);

CREATE TABLE IF NOT EXISTS ts_assignments (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  centre_id  INTEGER NOT NULL REFERENCES ts_centres(id),
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  role       TEXT,
  role_name  TEXT,
  traveled   INTEGER NOT NULL DEFAULT 0,
  contacted  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (event_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_ts_assignments_event ON ts_assignments(event_id);
CREATE INDEX IF NOT EXISTS idx_ts_assignments_driver ON ts_assignments(driver_id);

CREATE TABLE IF NOT EXISTS ts_event_supervisors (
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  PRIMARY KEY (event_id, driver_id)
);

-- Availability ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_availability (
  id           SERIAL PRIMARY KEY,
  event_id     INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id    INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('available','unavailable')),
  notes        TEXT,
  contacted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contacted_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (event_id, driver_id)
);
CREATE INDEX IF NOT EXISTS idx_ts_availability_event ON ts_availability(event_id);

CREATE TABLE IF NOT EXISTS ts_availability_history (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id  INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('available','unavailable','unconfirmed')),
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS ts_availability_links (
  id           SERIAL PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,
  event_id     INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id    INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  response     TEXT CHECK (response IN ('available','unavailable')),
  responded_at TEXT,
  created_at   TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_ts_availability_links_token ON ts_availability_links(token);

-- Workflow, history, requests -------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_schedule_versions (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  revision   INTEGER NOT NULL,
  snapshot   TEXT NOT NULL,
  actor_id   INTEGER,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_ts_versions_event ON ts_schedule_versions(event_id, revision);

CREATE TABLE IF NOT EXISTS ts_driver_leave (
  id          SERIAL PRIMARY KEY,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  requested_by INTEGER,
  reviewed_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_ts_leave_driver ON ts_driver_leave(driver_id, status, start_date, end_date);

CREATE TABLE IF NOT EXISTS ts_roster_requests (
  id             SERIAL PRIMARY KEY,
  event_id       INTEGER NOT NULL REFERENCES ts_events(id) ON DELETE CASCADE,
  driver_id      INTEGER NOT NULL REFERENCES drivers(id),
  replacement_id INTEGER REFERENCES drivers(id),
  kind           TEXT NOT NULL,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  requested_by   INTEGER,
  reviewed_by    INTEGER,
  decision_note  TEXT,
  created_at     TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);

-- Notifications ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ts_message_templates (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  channel    TEXT NOT NULL DEFAULT 'sms',
  subject    TEXT,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS ts_notifications (
  id                 SERIAL PRIMARY KEY,
  event_id           INTEGER REFERENCES ts_events(id) ON DELETE SET NULL,
  channel            TEXT NOT NULL,
  recipient_count    INTEGER DEFAULT 0,
  status             TEXT,
  message            TEXT,
  detail             TEXT,
  recipient_snapshot TEXT,
  sent_at            TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
);
