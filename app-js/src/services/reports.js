'use strict';
// Report datasets (ports ReportController): vehicle-usage (trips) and fuel.
const db = require('./db_ref');
const enums = require('./enums');
const analytics = require('./analytics');

const fmtDateTime = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '');
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

async function tripRows(filters) {
  const { sql, params } = analytics.tripWhere(filters);
  const rows = await db.all(
    `SELECT t.trip_number, t.scheduled_start, t.actual_start, t.actual_end, t.scheduled_end, t.distance, t.status,
            v.vehicle_number, d.name AS driver_name, u.name AS requester_name, r.destination, r.purpose, r.is_goodwill, o.name AS org_unit_name
       FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id
       LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN users u ON u.id = r.requester_id LEFT JOIN org_units o ON o.id = r.org_unit_id
      WHERE ${sql} ORDER BY t.scheduled_start`, params);
  return rows.map((t) => ({
    trip_number: t.trip_number, date: String(t.scheduled_start).slice(0, 10),
    vehicle: t.vehicle_number, driver: t.driver_name, requester: t.requester_name,
    department: t.is_goodwill ? 'Goodwill' : t.org_unit_name, destination: t.destination, purpose: t.purpose,
    start: fmtDateTime(t.actual_start || t.scheduled_start), end: fmtDateTime(t.actual_end || t.scheduled_end),
    distance: t.distance, status: enums.tripStatus.labels[t.status] || t.status,
  }));
}

async function tripTotals(filters) {
  const { sql, params } = analytics.tripWhere(filters);
  const total = (await db.get(`SELECT COUNT(*) AS n FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id WHERE ${sql}`, params)).n;
  const completed = (await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(t.distance),0) AS d FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id WHERE ${sql} AND t.status = 'completed'`, params));
  return { trips: total, completed: completed.n, distance: completed.d };
}

async function fuelRows(filters) {
  const { sql, params } = analytics.fuelWhere(filters);
  const rows = await db.all(`SELECT f.*, v.vehicle_number, d.name AS driver_name, u.name AS recorded_by_name FROM fuel_logs f LEFT JOIN vehicles v ON v.id = f.vehicle_id LEFT JOIN drivers d ON d.id = f.driver_id LEFT JOIN users u ON u.id = f.recorded_by WHERE ${sql} ORDER BY f.purchase_date, f.odometer`, params);
  return rows.map((f) => {
    const dist = f.previous_odometer == null ? null : Math.max(0, f.odometer - f.previous_odometer);
    const kmPerL = (dist == null || Number(f.litres) <= 0) ? null : r3(dist / Number(f.litres));
    return { date: fmtDateTime(f.purchase_date), vehicle: f.vehicle_number, driver: f.driver_name || '—', odometer: f.odometer, distance_since_last: dist == null ? '—' : dist, litres: f.litres, price_per_litre: f.price_per_litre, total_cost: f.total_cost, km_per_litre: kmPerL == null ? '—' : kmPerL, fuel_type: f.fuel_type || '—', station: f.station || '—', recorded_by: f.recorded_by_name || '—' };
  });
}

async function fuelTotals(filters) {
  const f = await analytics.fuel(filters);
  return { fills: f.summary.fills, litres: f.summary.total_litres, cost: f.summary.total_cost, distance: f.summary.measured_distance, km_per_litre: f.summary.km_per_litre };
}

const TRIP_HEADINGS = ['Trip #', 'Date', 'Vehicle', 'Driver', 'Requester', 'Department', 'Destination', 'Purpose', 'Start', 'End', 'Distance (km)', 'Status'];
const FUEL_HEADINGS = ['Date', 'Vehicle', 'Driver', 'Odometer (km)', 'Since Last (km)', 'Litres', 'Price/L (GHS)', 'Total (GHS)', 'km/L', 'Fuel Type', 'Station', 'Recorded By'];

module.exports = { tripRows, tripTotals, fuelRows, fuelTotals, TRIP_HEADINGS, FUEL_HEADINGS, r2 };
