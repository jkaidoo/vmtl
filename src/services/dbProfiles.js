'use strict';
// External database connection profiles for the admin console: encrypted at rest,
// connection-testable, and usable as a migration target. Passwords are AES-256-GCM
// encrypted with a key derived from DATABASE_PROFILE_ENCRYPTION_KEY (falls back to
// SESSION_SECRET for local dev). Mirrors the walkin reference.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db_ref');
const runtime = require('../db/runtime');

const PROVIDERS = { SUPABASE: 'Supabase', NEON: 'Neon', AWS_RDS: 'AWS RDS', AZURE_POSTGRES: 'Azure Database for PostgreSQL', POSTGRES: 'Generic PostgreSQL' };
// Parent-first so foreign keys resolve during a copy.
const TABLES = ['roles', 'departments', 'org_units', 'users', 'vehicles', 'drivers', 'role_capabilities', 'vehicle_requests', 'request_approvals', 'trips', 'trip_stops', 'maintenance_records', 'odometer_readings', 'fuel_logs', 'audit_logs', 'system_settings', 'notifications', 'push_subscriptions'];

function encryptionConfigured() { return !!(process.env.DATABASE_PROFILE_ENCRYPTION_KEY || process.env.SESSION_SECRET); }
function key() { return crypto.scryptSync(process.env.DATABASE_PROFILE_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'dev-secret-change-me', 'vmtl-db-profiles', 32); }
function encrypt(text) {
  if (text == null || text === '') return '';
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(blob) {
  if (!blob || !String(blob).startsWith('v1:')) return '';
  try { const raw = Buffer.from(String(blob).slice(3), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }
  catch (_) { return null; }
}

async function raw() {
  const row = await db.get("SELECT value FROM system_settings WHERE key = 'db_profiles'");
  if (!row || !row.value) return [];
  try { return JSON.parse(row.value) || []; } catch (_) { return []; }
}
async function persist(profiles) {
  const json = JSON.stringify(profiles);
  const row = await db.get("SELECT id FROM system_settings WHERE key = 'db_profiles'");
  if (row) await db.run(`UPDATE system_settings SET value = ?, type = 'json', updated_at = ${db.now()} WHERE key = 'db_profiles'`, [json]);
  else await db.run(`INSERT INTO system_settings (key, value, type, "group", created_at, updated_at) VALUES ('db_profiles', ?, 'json', 'database', ${db.now()}, ${db.now()})`, [json]);
}

function publicProfile(p) {
  return { id: p.id, name: p.name, provider: p.provider, provider_label: PROVIDERS[p.provider] || p.provider, host: p.host, port: p.port, database: p.database, username: p.username, ssl_mode: p.ssl_mode, has_password: !!p.password_enc, selected: !!p.selected, last_test: p.last_test || null, created_at: p.created_at };
}
function connString(p, password) {
  if (p.connection_url_enc) { const u = decrypt(p.connection_url_enc); if (u) return u; }
  const pw = encodeURIComponent(password != null ? password : decrypt(p.password_enc) || '');
  return `postgresql://${encodeURIComponent(p.username || '')}:${pw}@${p.host}:${p.port || 5432}/${p.database || 'postgres'}?sslmode=${p.ssl_mode || 'require'}`;
}

async function list() { return (await raw()).map(publicProfile); }

async function create(input) {
  const profiles = await raw();
  const p = {
    id: crypto.randomUUID(), name: String(input.name || '').trim(), provider: input.provider || 'POSTGRES',
    host: input.host || '', port: String(input.port || '5432'), database: input.database || 'postgres',
    username: input.username || '', ssl_mode: input.ssl_mode || 'require',
    password_enc: input.password ? encrypt(input.password) : '', connection_url_enc: input.connection ? encrypt(input.connection) : '',
    selected: false, created_at: new Date().toISOString(),
  };
  profiles.push(p); await persist(profiles); return publicProfile(p);
}
async function update(id, input) {
  const profiles = await raw(); const p = profiles.find((x) => x.id === id); if (!p) return null;
  for (const k of ['name', 'provider', 'host', 'port', 'database', 'username', 'ssl_mode']) if (k in input && input[k] !== undefined) p[k] = String(input[k]);
  if (input.password) p.password_enc = encrypt(input.password);
  if (input.connection) p.connection_url_enc = encrypt(input.connection);
  await persist(profiles); return publicProfile(p);
}
async function remove(id) { const profiles = await raw(); const next = profiles.filter((x) => x.id !== id); await persist(next); return next.length !== profiles.length; }
async function select(id) { const profiles = await raw(); profiles.forEach((x) => { x.selected = x.id === id; }); await persist(profiles); }

async function test(id) {
  const profiles = await raw(); const p = profiles.find((x) => x.id === id); if (!p) throw new Error('Profile not found.');
  const { Client } = require('pg');
  const client = new Client({ connectionString: connString(p), ssl: p.ssl_mode === 'disable' ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  let result;
  try { await client.connect(); const r = await client.query('SELECT current_database() AS db, version() AS version'); result = { ok: true, database: r.rows[0].db, version: String(r.rows[0].version).split(' ').slice(0, 2).join(' ') }; }
  catch (err) { result = { ok: false, reason: err.message }; }
  finally { await client.end().catch(() => {}); }
  p.last_test = { ok: result.ok, at: new Date().toISOString(), reason: result.reason || null };
  await persist(profiles); return result;
}

// Copy every table from the live engine into the target PostgreSQL profile.
async function migrate(id) {
  const profiles = await raw(); const p = profiles.find((x) => x.id === id); if (!p) throw new Error('Profile not found.');
  const { Client } = require('pg');
  const client = new Client({ connectionString: connString(p), ssl: p.ssl_mode === 'disable' ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10000, statement_timeout: 120000 });
  const copied = [];
  await client.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', 'postgres', '001_boot_schema.sql'), 'utf8');
    await client.query(schema); // CREATE TABLE IF NOT EXISTS — safe on an existing target
    for (const table of TABLES) {
      const rows = await runtime.all(`SELECT * FROM ${table}`);
      let inserted = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        const ph = cols.map((_, i) => `$${i + 1}`).join(',');
        const quoted = cols.map((c) => `"${c}"`).join(',');
        const r = await client.query(`INSERT INTO ${table} (${quoted}) VALUES (${ph}) ON CONFLICT DO NOTHING`, cols.map((c) => row[c]));
        inserted += r.rowCount;
      }
      copied.push({ table, source: rows.length, inserted });
      if (['id'].every(() => true)) {
        try { await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM ${table}), 1))`); } catch (_) { /* no serial id (e.g. notifications) */ }
      }
    }
  } finally { await client.end().catch(() => {}); }
  return { ok: true, copied };
}

async function activeStore() {
  return {
    runtime: runtime.mode(),
    data: { provider: runtime.isPostgres() ? (process.env.DATABASE_URL ? 'PostgreSQL' : 'Embedded PostgreSQL (pglite)') : 'SQLite', detail: runtime.isPostgres() ? (process.env.DATABASE_URL ? 'DATABASE_URL' : 'app-js/data/pg') : (process.env.VMTL_DB || 'data/vmtl.sqlite') },
    sessions: { provider: runtime.sessionMode() === 'postgres' ? 'PostgreSQL (app_sessions)' : 'SQLite', detail: '' },
  };
}

module.exports = { PROVIDERS, TABLES, encryptionConfigured, list, create, update, remove, select, test, migrate, activeStore };
