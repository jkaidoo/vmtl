'use strict';

// PostgreSQL gateway. Two interchangeable engines behind one async interface:
//
//   * real PostgreSQL (node-postgres `pg`) when DATABASE_URL is set — production.
//   * embedded PostgreSQL (@electric-sql/pglite, a WASM build of Postgres) with
//     an on-disk data directory otherwise — zero-dependency dev/offline runs.
//
// Both return the same normalised `{ rows, rowCount }` shape so src/db/runtime.js
// has a single code path. This mirrors the walkin reference, which uses pglite in
// development and a managed Postgres in production.
const path = require('path');

let engine = null; // resolved lazily on first query
let initPromise = null;

function usingManaged() { return Boolean(String(process.env.DATABASE_URL || '').trim()); }

function normalize(result) {
  const rows = result.rows || [];
  const rowCount = result.rowCount != null ? result.rowCount
    : (result.affectedRows != null ? result.affectedRows : rows.length);
  return { rows, rowCount };
}

async function build() {
  if (usingManaged()) {
    const pg = require('pg');
    // Return JS numbers (not strings) for bigint/int8 and numeric/decimal so the
    // API serialises counts and money as numbers, matching the SQLite path.
    pg.types.setTypeParser(20, (v) => (v == null ? null : parseInt(v, 10)));
    pg.types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v)));
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      ssl: process.env.PG_SSL === '1' ? { rejectUnauthorized: false } : undefined,
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 20_000),
      application_name: 'uits-vmtl',
    });
    pool.on('error', (err) => { try { require('../util/log').warn('pg_pool_idle_error', { message: err.message }); } catch (_) { /* ignore */ } });
    return {
      kind: 'postgres',
      pool,
      query: async (text, values) => normalize(await pool.query(text, values)),
      exec: async (sql) => { await pool.query(sql); },
      tx: async (work) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const out = await work({ query: async (t, v) => normalize(await c.query(t, v)) });
          await c.query('COMMIT');
          return out;
        } catch (err) { await c.query('ROLLBACK').catch(() => {}); throw err; }
        finally { c.release(); }
      },
      close: async () => { await pool.end().catch(() => {}); },
    };
  }

  // Embedded Postgres (pglite). Persisted so data survives restarts.
  const { PGlite } = require('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', '..', 'data', 'pg');
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    kind: 'pglite',
    pg,
    query: async (text, values) => normalize(await pg.query(text, values || [])),
    exec: async (sql) => { await pg.exec(sql); },
    tx: async (work) => pg.transaction(async (tx) => work({ query: async (t, v) => normalize(await tx.query(t, v || [])) })),
    close: async () => { try { await pg.close(); } catch (_) { /* ignore */ } },
  };
}

async function init() {
  if (engine) return engine;
  if (!initPromise) initPromise = build().then((e) => { engine = e; return e; });
  return initPromise;
}

async function query(text, values) { return (await init()).query(text, values); }
async function exec(sql) { return (await init()).exec(sql); }
async function tx(work) { return (await init()).tx(work); }
async function health() { await query('SELECT 1 AS ok'); return true; }
async function close() { if (engine) await engine.close(); engine = null; initPromise = null; }
function kind() { return engine ? engine.kind : (usingManaged() ? 'postgres' : 'pglite'); }

module.exports = { init, query, exec, tx, health, close, kind, usingManaged };
