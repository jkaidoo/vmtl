'use strict';
// Transport Schedule domain rules — ported from walkin modules/scheduler
// src/scheduling.js, with drivers as the staff pool and ts_* tables. Shared by
// the routes for assignment validation, snapshots and revision checkpoints.
const db = require('../db/runtime');
const orgScope = require('./orgScope');

function fail(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

// Org-unit scoping for events. A user with university-wide fleet access (or the
// App Owner) sees every event; otherwise they are limited to events owned by an
// org unit within their visible subtree. Returns { all, ids } for list filters.
async function eventScope(user) {
  const ids = await orgScope.visibleOrgUnitIds(user);
  return { all: ids === null, ids: ids || [] };
}
// Throw 403 if this event is outside the user's scope.
async function assertScope(user, event) {
  const scope = await eventScope(user);
  if (scope.all) return;
  if (event && event.org_unit_id != null && scope.ids.includes(event.org_unit_id)) return;
  fail('This event is outside your scope.', 403);
}

// Validate an event's date/time fields the same way the builder expects them.
function dates(event) {
  for (const value of [event.start_date, event.end_date].filter(Boolean)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) fail('Enter a valid date', 400);
  }
  if (event.end_date && (!event.start_date || event.end_date < event.start_date)) fail('End date cannot be before start date', 400);
  if (!!event.start_time !== !!event.end_time) fail('Enter both session start and end times', 400);
  if (event.start_time) {
    if (!event.start_date || ![event.start_time, event.end_time].every((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v))) fail('Enter valid session dates and times', 400);
    if (event.start_date === (event.end_date || event.start_date) && event.start_time >= event.end_time) fail('Session end must be after its start', 400);
  }
}

// Do two events overlap in time? (date-only events span the whole day.)
function overlaps(a, b) {
  if (!a.start_date || !b.start_date) return false;
  const start = (e) => e.start_date + 'T' + (e.start_time || '00:00');
  const end = (e) => (e.end_date || e.start_date) + 'T' + (e.end_time || '24:00');
  return start(a) < end(b) && start(b) < end(a);
}

// Validate that `driverId` may hold (or keep) an assignment on `eventId`.
// options: { event, requirePool, locationId (centreId), excludeId, role }
async function validate(eventId, driverId, options = {}) {
  const event = options.event || await db.get('SELECT * FROM ts_events WHERE id=?', [eventId]);
  const driver = await db.get('SELECT * FROM drivers WHERE id=?', [driverId]);
  if (!event || !driver) fail('Event or driver not found', 404);
  dates(event);
  if (!driver.active || driver.deleted_at) fail('Driver is inactive');
  if (options.requirePool && !await db.get(
    `SELECT 1 FROM ts_event_driver_groups eg JOIN ts_driver_group_members gm ON gm.group_id=eg.group_id WHERE eg.event_id=? AND gm.driver_id=?
     UNION ALL SELECT 1 FROM ts_event_pool WHERE event_id=? AND driver_id=?`, [eventId, driverId, eventId, driverId])) {
    fail('Driver is outside the event driver pool');
  }
  if (await db.get("SELECT 1 FROM ts_availability WHERE event_id=? AND driver_id=? AND status='unavailable'", [eventId, driverId])) {
    fail('Driver is unavailable for this event');
  }
  if (event.start_date && await db.get(
    "SELECT 1 FROM ts_driver_leave WHERE driver_id=? AND status='approved' AND start_date<=? AND end_date>=?",
    [driverId, event.end_date || event.start_date, event.start_date])) {
    fail('Driver is on approved leave');
  }
  const otherEvents = await db.all(
    `SELECT e.* FROM ts_events e WHERE e.id<>? AND
     (EXISTS(SELECT 1 FROM ts_assignments a WHERE a.event_id=e.id AND a.driver_id=?) OR
      EXISTS(SELECT 1 FROM ts_event_supervisors s WHERE s.event_id=e.id AND s.driver_id=?)) ORDER BY e.id`,
    [eventId, driverId, driverId]);
  const conflict = otherEvents.find((other) => overlaps(event, other));
  if (conflict) fail('Driver has an overlapping schedule: ' + conflict.title);
  if (options.locationId != null) {
    const centre = await db.get('SELECT * FROM ts_event_centres WHERE event_id=? AND centre_id=?', [eventId, options.locationId]);
    if (!centre) fail('This centre is not configured for the event');
    const count = (await db.get('SELECT COUNT(*) n FROM ts_assignments WHERE event_id=? AND centre_id=? AND id<>?', [eventId, options.locationId, options.excludeId || -1])).n;
    if (count >= centre.drivers_needed && centre.drivers_needed > 0) fail('This centre is at its driver cap');
    if (options.role === 'team_lead') {
      if (count < 1) fail('A centre needs at least two scheduled drivers before a team lead can be assigned');
      if (await db.get("SELECT 1 FROM ts_assignments WHERE event_id=? AND centre_id=? AND role='team_lead' AND id<>?", [eventId, options.locationId, options.excludeId || -1])) {
        fail('This centre already has a team lead');
      }
    }
  }
  return driver;
}

// Re-validate every assignment and supervisor on an event (used before publish).
async function validateRoster(eventId, event) {
  dates(event || await db.get('SELECT * FROM ts_events WHERE id=?', [eventId]));
  for (const row of await db.all('SELECT * FROM ts_assignments WHERE event_id=? ORDER BY id', [eventId])) {
    await validate(eventId, row.driver_id, { event, locationId: row.centre_id, excludeId: row.id, role: row.role });
  }
  for (const row of await db.all('SELECT driver_id FROM ts_event_supervisors WHERE event_id=? ORDER BY created_at, event_id, driver_id', [eventId])) {
    await validate(eventId, row.driver_id, { event });
  }
}

async function snapshot(eventId) {
  return {
    event: await db.get('SELECT * FROM ts_events WHERE id=?', [eventId]),
    centres: await db.all('SELECT * FROM ts_event_centres WHERE event_id=? ORDER BY id', [eventId]),
    assignments: await db.all('SELECT * FROM ts_assignments WHERE event_id=? ORDER BY id', [eventId]),
    supervisors: await db.all('SELECT * FROM ts_event_supervisors WHERE event_id=? ORDER BY created_at, event_id, driver_id', [eventId]),
  };
}

// Save a revision of the current roster and bump the event back to draft.
async function checkpoint(eventId, actorId, reason) {
  const data = await snapshot(eventId);
  await db.run('INSERT INTO ts_schedule_versions(event_id,revision,snapshot,actor_id,reason) VALUES(?,?,?,?,?)',
    [eventId, data.event.revision, JSON.stringify(data), actorId || null, reason]);
  await db.run("UPDATE ts_events SET revision=revision+1, workflow='draft', reviewed_revision=NULL WHERE id=?", [eventId]);
  // Keep only the most recent revisions per event so snapshot storage stays bounded.
  await db.run('DELETE FROM ts_schedule_versions WHERE event_id=? AND id NOT IN (SELECT id FROM ts_schedule_versions WHERE event_id=? ORDER BY id DESC LIMIT 50)', [eventId, eventId]);
}

module.exports = { fail, dates, overlaps, validate, validateRoster, snapshot, checkpoint, eventScope, assertScope };
