'use strict';
// Read-only fleet availability for requesters (ports AvailabilityController).
const db = require('../../db/runtime');
const availability = require('../../services/availability');
const orgScope = require('../../services/orgScope');
const enums = require('../../services/enums');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');

const BLOCKING = "('scheduled','in_progress')";
const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

async function bookingsFor(column, id, now) {
  const rows = await db.all(
    `SELECT t.trip_number, t.status, t.scheduled_start, t.scheduled_end, r.destination
       FROM trips t LEFT JOIN vehicle_requests r ON r.id = t.vehicle_request_id
      WHERE t.${column} = ? AND t.status IN ${BLOCKING} AND t.scheduled_end > ?
      ORDER BY t.scheduled_start LIMIT 6`, [id, now]);
  return rows;
}

module.exports = function register(router) {
  router.get('/availability/overview', requireAuth, async (req, res) => {
    const now = nowIso();
    const vehicles = [];
    for (const v of await db.all("SELECT * FROM vehicles WHERE active = 1 ORDER BY vehicle_number")) {
      const bookings = await bookingsFor('vehicle_id', v.id, now);
      const current = bookings.find((b) => b.status === 'in_progress');
      vehicles.push({
        id: v.id, label: v.vehicle_number, detail: `${v.make || ''} ${v.model || ''}`.trim(), capacity: v.capacity,
        status: v.status, status_label: enums.vehicleStatus.labels[v.status], status_color: enums.vehicleStatus.colors[v.status],
        on_trip_now: !!current, current_trip: current ? { trip_number: current.trip_number, destination: current.destination, until: current.scheduled_end } : null,
        free_now: bookings.every((b) => b.scheduled_start > now),
        bookings: bookings.map((b) => ({ trip_number: b.trip_number, destination: b.destination, start: b.scheduled_start, end: b.scheduled_end, status: b.status })),
      });
    }
    const drivers = [];
    for (const d of await db.all("SELECT * FROM drivers WHERE active = 1 ORDER BY name")) {
      const bookings = await bookingsFor('driver_id', d.id, now);
      const current = bookings.find((b) => b.status === 'in_progress');
      drivers.push({
        id: d.id, label: d.name, detail: d.phone,
        status: d.status, status_label: enums.driverStatus.labels[d.status], status_color: enums.driverStatus.colors[d.status],
        on_trip_now: !!current, current_trip: current ? { trip_number: current.trip_number, destination: current.destination, until: current.scheduled_end } : null,
        free_now: bookings.every((b) => b.scheduled_start > now),
        bookings: bookings.map((b) => ({ trip_number: b.trip_number, destination: b.destination, start: b.scheduled_start, end: b.scheduled_end, status: b.status })),
      });
    }
    res.json({ data: { generated_at: now, vehicles, drivers } });
  });

  router.get('/availability/check', requireAuth, async (req, res) => {
    const data = validate(req.query, {
      start: { required: true, type: 'date' },
      end: { required: true, type: 'date', after: 'start' },
      passengers: { type: 'integer', min: 1, max: 100, default: 1 },
    });
    const serving = await orgScope.servingOrgUnitIds(req.session.user);
    const vehicles = await availability.availableVehicles(data.start, data.end, data.passengers || 1, serving);
    const drivers = await availability.availableDrivers(data.start, data.end, serving);
    const conflicts = (await db.all(
      `SELECT t.scheduled_start, t.scheduled_end, t.status, v.vehicle_number, d.name AS driver_name, r.destination
         FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers d ON d.id = t.driver_id LEFT JOIN vehicle_requests r ON r.id = t.vehicle_request_id
        WHERE t.status IN ${BLOCKING} AND t.scheduled_start < ? AND t.scheduled_end > ? ORDER BY t.scheduled_start`, [data.end, data.start]))
      .map((t) => ({ vehicle: t.vehicle_number, driver: t.driver_name, destination: t.destination, start: t.scheduled_start, end: t.scheduled_end, status: t.status }));
    res.json({ data: { available_vehicles: vehicles.length, available_drivers: drivers.length, is_bookable: vehicles.length > 0 && drivers.length > 0, conflicts } });
  });
};
