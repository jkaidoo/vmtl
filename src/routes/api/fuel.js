'use strict';
// Fuel purchase logging (ports FuelLogController). Auto-captures the previous
// fill's odometer for economy, and advances the vehicle's current odometer.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope } = require('../../services/authz');
const present = require('../../services/present');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict } = require('../../middleware/errorHandler');

const RULES = {
  schedule_id: {type:'integer',min:1},
  vehicle_id: { required: true, type: 'integer' }, driver_id: { type: 'integer' },
  purchase_date: { required: true, type: 'date' }, odometer: { required: true, type: 'integer', min: 0 },
  litres: { required: true, type: 'number', min: 0.01 }, price_per_litre: { required: true, type: 'number', min: 0 },
  fuel_type: { required:true, type: 'string', maxLength: 50 }, station: { type: 'string', maxLength: 255 }, notes: { type: 'string', maxLength: 2000 },
};
const FUEL_SELECT = `SELECT f.*, (SELECT schedule_id FROM schedule_expenses WHERE fuel_log_id=f.id LIMIT 1) AS schedule_id, v.vehicle_number, d.name AS driver_name, u.name AS recorded_by_name FROM fuel_logs f LEFT JOIN vehicles v ON v.id = f.vehicle_id LEFT JOIN drivers d ON d.id = f.driver_id LEFT JOIN users u ON u.id = f.recorded_by`;
async function fuelDto(id) { return present.fuelLog(await db.get(`${FUEL_SELECT} WHERE f.id = ?`, [id])); }

// Lock vehicles in a stable order before changing a fuel history.
async function lockVehicles(tx,ids){
  for(const id of [...new Set(ids.map(Number))].sort((a,b)=>a-b)) await tx.get('SELECT id FROM vehicles WHERE id=?'+(db.isPostgres()?' FOR UPDATE':''),[id]);
}
async function rebuildReadings(tx,vehicleId){
  const rows=await tx.all('SELECT id,purchase_date,odometer,previous_odometer FROM fuel_logs WHERE vehicle_id=? AND deleted_at IS NULL',[vehicleId]);
  rows.sort((a,b)=>Date.parse(a.purchase_date)-Date.parse(b.purchase_date)||Number(a.odometer)-Number(b.odometer)||Number(a.id)-Number(b.id));
  let previous=null;
  for(const row of rows){
    const odometer=Number(row.odometer);
    if(previous!==null && odometer<previous) throw conflict('The odometer must not decrease between fuel purchases. Check the purchase date and reading.');
    if(row.previous_odometer!==previous) await tx.run('UPDATE fuel_logs SET previous_odometer=? WHERE id=?',[previous,row.id]);
    previous=odometer;
  }
  if(previous!==null) await tx.run(`UPDATE vehicles SET current_odometer=CASE WHEN current_odometer<? THEN ? ELSE current_odometer END,updated_at=${db.now()} WHERE id=?`,[previous,previous,vehicleId]);
}

async function matchSchedule(tx,id,data,{creating=false}={}){
  const link=await tx.get('SELECT trip_id FROM event_schedules WHERE id=?',[id]);
  if(!link) throw conflict('Schedule not found.');
  const trip=await tx.get('SELECT vehicle_id,driver_id,status FROM trips WHERE id=?'+(db.isPostgres()?' FOR UPDATE':''),[link.trip_id]);
  if(!trip || Number(trip.vehicle_id)!==data.vehicle_id || (data.driver_id!=null && Number(trip.driver_id)!==data.driver_id)) throw conflict('Fuel must match the schedule vehicle and driver.');
  // Existing linked fuel may still be corrected, but no new costs on a cancelled schedule.
  if(creating && trip.status==='cancelled') throw conflict('This schedule was cancelled; fuel can no longer be recorded against it.');
  data.driver_id=trip.driver_id;
}
async function checkDriver(req,data){
  if(data.driver_id==null) return;
  const driver=await db.get('SELECT org_unit_id FROM drivers WHERE id=? AND deleted_at IS NULL',[data.driver_id]);
  if(!driver) throw notFound('Driver not found.');
  if(!await inScope(req.session.user,driver.org_unit_id)) throw forbidden('Driver is outside your scope.');
}

