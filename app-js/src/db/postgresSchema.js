'use strict';

// PostgreSQL migration runner. Migrations live in migrations/postgres/NNN_name.sql
// and are each applied once, in order, recorded in schema_migrations. Runs on
// boot. Each file is executed as one multi-statement batch (no parameterised
// values, no function bodies), which both node-postgres and pglite accept.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pg = require('./postgres');
const log = require('../util/log');

const DIR = path.join(__dirname, 'migrations', 'postgres');

function load() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
      return { version: file.slice(0, 3), name: file.replace(/\.sql$/, ''), sql, checksum: crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16) };
    });
}

async function runMigrations() {
  await pg.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT to_char((now() at time zone 'utc'),'YYYY-MM-DD HH24:MI:SS')
  )`);
  const done = new Set((await pg.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
  const applied = [];
  for (const m of load()) {
    if (done.has(m.version)) continue;
    await pg.exec(m.sql);
    await pg.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
    applied.push(m.name);
    log.info('migration_applied', { migration: m.name });
  }
  return applied;
}

module.exports = { runMigrations, load, DIR };
