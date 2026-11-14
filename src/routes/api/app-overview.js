'use strict';
// GET /api/admin/app-overview — live figures for the App Owner's Application
// overview page: fleet and activity totals, roles in use, the configurable
// catalogue sizes and the platform the server is running on. Read-only.
const fs = require('fs');
const path = require('path');
const db = require('../../db/runtime');
const { requireAuth } = require('../../middleware/auth');
const { requirePage } = require('../../services/ownerAccess');
const capabilities = require('../../services/capabilities');
const roles = require('../../services/roles');

const num = (v) => Number(v || 0);
const countFiles = (dir, pattern) => { try { return fs.readdirSync(dir).filter((f) => pattern.test(f)).length; } catch (_) { return 0; } };

module.exports = function register(router) {
  router.get('/admin/app-overview', requireAuth, requirePage('app-overview'), async (req, res) => {
    const one = async (sql) => num((await db.get(sql)).n);
    const trips = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),0) AS done, COALESCE(SUM(CASE WHEN status = 'completed' THEN distance ELSE 0 END),0) AS km FROM trips WHERE deleted_at IS NULL");
    const fuel = await db.get('SELECT COALESCE(SUM(litres),0) AS litres, COALESCE(SUM(total_cost),0) AS cost FROM fuel_logs WHERE deleted_at IS NULL');
    const files = await db.get('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM fleet_files');
    const usage = {
      vehicles: await one('SELECT COUNT(*) AS n FROM vehicles WHERE deleted_at IS NULL'),
      vehicles_active: await one('SELECT COUNT(*) AS n FROM vehicles WHERE deleted_at IS NULL AND active = 1'),
      drivers: await one('SELECT COUNT(*) AS n FROM drivers WHERE deleted_at IS NULL'),
      users: await one('SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND active = 1'),
      org_units: await one('SELECT COUNT(*) AS n FROM org_units'),
      requests: await one('SELECT COUNT(*) AS n FROM vehicle_requests WHERE deleted_at IS NULL'),
      trips: num(trips.n), trips_completed: num(trips.done), km_travelled: Math.round(num(trips.km)),
      fuel_litres: Math.round(num(fuel.litres)), fuel_cost: Math.round(num(fuel.cost)),
      maintenance_records: await one('SELECT COUNT(*) AS n FROM maintenance_records WHERE deleted_at IS NULL'),
      idl_events: await one('SELECT COUNT(*) AS n FROM transport_events'),
      idl_schedules: await one('SELECT COUNT(*) AS n FROM event_schedules'),
      files: num(files.n), file_bytes: num(files.bytes),
      audit_entries: await one('SELECT COUNT(*) AS n FROM audit_logs'),
    };
    const roleRows = await db.all(`SELECT r.slug, r.name,
        (SELECT COUNT(*) FROM role_capabilities c WHERE c.role_id = r.id) AS caps,
        (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.active = 1 AND u.deleted_at IS NULL) AS users
      FROM roles r ORDER BY r.id`);
    const navigation = require('../../services/navigation');
    const catalogue = {
      capabilities: capabilities.all().length,
      notification_templates: (await require('../../services/messageTemplates').catalogue('email')).meta.length,
      dropdown_lists: Object.keys(await require('../../services/dropdowns').options()).length,
      pages: navigation.catalogue.reduce((n, section) => n + section.items.length, 0),
      api_modules: countFiles(__dirname, /\.js$/),
      migrations: countFiles(path.join(__dirname, '../../db/migrations/postgres'), /^\d{3}_.+\.sql$/),
    };
    const platform = {
      version: require('../../../package.json').version,
      engine: db.isPostgres() ? (process.env.DATABASE_URL ? 'PostgreSQL' : 'Embedded PostgreSQL') : 'SQLite',
      node: process.version,
      uptime_seconds: Math.round(process.uptime()),
    };
    res.set('Cache-Control', 'no-store');
    res.json({ data: {
      generated_at: new Date().toISOString(), platform, usage, catalogue,
      roles: roleRows.map((r) => ({ slug: r.slug, label: roles.LABELS[r.slug] || r.name, capabilities: num(r.caps), users: num(r.users) })),
    } });
  });
};
