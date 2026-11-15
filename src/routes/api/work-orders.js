'use strict';
// Preventive-maintenance work orders. A work order plans a job on a vehicle
// (title, type, priority, due date) and moves open → scheduled → in_progress →
// awaiting_parts → completed. Completing one with a date records a maintenance
// entry against the vehicle and updates its service markers, so the work order
// flows into the existing maintenance history.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const present = require('../../services/present');
const audit = require('../../services/audit');
const sequence = require('../../services/sequence');
const orgScope = require('../../services/orgScope');
const enums = require('../../services/enums');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound } = require('../../middleware/errorHandler');

const STATUSES = Object.keys(enums.workOrderStatus.labels);
const PRIORITIES = Object.keys(enums.workOrderPriority.labels);
const TYPES = Object.keys(enums.maintenanceType.labels);

const RULES = {
  vehicle_id: { required: true, type: 'integer' },
  title: { required: true, type: 'string', maxLength: 200 },
  maintenance_type: { type: 'string', in: TYPES },
  priority: { type: 'string', in: PRIORITIES },
  status: { type: 'string', in: STATUSES },
  description: { type: 'string', maxLength: 5000 },
  service_provider: { type: 'string', maxLength: 255 },
  scheduled_date: { type: 'date' }, due_date: { type: 'date' }, completed_date: { type: 'date' },
  odometer: { type: 'integer', min: 0 },
  labour_cost: { type: 'number', min: 0 }, parts_cost: { type: 'number', min: 0 },
  assigned_to: { type: 'string', maxLength: 200 }, remarks: { type: 'string', maxLength: 2000 },
};

const SELECT = `SELECT w.*, v.vehicle_number, o.name AS org_unit_name, o.type AS org_unit_type, u.name AS created_by_name
  FROM work_orders w
  LEFT JOIN vehicles v ON v.id = w.vehicle_id
  LEFT JOIN org_units o ON o.id = w.org_unit_id
  LEFT JOIN users u ON u.id = w.created_by`;
async function dto(id) { return present.workOrder(await db.get(`${SELECT} WHERE w.id = ?`, [id])); }
const totalCost = (labour, parts) => (labour == null && parts == null ? null : Number(labour || 0) + Number(parts || 0));

