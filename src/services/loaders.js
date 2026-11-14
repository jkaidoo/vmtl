'use strict';
// Shared read helpers: fetch a request/trip with the joins the presenters expect
// and return the client DTO. Keeps route handlers thin and the JOIN shapes in one place.
const db = require('./db_ref');
const present = require('./present');

const REQUEST_SELECT = `
  SELECT r.*, o.name AS org_unit_name, o.type AS org_unit_type,
         u.name AS requester_name, u.email AS requester_email, ru.slug AS requester_role
    FROM vehicle_requests r
    LEFT JOIN org_units o ON o.id = r.org_unit_id
    LEFT JOIN users u ON u.id = r.requester_id
    LEFT JOIN roles ru ON ru.id = u.role_id`;

const VEHICLE_SELECT = `SELECT v.*, (SELECT id FROM fleet_files WHERE entity_type='vehicle' AND entity_id=v.id AND kind='photo' ORDER BY id DESC LIMIT 1) AS photo_file_id, o.name AS org_unit_name, o.type AS org_unit_type FROM vehicles v LEFT JOIN org_units o ON o.id = v.org_unit_id`;
const DRIVER_SELECT = `SELECT d.*, u.avatar AS account_avatar, (SELECT id FROM fleet_files WHERE entity_type='driver' AND entity_id=d.id AND kind='photo' ORDER BY id DESC LIMIT 1) AS photo_file_id, (SELECT id FROM fleet_files WHERE entity_type='driver' AND entity_id=d.id AND kind='licence' ORDER BY id DESC LIMIT 1) AS licence_file_id, o.name AS org_unit_name, o.type AS org_unit_type, u.email AS account_email FROM drivers d LEFT JOIN org_units o ON o.id = d.org_unit_id LEFT JOIN users u ON u.id = d.user_id`;

async function approvalsFor(requestId) {
  const rows = await db.all(`SELECT a.*, u.name AS approver_name FROM request_approvals a LEFT JOIN users u ON u.id = a.approver_id WHERE a.vehicle_request_id = ? ORDER BY a.created_at`, [requestId]);
  return rows;
}

async function stopsFor(tripId) {
  const rows = await db.all(`SELECT s.*, rb.name AS rb_name, dc.name AS dc_name FROM trip_stops s LEFT JOIN users rb ON rb.id = s.requested_by LEFT JOIN users dc ON dc.id = s.decided_by WHERE s.trip_id = ? ORDER BY s.created_at`, [tripId]);
  return rows.map((s) => ({ id: s.id, destination: s.destination, note: s.note, status: s.status, requested_by: s.rb_name, decided_by: s.dc_name, decided_at: s.decided_at, created_at: s.created_at }));
}

async function vehicleRow(id) { return id ? db.get(`${VEHICLE_SELECT} WHERE v.id = ?`, [id]) : null; }
async function driverRow(id) { return id ? db.get(`${DRIVER_SELECT} WHERE d.id = ?`, [id]) : null; }

// Trip with its vehicle, driver, optional request, and stops.
async function loadTrip(id, { withRequest = false, withStops = true } = {}) {
  const t = await db.get(`SELECT t.*, sb.name AS started_by_name, eb.name AS ended_by_name FROM trips t LEFT JOIN users sb ON sb.id = t.started_by LEFT JOIN users eb ON eb.id = t.ended_by WHERE t.id = ?`, [id]);
  if (!t) return null;
  const vehicle = await vehicleRow(t.vehicle_id);
  const driver = await driverRow(t.driver_id);
  const stops = withStops ? await stopsFor(t.id) : undefined;
  let request;
  if (withRequest) { const r = await db.get(`${REQUEST_SELECT} WHERE r.id = ?`, [t.vehicle_request_id]); request = present.request(r); }
  return present.trip(t, { vehicle, driver, request, stops });
}

// The trip attached to a request (for embedding in the request DTO).
async function tripForRequest(requestId) {
  const t = await db.get(`SELECT t.* FROM trips t WHERE t.vehicle_request_id = ? AND t.status != 'cancelled' ORDER BY t.id DESC LIMIT 1`, [requestId]);
  if (!t) return undefined;
  return present.trip(t, { vehicle: await vehicleRow(t.vehicle_id), driver: await driverRow(t.driver_id) });
}

// Request with approvals + its trip.
async function loadRequest(id, { withApprovals = true, withTrip = true } = {}) {
  const r = await db.get(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
  if (!r) return null;
  const approvals = withApprovals ? await approvalsFor(id) : undefined;
  const trip = withTrip ? await tripForRequest(id) : undefined;
  return present.request(r, { approvals, trip });
}

module.exports = { REQUEST_SELECT, VEHICLE_SELECT, DRIVER_SELECT, approvalsFor, stopsFor, vehicleRow, driverRow, loadTrip, loadRequest, tripForRequest, present };
