'use strict';
// Vehicles (ports VehicleController): scoped list, CRUD (soft delete),
// (de)activate, per-vehicle trip history and fuel spend & economy.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const loaders = require('../../services/loaders');
const present = require('../../services/present');
const enums = require('../../services/enums');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict, badRequest } = require('../../middleware/errorHandler');

const VEHICLE_RULES = {
  vehicle_number: { required: true, type: 'string', maxLength: 50 },
  registration_number: { required: true, type: 'string', maxLength: 50 },
  make: { type: 'string', maxLength: 100 }, model: { type: 'string', maxLength: 100 },
  year: { type: 'integer', min: 1950, max: new Date().getFullYear() + 1 },
  vehicle_type: { type: 'string', in: Object.keys(require('../../services/enums').vehicleType.options().reduce((a, o) => (a[o.value] = 1, a), {})) },
  colour: { type: 'string', maxLength: 50 }, capacity: { required: true, type: 'integer', min: 0, max: 150 },
  current_odometer: { type: 'integer', min: 0 }, org_unit_id: { type: 'integer' },
  acquisition_date: { type: 'date' }, insurance_expiry: { type: 'date' }, roadworthy_expiry: { type: 'date' },
  service_interval_km: { type: 'integer', min: 0 }, last_service_date: { type: 'date' }, last_service_odometer: { type: 'integer', min: 0 },
  notes: { type: 'string', maxLength: 2000 },
};

