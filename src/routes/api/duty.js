'use strict';
// Driver duty & roster: shifts, standby, leave and training with start/end
// times. Overlapping working duties for the same driver are rejected. Duty hours
// are summarised per driver for fatigue/overtime oversight. Org-scoped.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const audit = require('../../services/audit');
const orgScope = require('../../services/orgScope');
const enums = require('../../services/enums');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict } = require('../../middleware/errorHandler');
const systemControls = require('../../services/systemControls');

// Driver duty & roster is an optional module, off by default. Every route is
// refused until an administrator turns it on in System controls → Feature flags.
async function requireModule() {
  if (!(await systemControls.moduleEnabled('driverDuty'))) throw forbidden('Driver duty & roster is turned off.');
}

const TYPES = Object.keys(enums.dutyType.labels);
const STATUSES = Object.keys(enums.dutyStatus.labels);
const RULES = {
  driver_id: { required: true, type: 'integer' },
  duty_type: { required: true, type: 'string', in: TYPES },
  status: { type: 'string', in: STATUSES },
  start_at: { required: true, type: 'string', maxLength: 32 },
  end_at: { required: true, type: 'string', maxLength: 32 },
  notes: { type: 'string', maxLength: 1000 },
};
const norm = (v) => String(v).slice(0, 19).replace('T', ' ');
const hours = (a, b) => Math.max(0, (Date.parse(String(b).replace(' ', 'T')) - Date.parse(String(a).replace(' ', 'T'))) / 3600000);

function dutyDto(d) {
  return {
    id: d.id, driver_id: d.driver_id, driver_name: d.driver_name || null,
    org_unit_id: d.org_unit_id,
    duty_type: d.duty_type, duty_type_label: enums.dutyType.labels[d.duty_type] || d.duty_type, duty_type_color: enums.dutyType.colors[d.duty_type] || 'grey',
    status: d.status, status_label: enums.dutyStatus.labels[d.status] || d.status, status_color: enums.dutyStatus.colors[d.status] || 'grey',
    start_at: d.start_at, end_at: d.end_at, hours: Math.round(hours(d.start_at, d.end_at) * 10) / 10, notes: d.notes,
  };
}

