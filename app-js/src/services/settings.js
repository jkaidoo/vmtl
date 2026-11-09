'use strict';
// system_settings helpers: typed get, grouped list, and update.
const db = require('./db_ref');

function cast(value, type) {
  if (value == null) return value;
  if (type === 'integer') return parseInt(value, 10);
  if (type === 'boolean') return value === '1' || value === 1 || value === true || value === 'true';
  if (type === 'json') { try { return JSON.parse(value); } catch (_) { return null; } }
  return value;
}

async function get(key, fallback = null) {
  const row = await db.get('SELECT value, type FROM system_settings WHERE key = ?', [key]);
  if (!row) return fallback;
  const v = cast(row.value, row.type);
  return v == null ? fallback : v;
}

async function all() {
  const rows = await db.all('SELECT key, value, type, "group" AS grp, label FROM system_settings ORDER BY "group", key');
  return rows.map((r) => ({ key: r.key, value: cast(r.value, r.type), type: r.type, group: r.grp, label: r.label }));
}

async function set(key, value) {
  const row = await db.get('SELECT type FROM system_settings WHERE key = ?', [key]);
  let stored = value;
  if (row && row.type === 'boolean') stored = (value === true || value === 1 || value === '1' || value === 'true') ? '1' : '0';
  else if (row && row.type === 'json') stored = JSON.stringify(value);
  else stored = value == null ? null : String(value);
  if (row) await db.run(`UPDATE system_settings SET value = ?, updated_at = ${db.now()} WHERE key = ?`, [stored, key]);
  else await db.run(`INSERT INTO system_settings (key, value, type, "group", created_at, updated_at) VALUES (?, ?, 'string', 'general', ${db.now()}, ${db.now()})`, [key, stored]);
}

module.exports = { get, all, set, cast };
