'use strict';
// Demo helper: drop a live GPS fix onto a handful of vehicles around KNUST so the
// Live Map shows markers without waiting for real driver devices. Promotes a
// couple of scheduled trips to "in progress" so those vehicles show a driver and
// destination. In production the positions come from the driver beacon instead.
//
//   Run with the dev server STOPPED (embedded PostgreSQL is single-writer):
//     node scripts/seed-positions.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../src/db/runtime');

const KNUST = { lat: 6.6745, lng: -1.5716 };
const jitter = (base, spread) => base + (Math.random() - 0.5) * spread;

async function main() {
  console.log('[seed-positions] runtime =', db.mode());
  await db.ensureSchema();

  // Make up to two scheduled trips active so their vehicles show as "on trip".
  const scheduled = await db.all("SELECT id, vehicle_id FROM trips WHERE status = 'scheduled' AND deleted_at IS NULL ORDER BY scheduled_start LIMIT 2");
  for (const t of scheduled) {
    await db.run(`UPDATE trips SET status = 'in_progress', actual_start = ${db.now()}, updated_at = ${db.now()} WHERE id = ?`, [t.id]);
    await db.run(`UPDATE vehicles SET status = 'on_trip', updated_at = ${db.now()} WHERE id = ?`, [t.vehicle_id]);
  }

  const active = await db.all("SELECT id, vehicle_id FROM trips WHERE status = 'in_progress' AND deleted_at IS NULL");
  const tripByVehicle = {}; active.forEach((t) => { tripByVehicle[t.vehicle_id] = t.id; });

  const vehicles = await db.all('SELECT id FROM vehicles WHERE deleted_at IS NULL ORDER BY id LIMIT 6');
  let n = 0;
  for (const v of vehicles) {
    const lat = jitter(KNUST.lat, 0.06), lng = jitter(KNUST.lng, 0.06);
    const tripId = tripByVehicle[v.id] || null;
    await db.run(
      `INSERT INTO vehicle_positions (vehicle_id, lat, lng, heading, speed, accuracy, trip_id, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${db.now()})
       ON CONFLICT (vehicle_id) DO UPDATE SET
         lat = EXCLUDED.lat, lng = EXCLUDED.lng, heading = EXCLUDED.heading, speed = EXCLUDED.speed,
         accuracy = EXCLUDED.accuracy, trip_id = EXCLUDED.trip_id, recorded_at = EXCLUDED.recorded_at`,
      [v.id, lat, lng, Math.floor(Math.random() * 360), 6 + Math.random() * 12, 14, tripId]
    );
    n++;
  }
  console.log(`[seed-positions] wrote ${n} positions (${active.length} on an active trip). Re-run any time to refresh.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('[seed-positions] failed:', err); process.exit(1); });