module.exports = function register(router) {
  router.get('/work-orders', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not view work orders.');
    const where = ['w.deleted_at IS NULL']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) {
      if (!scope.length) return res.json({ data: [], meta: { current_page: 1, per_page: 10, total: 0, last_page: 1 } });
      where.push(`w.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope);
    }
    if (req.query.vehicle_id) { where.push('w.vehicle_id = ?'); params.push(Number(req.query.vehicle_id)); }
    if (req.query.status) { where.push('w.status = ?'); params.push(String(req.query.status)); }
    if (req.query.open === '1') where.push("w.status NOT IN ('completed','cancelled')");
    const rows = await db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY (CASE w.status WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 1 ELSE 0 END), w.due_date IS NULL, w.due_date, w.id DESC`, params);
    const mapped = rows.map(present.workOrder);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  router.get('/work-orders/stats', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden();
    const where = ['deleted_at IS NULL']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) return res.json({ data: { open: 0, overdue: 0, awaiting_parts: 0 } }); where.push(`org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    const rows = await db.all(`SELECT status, due_date FROM work_orders WHERE ${where.join(' AND ')}`, params);
    const today = new Date().toISOString().slice(0, 10);
    const open = rows.filter((r) => !['completed', 'cancelled'].includes(r.status));
    res.json({ data: {
      open: open.length,
      overdue: open.filter((r) => r.due_date && String(r.due_date).slice(0, 10) < today).length,
      awaiting_parts: rows.filter((r) => r.status === 'awaiting_parts').length,
    } });
  });

  async function scopedVehicle(req, vehicleId) {
    const v = await db.get('SELECT id, vehicle_number, org_unit_id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]);
    if (!v) throw notFound('Vehicle not found.');
    if (!await inScope(req.session.user, v.org_unit_id)) throw forbidden('Vehicle is outside your scope.');
    return v;
  }

  // When a work order is completed with a date, mirror it into maintenance history.
  async function recordMaintenanceFor(req, wo, vehicle) {
    if (wo.status !== 'completed' || !wo.completed_date || wo.maintenance_record_id) return wo.maintenance_record_id || null;
    const r = await db.run(
      `INSERT INTO maintenance_records (vehicle_id, maintenance_type, service_date, odometer, description, cost, service_provider, remarks, recorded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [wo.vehicle_id, wo.maintenance_type || 'general_service', String(wo.completed_date).slice(0, 10), wo.odometer != null ? wo.odometer : null,
        wo.title + (wo.description ? ` — ${wo.description}` : ''), wo.total_cost, wo.service_provider || null, `From work order ${wo.work_order_number}`, req.session.user.id]);
    const updates = ['last_service_date = ?']; const uparams = [String(wo.completed_date).slice(0, 10)];
    if (wo.odometer != null) { updates.push('last_service_odometer = ?'); uparams.push(wo.odometer); }
    await db.run(`UPDATE vehicles SET ${updates.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...uparams, wo.vehicle_id]);
    return r.lastInsertRowid;
  }

  router.post('/work-orders', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not create work orders.');
    const data = validate(req.body, RULES);
    const vehicle = await scopedVehicle(req, data.vehicle_id);
    const orgUnitId = await resolveOrgUnit(req.session.user, vehicle.org_unit_id);
    const number = await sequence.next('work_orders', 'work_order_number', 'WO');
    const status = data.status || 'open';
    const total = totalCost(data.labour_cost, data.parts_cost);
    const r = await db.run(
      `INSERT INTO work_orders (work_order_number, vehicle_id, org_unit_id, title, maintenance_type, priority, status, description, service_provider, scheduled_date, due_date, completed_date, odometer, labour_cost, parts_cost, total_cost, assigned_to, remarks, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [number, data.vehicle_id, orgUnitId, data.title, data.maintenance_type || null, data.priority || 'normal', status, data.description || null, data.service_provider || null,
        data.scheduled_date ? String(data.scheduled_date).slice(0, 10) : null, data.due_date ? String(data.due_date).slice(0, 10) : null,
        data.completed_date ? String(data.completed_date).slice(0, 10) : null, data.odometer != null ? data.odometer : null,
        data.labour_cost != null ? data.labour_cost : null, data.parts_cost != null ? data.parts_cost : null, total, data.assigned_to || null, data.remarks || null, req.session.user.id]);
    const wo = await db.get(`${SELECT} WHERE w.id = ?`, [r.lastInsertRowid]);
    const mrId = await recordMaintenanceFor(req, wo, vehicle);
    if (mrId && mrId !== wo.maintenance_record_id) await db.run('UPDATE work_orders SET maintenance_record_id = ? WHERE id = ?', [mrId, wo.id]);
    await audit.from(req, { action: 'work_order.created', description: `Work order ${number} created for ${vehicle.vehicle_number}`, entityType: 'work_order', entityId: r.lastInsertRowid });
    res.status(201).json({ data: await dto(r.lastInsertRowid) });
  });

  router.put('/work-orders/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not manage work orders.');
    const existing = await db.get('SELECT * FROM work_orders WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Work order not found.');
    if (!await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    const data = validate(req.body, RULES);
    const vehicle = await scopedVehicle(req, data.vehicle_id);
    const status = data.status || existing.status;
    const total = totalCost(data.labour_cost, data.parts_cost);
    await db.run(
      `UPDATE work_orders SET vehicle_id = ?, title = ?, maintenance_type = ?, priority = ?, status = ?, description = ?, service_provider = ?, scheduled_date = ?, due_date = ?, completed_date = ?, odometer = ?, labour_cost = ?, parts_cost = ?, total_cost = ?, assigned_to = ?, remarks = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.vehicle_id, data.title, data.maintenance_type || null, data.priority || 'normal', status, data.description || null, data.service_provider || null,
        data.scheduled_date ? String(data.scheduled_date).slice(0, 10) : null, data.due_date ? String(data.due_date).slice(0, 10) : null,
        data.completed_date ? String(data.completed_date).slice(0, 10) : null, data.odometer != null ? data.odometer : null,
        data.labour_cost != null ? data.labour_cost : null, data.parts_cost != null ? data.parts_cost : null, total, data.assigned_to || null, data.remarks || null, existing.id]);
    const wo = await db.get(`${SELECT} WHERE w.id = ?`, [existing.id]);
    const mrId = await recordMaintenanceFor(req, wo, vehicle);
    if (mrId && mrId !== wo.maintenance_record_id) await db.run('UPDATE work_orders SET maintenance_record_id = ? WHERE id = ?', [mrId, wo.id]);
    await audit.from(req, { action: 'work_order.updated', description: `Work order ${existing.work_order_number} updated (status ${status})`, entityType: 'work_order', entityId: existing.id });
    res.json({ data: await dto(existing.id) });
  });

  router.delete('/work-orders/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.MAINTENANCE_MANAGE))) throw forbidden('You may not manage work orders.');
    const existing = await db.get('SELECT * FROM work_orders WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Work order not found.');
    if (!await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    await db.run(`UPDATE work_orders SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'work_order.deleted', description: `Work order ${existing.work_order_number} removed`, entityType: 'work_order', entityId: existing.id });
    res.json({ message: 'Work order removed.' });
  });
};
