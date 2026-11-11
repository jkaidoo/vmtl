'use strict';
// Public read API (/api/v1) — authenticated by Bearer API tokens created on the
// Unified API page. Read-only, scope-gated.
const db = require('../../db/runtime');
const { requireApiToken } = require('../../middleware/apiToken');

module.exports = function register(router) {
  router.get('/v1/vehicles', requireApiToken('vehicles.read'), async (req, res) => {
    res.json({ data: await db.all('SELECT id, vehicle_number, registration_number, make, model, vehicle_type, status FROM vehicles WHERE active = 1 ORDER BY vehicle_number') });
  });
  router.get('/v1/trips', requireApiToken('trips.read'), async (req, res) => {
    res.json({ data: await db.all('SELECT id, trip_number, status, scheduled_start, scheduled_end, distance FROM trips ORDER BY created_at DESC LIMIT 100') });
  });
  router.get('/v1/requests', requireApiToken('requests.read'), async (req, res) => {
    res.json({ data: await db.all('SELECT id, request_number, status, destination, travel_date FROM vehicle_requests WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100') });
  });
  router.get('/v1/analytics/summary', requireApiToken('analytics.read'), async (req, res) => {
    const n = async (sql) => Number((await db.get(sql)).n);
    res.json({ data: {
      vehicles: await n('SELECT COUNT(*) AS n FROM vehicles WHERE active = 1'),
      drivers: await n('SELECT COUNT(*) AS n FROM drivers WHERE active = 1'),
      trips: await n('SELECT COUNT(*) AS n FROM trips'),
      requests: await n('SELECT COUNT(*) AS n FROM vehicle_requests WHERE deleted_at IS NULL'),
    } });
  });
};
