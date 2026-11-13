'use strict';
// Trip lifecycle (ports TripService): start / complete / no-show / correct-odometer.
// Timestamps are recorded by the system; odometer transitions are validated and
// every reading is written to odometer_readings. All steps are transactional.
const db = require('./db_ref');
const audit = require('./audit');
const notifications = require('./notifications');
const { conflict } = require('../middleware/errorHandler');

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

async function start(tripId, actor, startingOdometer = null, notes = null, checklist = null) {
  const result = await db.transaction(async (tx) => {
    const trip = await tx.get('SELECT * FROM trips WHERE id = ?', [tripId]);
    if (!trip) throw conflict('Trip not found.');
    if (trip.status === 'completed') throw conflict('This trip is already completed.');
    if (trip.status !== 'scheduled') throw conflict('Only scheduled trips can be started.');
    const vehicle = await tx.get('SELECT * FROM vehicles WHERE id = ?', [trip.vehicle_id]);
    const starting = startingOdometer != null ? Number(startingOdometer) : vehicle.current_odometer;
    if (starting < vehicle.current_odometer) throw conflict(`Starting odometer (${starting}) cannot be lower than the vehicle's current reading (${vehicle.current_odometer}).`);
    const at = nowIso();
    const checklistJson = Array.isArray(checklist) && checklist.length ? JSON.stringify(checklist.slice(0, 20).map((c) => ({ key: String(c.key || '').slice(0, 40), label: String(c.label || '').slice(0, 80), ok: !!c.ok }))) : null;
    await tx.run(`UPDATE trips SET status = 'in_progress', actual_start = ?, starting_odometer = ?, start_notes = ?, start_checklist = ?, started_by = ?, updated_at = ${db.now()} WHERE id = ?`, [at, starting, notes, checklistJson, actor.id, trip.id]);
    await tx.run(`UPDATE vehicle_requests SET status = 'in_progress', updated_at = ${db.now()} WHERE id = ?`, [trip.vehicle_request_id]);
    await tx.run(`UPDATE vehicles SET status = 'on_trip', current_odometer = ?, updated_at = ${db.now()} WHERE id = ?`, [starting, vehicle.id]);
    await tx.run(`UPDATE drivers SET status = 'on_trip', updated_at = ${db.now()} WHERE id = ?`, [trip.driver_id]);
    await tx.run(`INSERT INTO odometer_readings (vehicle_id, trip_id, reading, source, recorded_by, created_at, updated_at) VALUES (?, ?, ?, 'trip_start', ?, ${db.now()}, ${db.now()})`, [vehicle.id, trip.id, starting, actor.id]);
    return { trip, vehicle, starting };
  });
  await audit.record({ userId: actor.id, actorName: actor.name, action: 'trip.started', description: `${actor.name} started trip ${result.trip.trip_number} (${result.vehicle.vehicle_number}) at odometer ${result.starting}`, entityType: 'trip', entityId: tripId, newValues: { starting_odometer: result.starting } });
  return tripId;
}

async function complete(tripId, actor, endingOdometer, notes = null) {
  const result = await db.transaction(async (tx) => {
    const trip = await tx.get('SELECT * FROM trips WHERE id = ?', [tripId]);
    if (!trip) throw conflict('Trip not found.');
    if (trip.status === 'completed') throw conflict('This trip is already completed.');
    if (trip.status !== 'in_progress') throw conflict('Only a trip that is in progress can be completed.');
    const ending = Number(endingOdometer);
    if (ending < trip.starting_odometer) throw conflict(`Ending odometer (${ending}) cannot be lower than the starting odometer (${trip.starting_odometer}).`);
    const distance = ending - trip.starting_odometer;
    const duration = trip.actual_start ? minutesBetween(trip.actual_start, nowIso()) : null;
    const at = nowIso();
    await tx.run(`UPDATE trips SET status = 'completed', actual_end = ?, ending_odometer = ?, distance = ?, duration_minutes = ?, end_notes = ?, ended_by = ?, updated_at = ${db.now()} WHERE id = ?`, [at, ending, distance, duration, notes, actor.id, trip.id]);
    await tx.run(`UPDATE vehicle_requests SET status = 'completed', updated_at = ${db.now()} WHERE id = ?`, [trip.vehicle_request_id]);
    await tx.run(`UPDATE vehicles SET status = 'available', current_odometer = ?, updated_at = ${db.now()} WHERE id = ?`, [ending, trip.vehicle_id]);
    await tx.run(`UPDATE drivers SET status = 'available', updated_at = ${db.now()} WHERE id = ?`, [trip.driver_id]);
    await tx.run(`INSERT INTO odometer_readings (vehicle_id, trip_id, reading, source, recorded_by, created_at, updated_at) VALUES (?, ?, ?, 'trip_end', ?, ${db.now()}, ${db.now()})`, [trip.vehicle_id, trip.id, ending, actor.id]);
    const req = await tx.get('SELECT requester_id FROM vehicle_requests WHERE id = ?', [trip.vehicle_request_id]);
    return { trip, ending, distance, requesterId: req ? req.requester_id : null };
  });
  await audit.record({ userId: actor.id, actorName: actor.name, action: 'trip.completed', description: `${actor.name} completed trip ${result.trip.trip_number}; distance ${result.distance} km`, entityType: 'trip', entityId: tripId, newValues: { ending_odometer: result.ending, distance: result.distance } });
  if (result.requesterId) await notifications.toUser(result.requesterId, 'trip_completed', { trip_id: tripId, trip_number: result.trip.trip_number, distance: result.distance });
  return tripId;
}