module.exports = function register(router) {
  router.get('/fuel-logs', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not view fuel logs.');
    const where = ['f.deleted_at IS NULL']; const params = [];
    const scope=await require('../../services/orgScope').visibleOrgUnitIds(req.session.user);
    if(scope!==null){if(!scope.length) return res.json({data:[],meta:{current_page:1,per_page:10,total:0,last_page:1}});where.push(`v.org_unit_id IN (${scope.map(()=>'?').join(',')})`);params.push(...scope);}
    if(req.query.schedule_id){where.push('EXISTS (SELECT 1 FROM schedule_expenses e WHERE e.fuel_log_id=f.id AND e.schedule_id=?)');params.push(Number(req.query.schedule_id));}
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
    req.body.station = await require('../../services/dropdowns').resolve(req.body, 'station');
    const data = validate(req.body, await require('../../services/dropdowns').rules(RULES, {fuel_type:'fuel_type'}));
    const targetVehicle=await db.get('SELECT org_unit_id FROM vehicles WHERE id=? AND deleted_at IS NULL',[data.vehicle_id]); if(!targetVehicle) throw notFound('Vehicle not found.'); if(!await inScope(req.session.user,targetVehicle.org_unit_id)) throw forbidden();
    const vehicle = await db.get('SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL', [data.vehicle_id]);
    if (!vehicle) throw notFound('Vehicle not found.');
    if(!await inScope(req.session.user,vehicle.org_unit_id)) throw forbidden('Vehicle is outside your scope.');
    await checkDriver(req,data);
    if(data.schedule_id && !await has(req,'schedule.events')) throw forbidden();
    const totalCost = Math.round(data.litres * data.price_per_litre * 100) / 100;
    const r=await db.transaction(async tx=>{
    if(data.schedule_id) await matchSchedule(tx,data.schedule_id,data,{creating:true});
    await lockVehicles(tx,[data.vehicle_id]);
    const r = await tx.run(`INSERT INTO fuel_logs (vehicle_id, driver_id, recorded_by, purchase_date, odometer, previous_odometer, litres, price_per_litre, total_cost, fuel_type, station, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [data.vehicle_id, data.driver_id || null, req.session.user.id, data.purchase_date, data.odometer, null, data.litres, data.price_per_litre, totalCost, data.fuel_type || null, data.station || null, data.notes || null]);
    if(data.schedule_id) await tx.run("INSERT INTO schedule_expenses(schedule_id,category,amount,description,expense_date,fuel_log_id,recorded_by) VALUES(?,'fuel',?,'Fuel purchase',?,?,?)",[data.schedule_id,totalCost,data.purchase_date,r.lastInsertRowid,req.session.user.id]);
    await rebuildReadings(tx,data.vehicle_id);
      return r;
    });
    await audit.from(req, { action: 'fuel.logged', description: `Fuel purchase (${data.litres} L) recorded for ${vehicle.vehicle_number}`, entityType: 'fuel_log', entityId: r.lastInsertRowid });
    res.status(201).json({ data: await fuelDto(r.lastInsertRowid) });
  });

  router.get('/fuel-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not view fuel logs.');
    const f = await db.get(`${FUEL_SELECT} WHERE f.id = ? AND f.deleted_at IS NULL`, [req.params.id]);
    if (!f) throw notFound('Fuel log not found.');
    const scopedVehicle=await db.get('SELECT org_unit_id FROM vehicles WHERE id=?',[f.vehicle_id]); if(!await inScope(req.session.user,scopedVehicle?.org_unit_id)) throw forbidden();
    res.json({ data: present.fuelLog(f) });
  });

  router.put('/fuel-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not manage fuel logs.');
    const existing = await db.get('SELECT * FROM fuel_logs WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Fuel log not found.');
    const scopedVehicle=await db.get('SELECT org_unit_id FROM vehicles WHERE id=?',[existing.vehicle_id]); if(!await inScope(req.session.user,scopedVehicle?.org_unit_id)) throw forbidden('Vehicle is outside your scope.');
    req.body.station = await require('../../services/dropdowns').resolve(req.body, 'station');
    const data = validate(req.body, await require('../../services/dropdowns').rules(RULES, {fuel_type:'fuel_type'}));
    const targetVehicle=await db.get('SELECT org_unit_id FROM vehicles WHERE id=? AND deleted_at IS NULL',[data.vehicle_id]); if(!targetVehicle) throw notFound('Vehicle not found.'); if(!await inScope(req.session.user,targetVehicle.org_unit_id)) throw forbidden();
    await checkDriver(req,data);
    const totalCost = Math.round(data.litres * data.price_per_litre * 100) / 100;
    await db.transaction(async tx=>{
    const linked=await tx.get('SELECT schedule_id FROM schedule_expenses WHERE fuel_log_id=?',[existing.id]);
    if(data.schedule_id && (!linked || Number(linked.schedule_id)!==data.schedule_id)) throw conflict('The schedule link cannot be changed here.');
    if(linked) await matchSchedule(tx,linked.schedule_id,data);
    await lockVehicles(tx,[existing.vehicle_id,data.vehicle_id]);
    const current=await tx.get('SELECT vehicle_id,deleted_at FROM fuel_logs WHERE id=?'+(db.isPostgres()?' FOR UPDATE':''),[existing.id]);
    if(!current || current.deleted_at || Number(current.vehicle_id)!==Number(existing.vehicle_id)) throw conflict('This fuel purchase changed. Reload it before saving.');
    await tx.run(`UPDATE fuel_logs SET vehicle_id = ?, driver_id = ?, purchase_date = ?, odometer = ?, litres = ?, price_per_litre = ?, total_cost = ?, fuel_type = ?, station = ?, notes = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.vehicle_id, data.driver_id || null, data.purchase_date, data.odometer, data.litres, data.price_per_litre, totalCost, data.fuel_type || null, data.station || null, data.notes || null, existing.id]);
    await tx.run('UPDATE schedule_expenses SET amount=?,expense_date=? WHERE fuel_log_id=?',[totalCost,data.purchase_date,existing.id]);
    for(const vehicleId of new Set([Number(existing.vehicle_id),data.vehicle_id]))await rebuildReadings(tx,vehicleId);
    });
    await audit.from(req, { action: 'fuel.updated', description: `Fuel log #${existing.id} was updated`, entityType: 'fuel_log', entityId: existing.id });
    res.json({ data: await fuelDto(existing.id) });
  });

  router.delete('/fuel-logs/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.FUEL_LOG))) throw forbidden('You may not manage fuel logs.');
    const existing = await db.get('SELECT * FROM fuel_logs WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Fuel log not found.');
    const scopedVehicle=await db.get('SELECT org_unit_id FROM vehicles WHERE id=?',[existing.vehicle_id]); if(!await inScope(req.session.user,scopedVehicle?.org_unit_id)) throw forbidden('Vehicle is outside your scope.');
    await db.transaction(async tx=>{
    await lockVehicles(tx,[existing.vehicle_id]);
    const current=await tx.get('SELECT vehicle_id,deleted_at FROM fuel_logs WHERE id=?'+(db.isPostgres()?' FOR UPDATE':''),[existing.id]);
    if(!current || current.deleted_at || Number(current.vehicle_id)!==Number(existing.vehicle_id)) throw conflict('This fuel purchase changed. Reload it before removing.');
    await tx.run(`UPDATE fuel_logs SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await tx.run('DELETE FROM schedule_expenses WHERE fuel_log_id=?',[existing.id]);
    await rebuildReadings(tx,existing.vehicle_id);
    });
    await audit.from(req, { action: 'fuel.deleted', description: `Fuel log #${existing.id} was removed`, entityType: 'fuel_log', entityId: existing.id });
    res.json({ message: 'Fuel log removed.' });
  });
};
