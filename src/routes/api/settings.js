'use strict';
// System settings (ports SettingController). The 'directory' group is private to
// the Directory Authentication page and never exposed/edited here. Export redacts secrets.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const settings = require('../../services/settings');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { forbidden, badRequest } = require('../../middleware/errorHandler');

const PRIVATE = ['directory'];

module.exports = function register(router) {
  router.get('/settings', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.SETTINGS_MANAGE))) throw forbidden('You may not manage settings.');
    const rows = await db.all(`SELECT key, value, type, "group" AS grp, label FROM system_settings WHERE "group" NOT IN (${PRIVATE.map(() => '?').join(',')}) ORDER BY "group", key`, PRIVATE);
    res.json({ data: rows.map((r) => ({ key: r.key, value: settings.cast(r.value, r.type), type: r.type, group: r.grp, label: r.label })) });
  });

  router.put('/settings', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.SETTINGS_MANAGE))) throw forbidden('You may not manage settings.');
    const items = Array.isArray(req.body.settings) ? req.body.settings : null;
    if (!items) throw badRequest('The given data was invalid.', { settings: ['A settings array is required.'] });
    for (const item of items) {
      if (!item || !item.key) continue;
      const existing = await db.get('SELECT "group" AS grp FROM system_settings WHERE key = ?', [item.key]);
      if (existing && !PRIVATE.includes(existing.grp)) await settings.set(item.key, item.value);
    }
    await audit.from(req, { action: 'settings.updated', description: `${req.session.user.name} updated system settings` });
    const rows = await db.all(`SELECT key, value, type, "group" AS grp, label FROM system_settings WHERE "group" NOT IN (${PRIVATE.map(() => '?').join(',')}) ORDER BY "group", key`, PRIVATE);
    res.json({ data: rows.map((r) => ({ key: r.key, value: settings.cast(r.value, r.type), type: r.type, group: r.grp, label: r.label })) });
  });

  router.get('/settings/export', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.SETTINGS_MANAGE))) throw forbidden('You may not manage settings.');
    await audit.from(req, { action: 'settings.exported', description: `${req.session.user.name} exported a data snapshot (JSON)` });
    const redact = (k) => /password|secret/i.test(k);
    const payload = {
      meta: { application: 'UITS Vehicle Management & Trip Logging', exported_at: new Date().toISOString(), exported_by: req.session.user.email },
      roles: await db.all('SELECT id, slug, name, description FROM roles'),
      departments: await db.all('SELECT * FROM departments WHERE deleted_at IS NULL'),
      users: (await db.all('SELECT u.id, u.name, u.email, r.slug AS role, u.department_id, u.active FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.deleted_at IS NULL')).map((u) => ({ ...u, active: !!u.active, password: '[redacted]' })),
      vehicles: await db.all('SELECT * FROM vehicles WHERE deleted_at IS NULL'),
      drivers: await db.all('SELECT * FROM drivers WHERE deleted_at IS NULL'),
      vehicle_requests: await db.all('SELECT * FROM vehicle_requests WHERE deleted_at IS NULL'),
      trips: await db.all('SELECT * FROM trips WHERE deleted_at IS NULL'),
      maintenance_records: await db.all('SELECT * FROM maintenance_records WHERE deleted_at IS NULL'),
      system_settings: (await db.all('SELECT key, value, type, "group" AS grp, label FROM system_settings')).map((s) => ({ key: s.key, value: redact(s.key) ? '[redacted]' : s.value, type: s.type, group: s.grp, label: s.label })),
    };
    res.set('Content-Disposition', `attachment; filename="uits-vmtl-export_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json"`);
    res.json(payload);
  });
};