async function findVehicle(id) { const v = await db.get('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [id]); if (!v) throw notFound('Vehicle not found.'); return v; }
async function uniqueCheck(field, value, exceptId) {
  const row = await db.get(`SELECT id FROM vehicles WHERE ${field} = ? AND deleted_at IS NULL ${exceptId ? 'AND id != ?' : ''}`, exceptId ? [value, exceptId] : [value]);
  if (row) throw badRequest('The given data was invalid.', { [field]: [`That ${field.replace('_', ' ')} is already in use.`] });
}

module.exports = function register(router) {
  router.get('/vehicles', requireAuth, async (req, res) => {
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['v.deleted_at IS NULL']; const params = [];
    if (scope !== null) { if (!scope.length) return res.json({ data: [] }); where.push(`v.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    if (req.query.status) { where.push('v.status = ?'); params.push(String(req.query.status)); }
    if (req.query.active_only === 'true' || req.query.active_only === '1') where.push('v.active = 1');
    if (req.query.org_unit_id) { where.push('v.org_unit_id = ?'); params.push(Number(req.query.org_unit_id)); }
    if (req.query.search) { const s = `%${req.query.search}%`; where.push('(v.vehicle_number LIKE ? OR v.registration_number LIKE ? OR v.make LIKE ? OR v.model LIKE ?)'); params.push(s, s, s, s); }
    const whereSql = where.join(' AND ');
    const rows = await db.all(`${loaders.VEHICLE_SELECT} WHERE ${whereSql} ORDER BY v.vehicle_number`, params);
    const mapped = rows.map(present.vehicle);
    if (req.query.all === 'true' || req.query.all === '1') return res.json({ data: mapped });
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  router.post('/vehicles', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.VEHICLES_MANAGE))) throw forbidden('You may not manage vehicles.');
    const data = validate(req.body, VEHICLE_RULES);
    await uniqueCheck('vehicle_number', data.vehicle_number); await uniqueCheck('registration_number', data.registration_number);
    const orgUnitId = await resolveOrgUnit(req.session.user, data.org_unit_id);
    const cols = ['vehicle_number', 'registration_number', 'make', 'model', 'year', 'vehicle_type', 'colour', 'capacity', 'current_odometer', 'org_unit_id', 'acquisition_date', 'insurance_expiry', 'roadworthy_expiry', 'service_interval_km', 'last_service_date', 'last_service_odometer', 'notes'];
    const vals = cols.map((c) => (c === 'org_unit_id' ? orgUnitId : (c === 'current_odometer' ? (data.current_odometer || 0) : (data[c] !== undefined ? data[c] : null))));
    const r = await db.run(`INSERT INTO vehicles (${cols.join(',')}, status, active, created_at, updated_at) VALUES (${cols.map(() => '?').join(',')}, 'available', 1, ${db.now()}, ${db.now()})`, vals);
    await audit.from(req, { action: 'vehicle.created', description: `Vehicle ${data.vehicle_number} was added`, entityType: 'vehicle', entityId: r.lastInsertRowid });
    res.status(201).json({ data: present.vehicle(await db.get(`${loaders.VEHICLE_SELECT} WHERE v.id = ?`, [r.lastInsertRowid])) });
  });

  router.get('/vehicles/:id', requireAuth, async (req, res) => {
    const v = await db.get(`${loaders.VEHICLE_SELECT} WHERE v.id = ? AND v.deleted_at IS NULL`, [req.params.id]);
    if (!v) throw notFound('Vehicle not found.');
    res.json({ data: present.vehicle(v) });
  });

  router.put('/vehicles/:id', requireAuth, async (req, res) => {
    const vehicle = await findVehicle(req.params.id);
    if (!(await has(req, CAP.VEHICLES_MANAGE)) || !(await inScope(req.session.user, vehicle.org_unit_id))) throw forbidden('You may not manage this vehicle.');
    const data = validate(req.body, VEHICLE_RULES);
    if (data.vehicle_number !== vehicle.vehicle_number) await uniqueCheck('vehicle_number', data.vehicle_number, vehicle.id);
    if (data.registration_number !== vehicle.registration_number) await uniqueCheck('registration_number', data.registration_number, vehicle.id);
    if (req.body.org_unit_id !== undefined) data.org_unit_id = await resolveOrgUnit(req.session.user, data.org_unit_id);
    const fields = []; const params = [];
    for (const k of Object.keys(VEHICLE_RULES)) if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(data[k]); }
    if (fields.length) await db.run(`UPDATE vehicles SET ${fields.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, vehicle.id]);
    await audit.from(req, { action: 'vehicle.updated', description: `Vehicle ${vehicle.vehicle_number} was updated`, entityType: 'vehicle', entityId: vehicle.id });
    res.json({ data: present.vehicle(await db.get(`${loaders.VEHICLE_SELECT} WHERE v.id = ?`, [vehicle.id])) });
  });

  router.post('/vehicles/:id/active', requireAuth, async (req, res) => {
    const vehicle = await findVehicle(req.params.id);
    if (!(await has(req, CAP.VEHICLES_MANAGE)) || !(await inScope(req.session.user, vehicle.org_unit_id))) throw forbidden('You may not manage this vehicle.');
    const active = req.body.active === true || req.body.active === 1 || req.body.active === '1' || req.body.active === 'true';
    if (!active && ['on_trip', 'scheduled'].includes(vehicle.status)) throw conflict('This vehicle is on a trip or scheduled and cannot be deactivated.');
    await db.run(`UPDATE vehicles SET active = ?, status = ?, updated_at = ${db.now()} WHERE id = ?`, [active ? 1 : 0, active ? 'available' : 'inactive', vehicle.id]);
    await audit.from(req, { action: active ? 'vehicle.activated' : 'vehicle.deactivated', description: `Vehicle ${vehicle.vehicle_number} was ${active ? 'reactivated' : 'deactivated'}`, entityType: 'vehicle', entityId: vehicle.id });
    res.json({ data: present.vehicle(await db.get(`${loaders.VEHICLE_SELECT} WHERE v.id = ?`, [vehicle.id])) });
  });

  router.delete('/vehicles/:id', requireAuth, async (req, res) => {
    const vehicle = await findVehicle(req.params.id);
    if (!(await has(req, CAP.VEHICLES_MANAGE)) || !(await inScope(req.session.user, vehicle.org_unit_id))) throw forbidden('You may not manage this vehicle.');
    await db.run(`UPDATE vehicles SET deleted_at = ${db.now()} WHERE id = ?`, [vehicle.id]);
    await audit.from(req, { action: 'vehicle.deleted', description: `Vehicle ${vehicle.vehicle_number} was removed`, entityType: 'vehicle', entityId: vehicle.id });
    res.json({ message: 'Vehicle removed.' });
  });

  router.get('/vehicles/:id/trips', requireAuth, async (req, res) => {
    await findVehicle(req.params.id);
    const rows = await db.all("SELECT id FROM trips WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY scheduled_start DESC LIMIT 50", [req.params.id]);
    const data = []; for (const r of rows) data.push(await loaders.loadTrip(r.id, { withRequest: true, withStops: false }));
    res.json({ data });
  });

  router.get('/vehicles/:id/fuel', requireAuth, async (req, res) => {
    const vehicle = await findVehicle(req.params.id);
    const agg = await db.get('SELECT COALESCE(SUM(total_cost),0) AS cost, COALESCE(SUM(litres),0) AS litres, COUNT(*) AS fills FROM fuel_logs WHERE vehicle_id = ? AND deleted_at IS NULL', [vehicle.id]);
    const measured = await db.get('SELECT COALESCE(SUM(odometer - previous_odometer),0) AS dist, COALESCE(SUM(litres),0) AS litres, COALESCE(SUM(total_cost),0) AS cost FROM fuel_logs WHERE vehicle_id = ? AND previous_odometer IS NOT NULL AND deleted_at IS NULL', [vehicle.id]);
    const last = await db.get('SELECT purchase_date FROM fuel_logs WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY purchase_date DESC, odometer DESC LIMIT 1', [vehicle.id]);
    const recent = await db.all(`SELECT f.*, d.name AS driver_name FROM fuel_logs f LEFT JOIN drivers d ON d.id = f.driver_id WHERE f.vehicle_id = ? AND f.deleted_at IS NULL ORDER BY f.purchase_date DESC, f.odometer DESC LIMIT 10`, [vehicle.id]);
    const r3 = (n) => (n == null ? null : Math.round(n * 1000) / 1000);
    res.json({
      summary: {
        total_cost: Math.round(agg.cost * 100) / 100, total_litres: Math.round(agg.litres * 100) / 100, fills: agg.fills,
        avg_price_per_litre: agg.litres > 0 ? r3(agg.cost / agg.litres) : null,
        km_per_litre: measured.litres > 0 ? r3(measured.dist / measured.litres) : null,
        cost_per_km: measured.dist > 0 ? r3(measured.cost / measured.dist) : null,
        measured_distance: measured.dist, last_purchase_date: last ? last.purchase_date : null,
      },
      recent: recent.map(present.fuelLog),
    });
  });
};
