'use strict';
// Maintenance records (ports MaintenanceRecordController). Keeps the vehicle's
// last-service markers in step with the newest record.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const present = require('../../services/present');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound } = require('../../middleware/errorHandler');

const RULES = {
  vehicle_id: { required: true, type: 'integer' },
  maintenance_type: { required: true, type: 'string', in: ['oil_change', 'tyres', 'brake_service', 'general_service', 'engine_repair', 'electrical_repair', 'other'] },
  service_date: { required: true, type: 'date' }, odometer: { type: 'integer', min: 0 }, description: { type: 'string', maxLength: 2000 },
  cost: { type: 'number', min: 0 }, service_provider: { type: 'string', maxLength: 255 }, next_service_date: { type: 'date' },
  next_service_odometer: { type: 'integer', min: 0 }, remarks: { type: 'string', maxLength: 2000 },
};
const SELECT = `SELECT m.*, v.vehicle_number, u.name AS recorded_by_name FROM maintenance_records m LEFT JOIN vehicles v ON v.id = m.vehicle_id LEFT JOIN users u ON u.id = m.recorded_by`;
async function dto(id) { return present.maintenance(await db.get(`${SELECT} WHERE m.id = ?`, [id])); }

module.exports = function register(router) {
  router.get('/maintenance-records', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not view maintenance records.');
    const where = ['m.deleted_at IS NULL']; const params = [];
    if (req.query.vehicle_id) { where.push('m.vehicle_id = ?'); params.push(Number(req.query.vehicle_id)); }
    if (req.query.maintenance_type) { where.push('m.maintenance_type = ?'); params.push(String(req.query.maintenance_type)); }
    const rows = await db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY m.service_date DESC`, params);
    const mapped = rows.map(present.maintenance);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  router.post('/maintenance-records', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not record maintenance.');
    const data = validate(req.body, RULES);
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [data.vehicle_id]);
    if (!vehicle) throw notFound('Vehicle not found.');
    const r = await db.run(`INSERT INTO maintenance_records (vehicle_id, maintenance_type, service_date, odometer, description, cost, service_provider, next_service_date, next_service_odometer, remarks, recorded_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [data.vehicle_id, data.maintenance_type, String(data.service_date).slice(0, 10), data.odometer != null ? data.odometer : null, data.description || null, data.cost != null ? data.cost : null, data.service_provider || null, data.next_service_date ? String(data.next_service_date).slice(0, 10) : null, data.next_service_odometer != null ? data.next_service_odometer : null, data.remarks || null, req.session.user.id]);
    const updates = ['last_service_date = ?']; const uparams = [String(data.service_date).slice(0, 10)];
    if (data.odometer != null) { updates.push('last_service_odometer = ?'); uparams.push(data.odometer); }
    await db.run(`UPDATE vehicles SET ${updates.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...uparams, vehicle.id]);
    await audit.from(req, { action: 'maintenance.created', description: `Maintenance (${data.maintenance_type}) recorded for ${vehicle.vehicle_number}`, entityType: 'maintenance_record', entityId: r.lastInsertRowid });
    res.status(201).json({ data: await dto(r.lastInsertRowid) });
  });

  router.get('/maintenance-records/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not view maintenance records.');
    const m = await db.get(`${SELECT} WHERE m.id = ? AND m.deleted_at IS NULL`, [req.params.id]);
    if (!m) throw notFound('Maintenance record not found.');
    res.json({ data: present.maintenance(m) });
  });

  router.put('/maintenance-records/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not manage maintenance records.');
    const existing = await db.get('SELECT id FROM maintenance_records WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Maintenance record not found.');
    const data = validate(req.body, RULES);
    await db.run(`UPDATE maintenance_records SET vehicle_id = ?, maintenance_type = ?, service_date = ?, odometer = ?, description = ?, cost = ?, service_provider = ?, next_service_date = ?, next_service_odometer = ?, remarks = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.vehicle_id, data.maintenance_type, String(data.service_date).slice(0, 10), data.odometer != null ? data.odometer : null, data.description || null, data.cost != null ? data.cost : null, data.service_provider || null, data.next_service_date ? String(data.next_service_date).slice(0, 10) : null, data.next_service_odometer != null ? data.next_service_odometer : null, data.remarks || null, existing.id]);
    await audit.from(req, { action: 'maintenance.updated', description: `Maintenance record #${existing.id} was updated`, entityType: 'maintenance_record', entityId: existing.id });
    res.json({ data: await dto(existing.id) });
  });

  router.delete('/maintenance-records/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not manage maintenance records.');
    const existing = await db.get('SELECT id FROM maintenance_records WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Maintenance record not found.');
    await db.run(`UPDATE maintenance_records SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'maintenance.deleted', description: `Maintenance record #${existing.id} was removed`, entityType: 'maintenance_record', entityId: existing.id });
    res.json({ message: 'Maintenance record removed.' });
  });
};