module.exports = function register(router) {
  router.get('/duty', requireAuth, async (req, res) => {
    await requireModule();
    if (!(await has(req, CAP.DUTY_MANAGE))) throw forbidden('You may not view the roster.');
    const where = ['dd.deleted_at IS NULL']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) return res.json({ data: [] }); where.push(`dd.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    if (req.query.from) { where.push('dd.end_at >= ?'); params.push(norm(req.query.from)); }
    if (req.query.to) { where.push('dd.start_at <= ?'); params.push(norm(req.query.to) + '~'); }
    if (req.query.driver_id) { where.push('dd.driver_id = ?'); params.push(Number(req.query.driver_id)); }
    const rows = await db.all(`SELECT dd.*, d.name AS driver_name FROM driver_duties dd JOIN drivers d ON d.id = dd.driver_id WHERE ${where.join(' AND ')} ORDER BY dd.start_at`, params);
    res.json({ data: rows.map(dutyDto) });
  });

  router.get('/duty/hours', requireAuth, async (req, res) => {
    await requireModule();
    if (!(await has(req, CAP.DUTY_MANAGE))) throw forbidden();
    const where = ['dd.deleted_at IS NULL', "dd.duty_type IN ('shift','standby')", "dd.status != 'cancelled'"]; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) return res.json({ data: [] }); where.push(`dd.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    if (req.query.from) { where.push('dd.start_at >= ?'); params.push(norm(req.query.from)); }
    if (req.query.to) { where.push('dd.start_at <= ?'); params.push(norm(req.query.to) + '~'); }
    const rows = await db.all(`SELECT dd.driver_id, d.name AS driver_name, dd.start_at, dd.end_at FROM driver_duties dd JOIN drivers d ON d.id = dd.driver_id WHERE ${where.join(' AND ')}`, params);
    const map = new Map();
    for (const r of rows) { const g = map.get(r.driver_id) || { driver_id: r.driver_id, driver_name: r.driver_name, duties: 0, hours: 0 }; g.duties += 1; g.hours += hours(r.start_at, r.end_at); map.set(r.driver_id, g); }
    res.json({ data: [...map.values()].map((g) => ({ ...g, hours: Math.round(g.hours * 10) / 10 })).sort((a, b) => b.hours - a.hours) });
  });

  async function scopedDriver(req, driverId) {
    const d = await db.get('SELECT id, name, org_unit_id FROM drivers WHERE id = ? AND deleted_at IS NULL', [driverId]);
    if (!d) throw notFound('Driver not found.');
    if (!await inScope(req.session.user, d.org_unit_id)) throw forbidden('Driver is outside your scope.');
    return d;
  }
  // Overlap with another working duty (shift/standby) for the same driver.
  async function overlaps(driverId, startAt, endAt, excludeId = 0) {
    return db.get(
      `SELECT id FROM driver_duties WHERE driver_id = ? AND id != ? AND deleted_at IS NULL AND status != 'cancelled'
         AND duty_type IN ('shift','standby') AND start_at < ? AND end_at > ?`,
      [driverId, excludeId, endAt, startAt]);
  }

  router.post('/duty', requireAuth, async (req, res) => {
    await requireModule();
    if (!(await has(req, CAP.DUTY_MANAGE))) throw forbidden('You may not manage the roster.');
    const data = validate(req.body, RULES);
    const start = norm(data.start_at), end = norm(data.end_at);
    if (end <= start) throw conflict('The end time must be after the start time.');
    const driver = await scopedDriver(req, data.driver_id);
    if (['shift', 'standby'].includes(data.duty_type) && await overlaps(data.driver_id, start, end)) throw conflict('This driver already has an overlapping duty in that window.');
    const orgUnitId = await resolveOrgUnit(req.session.user, driver.org_unit_id);
    const r = await db.run(
      `INSERT INTO driver_duties (driver_id, org_unit_id, duty_type, status, start_at, end_at, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [data.driver_id, orgUnitId, data.duty_type, data.status || 'scheduled', start, end, data.notes || null, req.session.user.id]);
    await audit.from(req, { action: 'duty.created', description: `${data.duty_type} duty for ${driver.name} (${start} → ${end})`, entityType: 'driver_duty', entityId: r.lastInsertRowid });
    const row = await db.get('SELECT dd.*, d.name AS driver_name FROM driver_duties dd JOIN drivers d ON d.id = dd.driver_id WHERE dd.id = ?', [r.lastInsertRowid]);
    res.status(201).json({ data: dutyDto(row) });
  });

  router.put('/duty/:id', requireAuth, async (req, res) => {
    await requireModule();
    if (!(await has(req, CAP.DUTY_MANAGE))) throw forbidden('You may not manage the roster.');
    const existing = await db.get('SELECT * FROM driver_duties WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Duty not found.');
    if (!await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    const data = validate(req.body, RULES);
    const start = norm(data.start_at), end = norm(data.end_at);
    if (end <= start) throw conflict('The end time must be after the start time.');
    const driver = await scopedDriver(req, data.driver_id);
    if (['shift', 'standby'].includes(data.duty_type) && await overlaps(data.driver_id, start, end, existing.id)) throw conflict('This driver already has an overlapping duty in that window.');
    await db.run(
      `UPDATE driver_duties SET driver_id = ?, duty_type = ?, status = ?, start_at = ?, end_at = ?, notes = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.driver_id, data.duty_type, data.status || existing.status, start, end, data.notes || null, existing.id]);
    await audit.from(req, { action: 'duty.updated', description: `Duty #${existing.id} updated for ${driver.name}`, entityType: 'driver_duty', entityId: existing.id });
    const row = await db.get('SELECT dd.*, d.name AS driver_name FROM driver_duties dd JOIN drivers d ON d.id = dd.driver_id WHERE dd.id = ?', [existing.id]);
    res.json({ data: dutyDto(row) });
  });

  router.delete('/duty/:id', requireAuth, async (req, res) => {
    await requireModule();
    if (!(await has(req, CAP.DUTY_MANAGE))) throw forbidden('You may not manage the roster.');
    const existing = await db.get('SELECT * FROM driver_duties WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Duty not found.');
    if (!await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    await db.run(`UPDATE driver_duties SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'duty.deleted', description: `Duty #${existing.id} removed`, entityType: 'driver_duty', entityId: existing.id });
    res.json({ message: 'Duty removed.' });
  });
};
