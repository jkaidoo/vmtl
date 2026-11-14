'use strict';
// Assign a vehicle + driver to an approved request and create the trip, inside a
// transaction so two officers cannot assign the same vehicle/driver to
// overlapping trips. Ports AssignmentService.
const db = require('./db_ref');
const availability = require('./availability');
const sequence = require('./sequence');
const audit = require('./audit');
const notifications = require('./notifications');
const enums = require('./enums');
const { conflict } = require('../middleware/errorHandler');

async function assign(requestId, vehicleId, driverId, actor, scheduledStart = null, scheduledEnd = null) {
  const tripId = await db.transaction(async (tx) => {
    const request = await tx.get('SELECT * FROM vehicle_requests WHERE id = ?'+(db.isPostgres()?' FOR UPDATE':''), [requestId]);
    if (!request) throw conflict('Request not found.');
    if (request.status !== 'approved') throw conflict('Only approved requests can be assigned a vehicle and driver.');

    const existingTrip = await tx.get("SELECT id FROM trips WHERE vehicle_request_id = ? AND status != 'cancelled'", [requestId]);
    if (existingTrip) throw conflict('This request already has a trip assigned.');

    const start = scheduledStart || request.requested_start_time;
    const end = scheduledEnd || request.expected_end_time;

    const lock=db.isPostgres()?' FOR UPDATE':'';
    const vehicle = await tx.get('SELECT * FROM vehicles WHERE id = ?'+lock, [vehicleId]);
    const driver = await tx.get('SELECT * FROM drivers WHERE id = ?'+lock, [driverId]);
    if (!vehicle) throw conflict('Vehicle not found.');
    if (!driver) throw conflict('Driver not found.');
    if (!vehicle.active || !enums.vehicleStatus.isAssignable(vehicle.status)) throw conflict(`Vehicle ${vehicle.vehicle_number} is not available for assignment.`);
    if (!driver.active || !enums.driverStatus.isAssignable(driver.status)) throw conflict(`Driver ${driver.name} is not available for assignment.`);
    if (vehicle.capacity < request.passenger_count) throw conflict(`Vehicle capacity (${vehicle.capacity}) is less than the requested passengers (${request.passenger_count}).`);
    if (await tx.get("SELECT id FROM trips WHERE vehicle_id=? AND status IN ('scheduled','in_progress') AND scheduled_start<? AND scheduled_end>? LIMIT 1",[vehicle.id,end,start])) throw conflict(`Vehicle ${vehicle.vehicle_number} is already booked for an overlapping period.`);
    if (await tx.get("SELECT id FROM trips WHERE driver_id=? AND status IN ('scheduled','in_progress') AND scheduled_start<? AND scheduled_end>? LIMIT 1",[driver.id,end,start])) throw conflict(`Driver ${driver.name} is already booked for an overlapping period.`);

    const tripNumber = await sequence.next('trips', 'trip_number', 'TRIP');
    const res = await tx.run(
      `INSERT INTO trips (trip_number, vehicle_request_id, vehicle_id, driver_id, scheduled_start, scheduled_end, status, assigned_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ${db.now()}, ${db.now()})`,
      [tripNumber, request.id, vehicle.id, driver.id, start, end, actor.id]
    );
    const newTripId = res.lastInsertRowid;
    await tx.run(`UPDATE vehicle_requests SET status = 'scheduled', updated_at = ${db.now()} WHERE id = ?`, [request.id]);
    await tx.run(`UPDATE vehicles SET status = 'scheduled', updated_at = ${db.now()} WHERE id = ?`, [vehicle.id]);
    // Driver stays AVAILABLE until the trip starts, so they can take non-overlapping trips.
    return { id: newTripId, request, vehicle, driver, tripNumber };
  });

  await audit.record({ userId: actor.id, actorName: actor.name, action: 'request.assigned', description: `${actor.name} assigned ${tripId.vehicle.vehicle_number} + driver ${tripId.driver.name} to request ${tripId.request.request_number} (trip ${tripId.tripNumber})`, entityType: 'trip', entityId: tripId.id, newValues: { vehicle_id: tripId.vehicle.id, driver_id: tripId.driver.id } });
  await notifications.toUser(tripId.request.requester_id, 'vehicle_assigned', { trip_id: tripId.id, trip_number: tripId.tripNumber, request_number: tripId.request.request_number, vehicle: tripId.vehicle.vehicle_number });
  if (tripId.driver.user_id) await notifications.toUser(tripId.driver.user_id, 'vehicle_assigned', { trip_id: tripId.id, trip_number: tripId.tripNumber, vehicle: tripId.vehicle.vehicle_number });
  return tripId.id;
}

module.exports = { assign };
