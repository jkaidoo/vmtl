'use strict';

// Process lifecycle: normalise env, build the app, serve, and shut down cleanly.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { normalizeEnv } = require('./src/config/env');
const cleaned = normalizeEnv();
const log = require('./src/util/log');
if (cleaned.length) log.warn('config_env_cleaned', { names: cleaned });

const runtime = require('./src/db/runtime');
const { createApp, checkDatabase } = require('./src/app');

const PORT = Number(process.env.PORT || 8000);
// Bind to all interfaces in production (containers/PaaS like Railway route to
// 0.0.0.0, not localhost) and to loopback in dev. HOST overrides either way.
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 10_000);

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error('unhandled_rejection', { message: err.message, stack: err.stack });
});
process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { message: err.message, stack: err.stack });
  shutdown('uncaughtException', 1);
});

async function boot() {
  // PostgreSQL: create/upgrade the schema before the first request. SQLite
  // self-creates its schema on require, so this is a no-op there.
  try { const applied = await runtime.ensureSchema(); if (applied.length) log.info('schema_migrated', { applied }); }
  catch (err) { log.error('schema_migration_failed', { message: err.message, stack: err.stack }); throw err; }
  // Record each start so App Health can report server starts and uptime.
  try { await require('./src/services/audit').record({ action: 'system.server_start', description: 'Application server started' }); } catch (_) { /* non-fatal */ }
}

const app = createApp();
let server;
boot().then(() => {
  server = app.listen(PORT, HOST, async () => {
    await checkDatabase();
    log.success('server_started', { message: `VMTL listening on http://${HOST}:${PORT}`, data_store: runtime.mode() });
  });
}).catch(() => process.exit(1));

function shutdown(signal, code = 0) {
  log.info('shutdown', { signal });
  if (server) server.close(() => process.exit(code)); else process.exit(code);
  setTimeout(() => process.exit(code), GRACE_MS).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