async function noShow(tripId, actor, reason = null) {
  const result = await db.transaction(async (tx) => {
    const trip = await tx.get('SELECT * FROM trips WHERE id = ?', [tripId]);
    if (!trip) throw conflict('Trip not found.');
    if (trip.status === 'completed') throw conflict('A completed trip cannot be marked as a no-show.');
    if (trip.status !== 'scheduled') throw conflict('Only a scheduled trip can be marked as a no-show.');
    await tx.run(`UPDATE trips SET status = 'no_show', admin_remarks = ?, ended_by = ?, updated_at = ${db.now()} WHERE id = ?`, [reason, actor.id, trip.id]);
    await tx.run(`UPDATE vehicle_requests SET status = 'no_show', updated_at = ${db.now()} WHERE id = ?`, [trip.vehicle_request_id]);
    await tx.run(`UPDATE vehicles SET status = 'available', updated_at = ${db.now()} WHERE id = ? AND status = 'scheduled'`, [trip.vehicle_id]);
    await tx.run(`UPDATE drivers SET status = 'available', updated_at = ${db.now()} WHERE id = ? AND status = 'on_trip'`, [trip.driver_id]);
    return { trip };
  });
  await audit.record({ userId: actor.id, actorName: actor.name, action: 'trip.no_show', description: `${actor.name} marked trip ${result.trip.trip_number} as a no-show${reason ? ` (${reason})` : ''}`, entityType: 'trip', entityId: tripId });
  return tripId;
}

async function correctOdometer(tripId, actor, starting, ending, reason = null) {
  const result = await db.transaction(async (tx) => {
    const trip = await tx.get('SELECT * FROM trips WHERE id = ?', [tripId]);
    if (!trip) throw conflict('Trip not found.');
    const vehicle = await tx.get('SELECT * FROM vehicles WHERE id = ?', [trip.vehicle_id]);
    const old = { starting_odometer: trip.starting_odometer, ending_odometer: trip.ending_odometer };
    const newStart = starting != null ? Number(starting) : trip.starting_odometer;
    const newEnd = ending != null ? Number(ending) : trip.ending_odometer;
    if (newStart != null && newEnd != null && newEnd < newStart) throw conflict('Ending odometer cannot be lower than starting odometer.');
    const distance = (newStart != null && newEnd != null) ? newEnd - newStart : trip.distance;
    await tx.run(`UPDATE trips SET starting_odometer = ?, ending_odometer = ?, distance = ?, updated_at = ${db.now()} WHERE id = ?`, [newStart, newEnd, distance, trip.id]);
    if (newEnd != null && trip.status === 'completed' && newEnd > vehicle.current_odometer) await tx.run(`UPDATE vehicles SET current_odometer = ? WHERE id = ?`, [newEnd, vehicle.id]);
    await tx.run(`INSERT INTO odometer_readings (vehicle_id, trip_id, reading, source, recorded_by, note, created_at, updated_at) VALUES (?, ?, ?, 'correction', ?, ?, ${db.now()}, ${db.now()})`, [vehicle.id, trip.id, (newEnd != null ? newEnd : newStart) || 0, actor.id, reason]);
    return { trip, old, newStart, newEnd };
  });
  await audit.record({ userId: actor.id, actorName: actor.name, action: 'trip.odometer_corrected', description: `${actor.name} corrected odometer on trip ${result.trip.trip_number}${reason ? ` (${reason})` : ''}`, entityType: 'trip', entityId: tripId, oldValues: result.old, newValues: { starting_odometer: result.newStart, ending_odometer: result.newEnd } });
  return tripId;
}

module.exports = { start, complete, noShow, correctOdometer };
