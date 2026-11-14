CREATE TABLE IF NOT EXISTS fleet_files (
 id SERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
 kind TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
 data_base64 TEXT, storage_key TEXT, storage_profile TEXT, uploaded_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_fleet_files_entity ON fleet_files(entity_type,entity_id,kind);
CREATE TABLE IF NOT EXISTS transport_events (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, notes TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS event_schedules (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES transport_events(id),
 trip_id INTEGER NOT NULL UNIQUE REFERENCES trips(id), created_at TEXT NOT NULL DEFAULT (to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS schedule_expenses (
 id SERIAL PRIMARY KEY, schedule_id INTEGER NOT NULL REFERENCES event_schedules(id),
 category TEXT NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount>=0), description TEXT NOT NULL,
 expense_date TEXT NOT NULL, fuel_log_id INTEGER REFERENCES fuel_logs(id), recorded_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS'))
);
