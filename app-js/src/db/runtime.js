'use strict';

// Data-access bridge over SQLite (dev) and PostgreSQL (prod). Every service
// uses this one async interface — get/all/run/transaction — so there is a single
// code path regardless of engine. SQL is written with `?` placeholders (or
// `@named`), and compiled to `$1,$2,…` for PostgreSQL.
const sqlite = require('./sqlite');

function mode() {
  return String(process.env.DB_RUNTIME || '').trim().toLowerCase() === 'postgres' ? 'postgres' : 'sqlite';
}
function isPostgres() { return mode() === 'postgres'; }
function sessionMode(env = process.env) {
  const explicit = String(env.SESSION_STORE || '').toLowerCase();
  if (explicit === 'postgres' || explicit === 'sqlite') return explicit;
  return isPostgres() ? 'postgres' : 'sqlite';
}

// Translate `?` / `@name` placeholders to PostgreSQL `$n`.
function compile(sql, params = []) {
  if (Array.isArray(params)) {
    let i = 0;
    return { text: String(sql).replace(/\?/g, () => `$${++i}`), values: params };
  }
  const values = []; const positions = new Map();
  const text = String(sql).replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_m, key) => {
    if (!positions.has(key)) { positions.set(key, values.length + 1); values.push(params[key]); }
    return `$${positions.get(key)}`;
  });
  return { text, values };
}
async function pgQuery(sql, params) {
  const { query } = require('./postgres');
  const s = compile(sql, params);
  return query(s.text, s.values);
}
// Services were written against SQLite, whose run() exposes lastInsertRowid for
// free. PostgreSQL needs an explicit RETURNING, so append `RETURNING id` to any
// INSERT that lacks a RETURNING clause (every table has an `id` column).
function withReturningId(sql) {
  const s = String(sql);
  if (/^\s*insert\s/i.test(s) && !/\breturning\b/i.test(s)) return `${s.replace(/;\s*$/, '')} RETURNING id`;
  return s;
}
// Run the PostgreSQL schema migrations (no-op on SQLite, which self-creates).
async function ensureSchema() {
  if (!isPostgres()) return [];
  return require('./postgresSchema').runMigrations();
}
async function get(sql, params = []) {
  if (!isPostgres()) return sqlite.prepare(sql).get(...(Array.isArray(params) ? params : [params]));
  return (await pgQuery(sql, params)).rows[0];
}
async function all(sql, params = []) {
  if (!isPostgres()) return sqlite.prepare(sql).all(...(Array.isArray(params) ? params : [params]));
  return (await pgQuery(sql, params)).rows;
}
async function run(sql, params = []) {
  if (!isPostgres()) return sqlite.prepare(sql).run(...(Array.isArray(params) ? params : [params]));
  const result = await pgQuery(withReturningId(sql), params);
  return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id ?? null, rows: result.rows };
}
async function transaction(work) {
  if (!isPostgres()) {
    // better-sqlite3 transactions are synchronous; our `work` is async-shaped
    // but runs synchronous statements, so a manual BEGIN/COMMIT keeps one path.
    sqlite.prepare('BEGIN').run();
    try { const out = await work({ get, all, run }); sqlite.prepare('COMMIT').run(); return out; }
    catch (err) { try { sqlite.prepare('ROLLBACK').run(); } catch (_) { /* ignore */ } throw err; }
  }
  const { tx } = require('./postgres');
  return tx(async (client) => {
    const execute = async (sql, params = []) => { const s = compile(sql, params); return client.query(s.text, s.values); };
    return work({
      get: async (sql, params) => (await execute(sql, params)).rows[0],
      all: async (sql, params) => (await execute(sql, params)).rows,
      run: async (sql, params) => { const r = await execute(withReturningId(sql), params); return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id ?? null, rows: r.rows }; },
    });
  });
}
// Current timestamp SQL literal valid on the active engine.
// A SQL expression yielding the current UTC time as "YYYY-MM-DD HH:MM:SS" TEXT,
// matching how timestamps are stored on both engines (columns are TEXT).
function now() { return isPostgres() ? "to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')" : "datetime('now')"; }

module.exports = { mode, isPostgres, sessionMode, compile, get, all, run, transaction, now, ensureSchema, raw: sqlite };
