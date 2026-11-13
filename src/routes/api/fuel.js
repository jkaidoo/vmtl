'use strict';
// Fuel purchase logging (ports FuelLogController). Auto-captures the previous
// fill's odometer for economy, and advances the vehicle's current odometer.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const present = require('../../services/present');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict } = require('../../middleware/errorHandler');

const RULES = {
  vehicle_id: { required: true, type: 'integer' }, driver_id: { type: 'integer' },
  purchase_date: { required: true, type: 'date' }, odometer: { required: true, type: 'integer', min: 0 },
  litres: { required: true, type: 'number', min: 0.01 }, price_per_litre: { required: true, type: 'number', min: 0 },
  fuel_type: { type: 'string', maxLength: 50 }, station: { type: 'string', maxLength: 255 }, notes: { type: 'string', maxLength: 2000 },
};
const FUEL_SELECT = `SELECT f.*, v.vehicle_number, d.name AS driver_name, u.name AS recorded_by_name FROM fuel_logs f LEFT JOIN vehicles v ON v.id = f.vehicle_id LEFT JOIN drivers d ON d.id = f.driver_id LEFT JOIN users u ON u.id = f.recorded_by`;
async function fuelDto(id) { return present.fuelLog(await db.get(`${FUEL_SELECT} WHERE f.id = ?`, [id])); }

module.exports = function register(router) {
  router.get('/fuel-logs', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not view fuel logs.');
    const where = ['f.deleted_at IS NULL']; const params = [];
    if (req.query.vehicle_id) { where.push('f.vehicle_id = ?'); params.push(Number(req.query.vehicle_id)); }
    if (req.query.date_from) { where.push('substr(f.purchase_date,1,10) >= substr(?,1,10)'); params.push(req.query.date_from); }
    if (req.query.date_to) { where.push('substr(f.purchase_date,1,10) <= substr(?,1,10)'); params.push(req.query.date_to); }
    const rows = await db.all(`${FUEL_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.purchase_date DESC, f.odometer DESC`, params);
    const mapped = rows.map(present.fuelLog);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  router.post('/fuel-logs', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not log fuel purchases.');
    const data = validate(req.body, RULES);
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [data.vehicle_id]);
    if (!vehicle) throw notFound('Vehicle not found.');
    const previous = await db.get(
      `SELECT odometer FROM fuel_logs WHERE vehicle_id = ? AND deleted_at IS NULL AND (purchase_date < ? OR (purchase_date = ? AND odometer < ?)) ORDER BY purchase_date DESC, odometer DESC LIMIT 1`,
      [data.vehicle_id, data.purchase_date, data.purchase_date, data.odometer]);
    if (previous && data.odometer < previous.odometer) throw conflict(`Odometer (${data.odometer} km) cannot be below the previous fuel purchase reading (${previous.odometer} km).`);
    const totalCost = Math.round(data.litres * data.price_per_litre * 100) / 100;
    const r = await db.run(`INSERT INTO fuel_logs (vehicle_id, driver_id, recorded_by, purchase_date, odometer, previous_odometer, litres, price_per_litre, total_cost, fuel_type, station, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [data.vehicle_id, data.driver_id || null, req.session.user.id, data.purchase_date, data.odometer, previous ? previous.odometer : null, data.litres, data.price_per_litre, totalCost, data.fuel_type || null, data.station || null, data.notes || null]);
    if (data.odometer > vehicle.current_odometer) await db.run(`UPDATE vehicles SET current_odometer = ?, updated_at = ${db.now()} WHERE id = ?`, [data.odometer, vehicle.id]);
    await audit.from(req, { action: 'fuel.logged', description: `Fuel purchase (${data.litres} L) recorded for ${vehicle.vehicle_number}`, entityType: 'fuel_log', entityId: r.lastInsertRowid });
    res.status(201).json({ data: await fuelDto(r.lastInsertRowid) });
  });

  router.get('/fuel-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not view fuel logs.');
    const f = await db.get(`${FUEL_SELECT} WHERE f.id = ? AND f.deleted_at IS NULL`, [req.params.id]);
    if (!f) throw notFound('Fuel log not found.');
    res.json({ data: present.fuelLog(f) });
  });

  router.put('/fuel-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not manage fuel logs.');
    const existing = await db.get('SELECT * FROM fuel_logs WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Fuel log not found.');
    const data = validate(req.body, RULES);
    const totalCost = Math.round(data.litres * data.price_per_litre * 100) / 100;
    await db.run(`UPDATE fuel_logs SET vehicle_id = ?, driver_id = ?, purchase_date = ?, odometer = ?, litres = ?, price_per_litre = ?, total_cost = ?, fuel_type = ?, station = ?, notes = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.vehicle_id, data.driver_id || null, data.purchase_date, data.odometer, data.litres, data.price_per_litre, totalCost, data.fuel_type || null, data.station || null, data.notes || null, existing.id]);
    await audit.from(req, { action: 'fuel.updated', description: `Fuel log #${existing.id} was updated`, entityType: 'fuel_log', entityId: existing.id });
    res.json({ data: await fuelDto(existing.id) });
  });

  router.delete('/fuel-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not manage fuel logs.');
    const existing = await db.get('SELECT id FROM fuel_logs WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Fuel log not found.');
    await db.run(`UPDATE fuel_logs SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'fuel.deleted', description: `Fuel log #${existing.id} was removed`, entityType: 'fuel_log', entityId: existing.id });
    res.json({ message: 'Fuel log removed.' });
  });
};
