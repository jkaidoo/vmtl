'use strict';
// Fleet analytics (ports AnalyticsService). Aggregation is done in JS over the
// filtered rows so the same code runs on SQLite and PostgreSQL (no engine-specific
// DATE_FORMAT/DAYNAME/HOUR). Filters: date_from/to, vehicle_id, driver_id,
// org_unit_id, org_unit_ids (subtree scope), requester_id, destination, status.
const db = require('./db_ref');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const period = (d) => String(d).slice(0, 7);

function tripWhere(filters, { withStatus = true } = {}) {
  const where = ['t.deleted_at IS NULL']; const params = [];
  if (filters.date_from) { where.push('substr(t.scheduled_start,1,10) >= substr(?,1,10)'); params.push(filters.date_from); }
  if (filters.date_to) { where.push('substr(t.scheduled_start,1,10) <= substr(?,1,10)'); params.push(filters.date_to); }
  if (filters.vehicle_id) { where.push('t.vehicle_id = ?'); params.push(Number(filters.vehicle_id)); }
  if (filters.driver_id) { where.push('t.driver_id = ?'); params.push(Number(filters.driver_id)); }
  if (withStatus && filters.status) { where.push('t.status = ?'); params.push(String(filters.status)); }
  if (filters.org_unit_id) { where.push('r.org_unit_id = ?'); params.push(Number(filters.org_unit_id)); }
  if (filters.org_unit_ids) { const ids = filters.org_unit_ids.length ? filters.org_unit_ids : [0]; where.push(`r.org_unit_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  if (filters.requester_id) { where.push('r.requester_id = ?'); params.push(Number(filters.requester_id)); }
  if (filters.destination) { where.push('r.destination LIKE ?'); params.push(`%${filters.destination}%`); }
  return { sql: where.join(' AND '), params };
}

async function fetchTrips(filters) {
  const { sql, params } = tripWhere(filters);
  return db.all(
    `SELECT t.id, t.vehicle_id, t.driver_id, t.status, t.distance, t.duration_minutes, t.scheduled_start,
            v.vehicle_number, d.name AS driver_name, r.destination, r.is_goodwill, r.org_unit_id, o.name AS org_unit_name
       FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN org_units o ON o.id = r.org_unit_id
      WHERE ${sql}`, params);
}

function groupSum(rows, keyFn, labelFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, { id: key, label: labelFn(row), trips: 0, distance: 0 });
    const g = map.get(key); g.trips += 1; g.distance += Number(row.distance || 0);
  }
  return [...map.values()];
}

async function build(filters) {
  const trips = await fetchTrips(filters);
  const completed = trips.filter((t) => t.status === 'completed');
  const distances = completed.map((t) => Number(t.distance || 0));
  const totalDistance = distances.reduce((a, b) => a + b, 0);

  const byVehicle = groupSum(completed, (t) => t.vehicle_id, (t) => t.vehicle_number || `#${t.vehicle_id}`);
  const byDriver = groupSum(completed, (t) => t.driver_id, (t) => t.driver_name || `#${t.driver_id}`);
  const byDeptMap = new Map();
  for (const t of completed) { const label = t.is_goodwill ? 'Goodwill' : (t.org_unit_name || 'Unassigned'); byDeptMap.set(label, (byDeptMap.get(label) || 0) + 1); }
  const byDept = [...byDeptMap.entries()].map(([label, trips]) => ({ label, trips })).sort((a, b) => b.trips - a.trips);
  const byDestMap = new Map();
  for (const t of completed) { const label = t.destination || '—'; byDestMap.set(label, (byDestMap.get(label) || 0) + 1); }
  const byDest = [...byDestMap.entries()].map(([label, trips]) => ({ label, trips })).sort((a, b) => b.trips - a.trips).slice(0, 15);
  const monthMap = new Map();
  for (const t of completed) { const p = period(t.scheduled_start); if (!monthMap.has(p)) monthMap.set(p, { period: p, trips: 0, distance: 0 }); const g = monthMap.get(p); g.trips += 1; g.distance += Number(t.distance || 0); }
  const monthly = [...monthMap.values()].sort((a, b) => a.period.localeCompare(b.period));

  const durations = completed.filter((t) => t.duration_minutes != null).map((t) => Number(t.duration_minutes));
  const dayMap = new Map(); const hourMap = new Map();
  for (const t of completed) {
    const dt = new Date(String(t.scheduled_start).replace(' ', 'T'));
    const day = DAY_NAMES[dt.getDay()]; dayMap.set(day, (dayMap.get(day) || 0) + 1);
    const hr = dt.getHours(); hourMap.set(hr, (hourMap.get(hr) || 0) + 1);
  }

  // Approval statistics over requests (own filter set).
  const rw = []; const rp = [];
  if (filters.date_from) { rw.push('substr(created_at,1,10) >= substr(?,1,10)'); rp.push(filters.date_from); }
  if (filters.date_to) { rw.push('substr(created_at,1,10) <= substr(?,1,10)'); rp.push(filters.date_to); }
  if (filters.org_unit_id) { rw.push('org_unit_id = ?'); rp.push(Number(filters.org_unit_id)); }
  if (filters.org_unit_ids) { const ids = filters.org_unit_ids.length ? filters.org_unit_ids : [0]; rw.push(`org_unit_id IN (${ids.map(() => '?').join(',')})`); rp.push(...ids); }
  if (filters.requester_id) { rw.push('requester_id = ?'); rp.push(Number(filters.requester_id)); }
  const rWhere = rw.length ? `WHERE ${rw.join(' AND ')} AND deleted_at IS NULL` : 'WHERE deleted_at IS NULL';
  const reqs = await db.all(`SELECT status FROM vehicle_requests ${rWhere}`, rp);
  const countStatus = (set) => reqs.filter((r) => set.includes(r.status)).length;
  const approvalStatistics = {
    submitted: reqs.length,
    approved: countStatus(['approved', 'scheduled', 'in_progress', 'completed']),
    rejected: countStatus(['rejected']), cancelled: countStatus(['cancelled']), pending: countStatus(['pending']),
  };

  return {
    summary: { total_trips: trips.length, completed_trips: completed.length, total_distance: totalDistance, avg_distance: distances.length ? r1(totalDistance / distances.length) : 0 },
    trips_by_vehicle: byVehicle, trips_by_driver: byDriver, trips_by_department: byDept, trips_by_destination: byDest,
    monthly_utilisation: monthly,
    distance: { by_vehicle: byVehicle, by_driver: byDriver, by_month: monthly },
    trip_duration: { average_minutes: durations.length ? r1(durations.reduce((a, b) => a + b, 0) / durations.length) : 0, max_minutes: durations.length ? Math.max(...durations) : 0, min_minutes: durations.length ? Math.min(...durations) : 0 },
    approval_statistics: approvalStatistics,
    peak_usage: {
      most_active_days: [...dayMap.entries()].map(([label, trips]) => ({ label, trips })).sort((a, b) => b.trips - a.trips),
      most_active_hours: [...hourMap.entries()].map(([h, trips]) => ({ label: `${String(h).padStart(2, '0')}:00`, trips })).sort((a, b) => a.label.localeCompare(b.label)),
      most_active_vehicles: byVehicle.slice(0, 5),
    },
    fuel: await fuel(filters),
    maintenance: await maintenanceCost(filters),
  };
}

function fuelWhere(filters) {
  const where = ['f.deleted_at IS NULL']; const params = [];
  if (filters.date_from) { where.push('substr(f.purchase_date,1,10) >= substr(?,1,10)'); params.push(filters.date_from); }
  if (filters.date_to) { where.push('substr(f.purchase_date,1,10) <= substr(?,1,10)'); params.push(filters.date_to); }
  if (filters.vehicle_id) { where.push('f.vehicle_id = ?'); params.push(Number(filters.vehicle_id)); }
  if (filters.driver_id) { where.push('f.driver_id = ?'); params.push(Number(filters.driver_id)); }
  if (filters.org_unit_ids) { const ids = filters.org_unit_ids.length ? filters.org_unit_ids : [0]; where.push(`v.org_unit_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  return { sql: where.join(' AND '), params };
}

async function fuel(filters) {
  const { sql, params } = fuelWhere(filters);
  const rows = await db.all(`SELECT f.*, v.vehicle_number, v.org_unit_id FROM fuel_logs f LEFT JOIN vehicles v ON v.id = f.vehicle_id WHERE ${sql}`, params);
  const totalCost = rows.reduce((a, r) => a + Number(r.total_cost || 0), 0);
  const totalLitres = rows.reduce((a, r) => a + Number(r.litres || 0), 0);
  const measured = rows.filter((r) => r.previous_odometer != null);
  const measuredDistance = measured.reduce((a, r) => a + (r.odometer - r.previous_odometer), 0);
  const measuredLitres = measured.reduce((a, r) => a + Number(r.litres || 0), 0);
  const measuredCost = measured.reduce((a, r) => a + Number(r.total_cost || 0), 0);

  const byVehMap = new Map();
  for (const r of rows) {
    const k = r.vehicle_id;
    if (!byVehMap.has(k)) byVehMap.set(k, { id: k, label: r.vehicle_number || `#${k}`, litres: 0, cost: 0, distance: 0, measuredLitres: 0 });
    const g = byVehMap.get(k); g.litres += Number(r.litres || 0); g.cost += Number(r.total_cost || 0);
    if (r.previous_odometer != null) { g.distance += (r.odometer - r.previous_odometer); g.measuredLitres += Number(r.litres || 0); }
  }
  const byVehicle = [...byVehMap.values()].map((g) => ({ id: g.id, label: g.label, litres: r2(g.litres), cost: r2(g.cost), distance: g.distance, km_per_litre: g.measuredLitres > 0 ? r3(g.distance / g.measuredLitres) : null }));
  const byMonthMap = new Map();
  for (const r of rows) { const p = period(r.purchase_date); if (!byMonthMap.has(p)) byMonthMap.set(p, { period: p, cost: 0, litres: 0 }); const g = byMonthMap.get(p); g.cost += Number(r.total_cost || 0); g.litres += Number(r.litres || 0); }
  const byMonth = [...byMonthMap.values()].map((g) => ({ period: g.period, cost: r2(g.cost), litres: r2(g.litres) })).sort((a, b) => a.period.localeCompare(b.period));

  return {
    summary: { total_cost: r2(totalCost), total_litres: r2(totalLitres), fills: rows.length, avg_price_per_litre: totalLitres > 0 ? r3(totalCost / totalLitres) : null, km_per_litre: measuredLitres > 0 ? r3(measuredDistance / measuredLitres) : null, cost_per_km: measuredDistance > 0 ? r3(measuredCost / measuredDistance) : null, measured_distance: measuredDistance },
    by_vehicle: byVehicle, by_month: byMonth,
  };
}

// Maintenance spend (from maintenance_records), mirroring the fuel aggregation.
function maintWhere(filters) {
  const where = ['m.deleted_at IS NULL']; const params = [];
  if (filters.date_from) { where.push('substr(m.service_date,1,10) >= substr(?,1,10)'); params.push(filters.date_from); }
  if (filters.date_to) { where.push('substr(m.service_date,1,10) <= substr(?,1,10)'); params.push(filters.date_to); }
  if (filters.vehicle_id) { where.push('m.vehicle_id = ?'); params.push(Number(filters.vehicle_id)); }
  if (filters.org_unit_id) { where.push('v.org_unit_id = ?'); params.push(Number(filters.org_unit_id)); }
  if (filters.org_unit_ids) { const ids = filters.org_unit_ids.length ? filters.org_unit_ids : [0]; where.push(`v.org_unit_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  return { sql: where.join(' AND '), params };
}
async function maintenanceCost(filters) {
  const { sql, params } = maintWhere(filters);
  const rows = await db.all(`SELECT m.*, v.vehicle_number FROM maintenance_records m LEFT JOIN vehicles v ON v.id = m.vehicle_id WHERE ${sql}`, params);
  const totalCost = rows.reduce((a, r) => a + Number(r.cost || 0), 0);
  const byVehMap = new Map();
  for (const r of rows) { const k = r.vehicle_id; if (!byVehMap.has(k)) byVehMap.set(k, { id: k, label: r.vehicle_number || `#${k}`, cost: 0, count: 0 }); const g = byVehMap.get(k); g.cost += Number(r.cost || 0); g.count += 1; }
  const byVehicle = [...byVehMap.values()].map((g) => ({ id: g.id, label: g.label, cost: r2(g.cost), count: g.count })).sort((a, b) => b.cost - a.cost);
  const byMonthMap = new Map();
  for (const r of rows) { const p = period(r.service_date); if (!byMonthMap.has(p)) byMonthMap.set(p, { period: p, cost: 0, count: 0 }); const g = byMonthMap.get(p); g.cost += Number(r.cost || 0); g.count += 1; }
  const byMonth = [...byMonthMap.values()].map((g) => ({ period: g.period, cost: r2(g.cost), count: g.count })).sort((a, b) => a.period.localeCompare(b.period));
  return { summary: { total_cost: r2(totalCost), records: rows.length }, by_vehicle: byVehicle, by_month: byMonth };
}

module.exports = { build, fuel, maintenanceCost, fetchTrips, tripWhere, fuelWhere };
