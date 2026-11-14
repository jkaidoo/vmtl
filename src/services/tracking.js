'use strict';
// Live vehicle tracking. Driver devices report a GPS fix while they operate an
// in-progress trip; the fix is stored against that trip's vehicle (one latest
// row per vehicle). The map reads the signed-in user's visible org-unit subtree,
// so every department sees its own fleet concurrently. Distance to the viewer is
// computed client-side from the browser's geolocation.
const db = require('../db/runtime');
const orgScope = require('./orgScope');

const STALE_AFTER_SECONDS = 150; // a fix older than this is shown as "last seen"

// Parse a stored UTC "YYYY-MM-DD HH:MM:SS" timestamp to epoch ms.
function toEpoch(ts) {
  if (!ts) return 0;
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) { const d = Date.parse(ts); return Number.isNaN(d) ? 0 : d; }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

// The driver's active (in-progress) trip + the vehicle it uses, or null.
async function activeTripForUser(userId) {
  return db.get(
    `SELECT t.id AS trip_id, t.trip_number, t.vehicle_id
       FROM trips t
       JOIN drivers d ON d.id = t.driver_id
      WHERE d.user_id = ? AND t.status = 'in_progress' AND t.deleted_at IS NULL
      ORDER BY t.actual_start DESC NULLS LAST, t.id DESC
      LIMIT 1`,
    [userId]
  );
}

// Record a fix sent by a driver. Returns { tracked, vehicle_id?, trip_id? }.
// When the driver has no in-progress trip there is nothing to attach the fix to,
// so the position is ignored and the client is told to stand down.
async function recordDriverFix(user, fix) {
  const trip = await activeTripForUser(user.id);
  if (!trip) return { tracked: false };
  const lat = Number(fix.lat), lng = Number(fix.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { tracked: false, error: 'invalid_coordinates' };
  }
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  await db.run(
    `INSERT INTO vehicle_positions (vehicle_id, lat, lng, heading, speed, accuracy, trip_id, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${db.now()})
     ON CONFLICT (vehicle_id) DO UPDATE SET
       lat = EXCLUDED.lat, lng = EXCLUDED.lng, heading = EXCLUDED.heading,
       speed = EXCLUDED.speed, accuracy = EXCLUDED.accuracy, trip_id = EXCLUDED.trip_id,
       recorded_by = EXCLUDED.recorded_by, recorded_at = EXCLUDED.recorded_at`,
    [trip.vehicle_id, lat, lng, num(fix.heading), num(fix.speed), num(fix.accuracy), trip.trip_id, user.id]
  );
  return { tracked: true, vehicle_id: trip.vehicle_id, trip_id: trip.trip_id };
}

// Every vehicle the user may see that has a known position, newest-first by fix,
// each with its live trip, driver, destination and staleness. Org-scoped.
async function visibleVehicles(user) {
  const scope = await orgScope.visibleOrgUnitIds(user);
  const where = ['v.deleted_at IS NULL', 'p.id IS NOT NULL'];
  const params = [];
  if (scope !== null) {
    if (!scope.length) return [];
    where.push(`v.org_unit_id IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  const scopedAdmin = await require('./ouAdmin').identity(user);
  if (scopedAdmin) where.push(`(t.id IS NULL OR (${require('./ouAdmin').tripClause({ ouScope: scope })}))`);
  const rows = await db.all(
    `SELECT v.id AS vehicle_id, v.vehicle_number, v.registration_number, v.make, v.model,
            v.vehicle_type, v.status AS vehicle_status, v.org_unit_id,
            o.name AS org_unit_name,
            p.lat, p.lng, p.heading, p.speed, p.accuracy, p.recorded_at,
            t.id AS trip_id, t.trip_number, t.status AS trip_status,
            d.id AS driver_id, d.name AS driver_name, d.phone AS driver_phone,
            r.destination AS destination
       FROM vehicle_positions p
       JOIN vehicles v ON v.id = p.vehicle_id
       LEFT JOIN org_units o ON o.id = v.org_unit_id
       LEFT JOIN trips t ON t.id = p.trip_id
       LEFT JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN vehicle_requests r ON r.id = t.vehicle_request_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.recorded_at DESC`,
    params
  );
  const now = Date.now();
  return rows.map((row) => {
    const ageSeconds = Math.max(0, Math.round((now - toEpoch(row.recorded_at)) / 1000));
    return {
      vehicle_id: row.vehicle_id,
      vehicle_number: row.vehicle_number,
      registration_number: row.registration_number,
      label: [row.make, row.model].filter(Boolean).join(' ') || row.vehicle_number,
      vehicle_type: row.vehicle_type,
      vehicle_status: row.vehicle_status,
      org_unit_id: row.org_unit_id,
      org_unit_name: row.org_unit_name,
      lat: row.lat, lng: row.lng,
      heading: row.heading, speed: row.speed, accuracy: row.accuracy,
      recorded_at: row.recorded_at,
      age_seconds: ageSeconds,
      stale: ageSeconds > STALE_AFTER_SECONDS,
      trip_id: row.trip_id,
      trip_number: row.trip_number,
      trip_status: row.trip_status,
      on_trip: row.trip_status === 'in_progress',
      driver_id: row.driver_id,
      driver_name: row.driver_name,
      driver_phone: row.driver_phone,
      destination: row.destination,
    };
  });
}

module.exports = { recordDriverFix, visibleVehicles, activeTripForUser, STALE_AFTER_SECONDS };
