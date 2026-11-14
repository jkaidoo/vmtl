'use strict';
// Vehicle/driver availability + conflict detection (ports AvailabilityService).
// A trip BLOCKS a vehicle/driver while it is scheduled or in progress. Two
// windows overlap when: existing.start < new.end AND existing.end > new.start.
const db = require('../db/runtime');

const BLOCKING = ['scheduled', 'in_progress'];

async function vehicleHasConflict(vehicleId, start, end, exceptTripId = null) {
  const row = await db.get(
    `SELECT 1 FROM trips WHERE status IN ('scheduled','in_progress') AND vehicle_id = ?
       AND scheduled_start < ? AND scheduled_end > ? ${exceptTripId ? 'AND id != ?' : ''} LIMIT 1`,
    exceptTripId ? [vehicleId, end, start, exceptTripId] : [vehicleId, end, start]
  );
  return !!row;
}

async function driverHasConflict(driverId, start, end, exceptTripId = null) {
  const row = await db.get(
    `SELECT 1 FROM trips WHERE status IN ('scheduled','in_progress') AND driver_id = ?
       AND scheduled_start < ? AND scheduled_end > ? ${exceptTripId ? 'AND id != ?' : ''} LIMIT 1`,
    exceptTripId ? [driverId, end, start, exceptTripId] : [driverId, end, start]
  );
  return !!row;
}

// Active, assignable, capacity-meeting vehicles with no conflict in [start,end).
// orgUnitIds: array to scope to those units, or null for no scoping.
async function availableVehicles(start, end, minCapacity = 1, orgUnitIds = null, exceptTripId = null) {
  let sql = `SELECT * FROM vehicles WHERE active = 1 AND status IN ('available','scheduled') AND capacity >= ? AND deleted_at IS NULL`;
  const params = [minCapacity];
  if (orgUnitIds !== null) {
    if (orgUnitIds.length === 0) return [];
    sql += ` AND org_unit_id IN (${orgUnitIds.map(() => '?').join(',')})`;
    params.push(...orgUnitIds);
  }
  sql += ' ORDER BY vehicle_number';
  const rows = await db.all(sql, params);
  const out = [];
  for (const v of rows) if (!(await vehicleHasConflict(v.id, start, end, exceptTripId))) out.push(v);
  return out;
}

async function availableDrivers(start, end, orgUnitIds = null, exceptTripId = null) {
  let sql = `SELECT * FROM drivers WHERE active = 1 AND status = 'available' AND deleted_at IS NULL`;
  const params = [];
  if (orgUnitIds !== null) {
    if (orgUnitIds.length === 0) return [];
    sql += ` AND org_unit_id IN (${orgUnitIds.map(() => '?').join(',')})`;
    params.push(...orgUnitIds);
  }
  sql += ' ORDER BY name';
  const rows = await db.all(sql, params);
  const out = [];
  for (const d of rows) if (!(await driverHasConflict(d.id, start, end, exceptTripId))) out.push(d);
  return out;
}

module.exports = { BLOCKING, vehicleHasConflict, driverHasConflict, availableVehicles, availableDrivers };
