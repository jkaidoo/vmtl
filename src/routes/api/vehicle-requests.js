'use strict';
// Vehicle requests + workflow (ports VehicleRequestController). Ordinary create,
// goodwill and external-travel variants; approve / reject / request-changes;
// requester edit+resubmit; assignment options + assign. Record-level rules are
// enforced here (the frontend is never the boundary).
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const roleRepository = require('../../services/roleRepository');
const roles = require('../../services/roles');
const orgScope = require('../../services/orgScope');
const availability = require('../../services/availability');
const assignment = require('../../services/assignment');
const sequence = require('../../services/sequence');
const audit = require('../../services/audit');
const notifications = require('../../services/notifications');
const loaders = require('../../services/loaders');
const present = require('../../services/present');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { badRequest, forbidden, notFound, conflict } = require('../../middleware/errorHandler');

// Capability set for the signed-in user, cached on the request.
async function caps(req) {
  if (!req._caps) req._caps = req.session.user.is_super_admin ? require('../../services/capabilities').all() : await roleRepository.capsForUser(req.session.user.id);
  return req._caps;
}
const has = async (req, cap) => (await caps(req)).includes(cap);
async function findRequest(id) { const r = await db.get('SELECT * FROM vehicle_requests WHERE id = ? AND deleted_at IS NULL', [id]); if (!r) throw notFound('Request not found.'); return r; }
async function notifyApprovers(type, data) { await notifications.toApprovers(type, data); }

module.exports = function register(router) {
  // ---- List --------------------------------------------------------------
  router.get('/vehicle-requests', requireAuth, async (req, res) => {
    const user = req.session.user;
    const where = ['r.deleted_at IS NULL', require('../../services/ouAdmin').clause(req, 'r.org_unit_id')]; const params = [];
    if (!(await has(req, CAP.REQUESTS_VIEW_ALL))) { where.push('r.requester_id = ?'); params.push(user.id); }
    if (req.query.status) {
      const statuses = String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length) { where.push(`r.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
    }
    if (req.query.org_unit_id) { where.push('r.org_unit_id = ?'); params.push(Number(req.query.org_unit_id)); }
    if (req.query.requester_id) { where.push('r.requester_id = ?'); params.push(Number(req.query.requester_id)); }
    if (req.query.date_from) { where.push('substr(r.travel_date,1,10) >= substr(?,1,10)'); params.push(req.query.date_from); }
    if (req.query.date_to) { where.push('substr(r.travel_date,1,10) <= substr(?,1,10)'); params.push(req.query.date_to); }
    if (req.query.search) { const s = `%${req.query.search}%`; where.push('(r.request_number LIKE ? OR r.destination LIKE ? OR r.purpose LIKE ?)'); params.push(s, s, s); }

    const sortField = ['created_at', 'travel_date', 'status', 'request_number'].includes(String(req.query.sort)) ? req.query.sort : 'created_at';
    const dir = String(req.query.direction) === 'asc' ? 'ASC' : 'DESC';
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    const whereSql = where.join(' AND ');

    const totalRow = await db.get(`SELECT COUNT(*) AS n FROM vehicle_requests r WHERE ${whereSql}`, params);
    const total = totalRow.n;
    const rows = await db.all(`${loaders.REQUEST_SELECT} WHERE ${whereSql} ORDER BY r.${sortField} ${dir} LIMIT ? OFFSET ?`, [...params, perPage, (page - 1) * perPage]);
    const data = [];
    for (const r of rows) data.push(present.request(r, { trip: await loaders.tripForRequest(r.id) }));
    res.json({ data, meta: { current_page: page, per_page: perPage, total, last_page: Math.max(1, Math.ceil(total / perPage)) } });
  });

  // ---- Create (ordinary) -------------------------------------------------
  router.post('/vehicle-requests', requireAuth, async (req, res) => {
    const user = req.session.user;
    if (!(await has(req, CAP.REQUESTS_CREATE))) throw forbidden('You may not create requests.');
    const held = await caps(req);
    if (roles.isRequesterOnly(held) && !user.org_unit_id) throw conflict('A department must be assigned to your account before you can make requests. Please contact your administrator or supervisor.');

    const data = validate(req.body, {
      org_unit_id: { type: 'integer' }, department_id: { type: 'integer' },
      travel_date: { required: true, type: 'date' },
      requested_start_time: { required: true, type: 'date' },
      expected_end_time: { required: true, type: 'date', after: 'requested_start_time', messages: { after: 'Requested departure must precede the expected return time.' } },
      destination: { required: true, type: 'string', maxLength: 255 },
      additional_destination: { type: 'string', maxLength: 255 },
      purpose: { required: true, type: 'string', maxLength: 2000 },
      passenger_count: { required: true, type: 'integer', min: 1, max: 100 },
      contact_number: { type: 'string', maxLength: 50 },
      special_requirements: { type: 'string', maxLength: 500 },
      remarks: { type: 'string', maxLength: 2000 },
    });

    const maxCap = (await db.get('SELECT MAX(capacity) AS m FROM vehicles WHERE active = 1')).m || 0;
    if (maxCap > 0 && data.passenger_count > maxCap) throw badRequest('The given data was invalid.', { passenger_count: [`Passenger count exceeds the largest available vehicle capacity (${maxCap}).`] });

    const serving = await orgScope.servingOrgUnitIds(user);
    if ((await availability.availableVehicles(data.requested_start_time, data.expected_end_time, data.passenger_count, serving)).length === 0) throw conflict("This time window is fully booked — no suitable vehicle in your unit's fleet is free then. Please choose another window.");
    if ((await availability.availableDrivers(data.requested_start_time, data.expected_end_time, serving)).length === 0) throw conflict('This time window is fully booked — no driver in your unit is free then. Please choose another window.');

    const requestNumber = await sequence.next('vehicle_requests', 'request_number', 'REQ');
    const orgUnitId = data.org_unit_id || user.org_unit_id;
    const r = await db.run(
      `INSERT INTO vehicle_requests (request_number, requester_id, department_id, org_unit_id, travel_date, requested_start_time, expected_end_time, destination, additional_destination, purpose, passenger_count, contact_number, special_requirements, remarks, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ${db.now()}, ${db.now()})`,
      [requestNumber, user.id, data.department_id || null, orgUnitId || null, String(data.travel_date).slice(0, 10), data.requested_start_time, data.expected_end_time, data.destination, data.additional_destination || null, data.purpose, data.passenger_count, data.contact_number || null, data.special_requirements || null, data.remarks || null]
    );
    await audit.from(req, { action: 'request.created', description: `${user.name} submitted request ${requestNumber}`, entityType: 'vehicle_request', entityId: r.lastInsertRowid });
    await notifyApprovers('new_request', { request_id: r.lastInsertRowid, request_number: requestNumber, requester: user.name });
    res.status(201).json({ data: await loaders.loadRequest(r.lastInsertRowid) });
  });

  // ---- Create (goodwill) -------------------------------------------------
  router.post('/vehicle-requests/goodwill', requireAuth, async (req, res) => {
    const user = req.session.user;
    if (!(await has(req, CAP.REQUESTS_CREATE_GOODWILL))) throw forbidden('You may not raise goodwill requests.');
    const data = validate(req.body, {
      travel_date: { required: true, type: 'date' }, requested_start_time: { required: true, type: 'date' },
      expected_end_time: { required: true, type: 'date', after: 'requested_start_time' },
      destination: { required: true, type: 'string', maxLength: 255 },
      goodwill_reason: { required: true, type: 'string', maxLength: 2000 },
      passenger_count: { required: true, type: 'integer', min: 1, max: 100 }, contact_number: { type: 'string', maxLength: 50 },
    });
    const serving = await orgScope.servingOrgUnitIds(user);
    if ((await availability.availableVehicles(data.requested_start_time, data.expected_end_time, data.passenger_count, serving)).length === 0) throw conflict('This time window conflicts with existing bookings — no vehicle in your unit is free then.');
    const requestNumber = await sequence.next('vehicle_requests', 'request_number', 'REQ');
    const r = await db.run(
      `INSERT INTO vehicle_requests (request_number, requester_id, org_unit_id, travel_date, requested_start_time, expected_end_time, destination, purpose, passenger_count, contact_number, is_goodwill, goodwill_reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'pending', ${db.now()}, ${db.now()})`,
      [requestNumber, user.id, user.org_unit_id || null, String(data.travel_date).slice(0, 10), data.requested_start_time, data.expected_end_time, data.destination, `Goodwill: ${data.goodwill_reason}`, data.passenger_count, data.contact_number || null, data.goodwill_reason]
    );
    await audit.from(req, { action: 'request.goodwill_created', description: `${user.name} raised goodwill request ${requestNumber}`, entityType: 'vehicle_request', entityId: r.lastInsertRowid });
    await notifyApprovers('new_request', { request_id: r.lastInsertRowid, request_number: requestNumber, requester: user.name, goodwill: true });
    res.status(201).json({ data: await loaders.loadRequest(r.lastInsertRowid) });
  });

  // ---- Create (external travel) -----------------------------------------
  router.post('/vehicle-requests/external', requireAuth, async (req, res) => {
    const user = req.session.user;
    if (!(await has(req, CAP.REQUESTS_CREATE_EXTERNAL))) throw forbidden('You may not log external travel requests.');
    const data = validate(req.body, {
      org_unit_id: { type: 'integer' }, travel_date: { required: true, type: 'date' },
      requested_start_time: { required: true, type: 'date' }, expected_end_time: { required: true, type: 'date', after: 'requested_start_time' },
      destination: { required: true, type: 'string', maxLength: 255 }, purpose: { required: true, type: 'string', maxLength: 2000 },
      passenger_count: { required: true, type: 'integer', min: 1, max: 100 }, contact_number: { type: 'string', maxLength: 50 }, remarks: { type: 'string', maxLength: 2000 },
      external_org: { required: true, type: 'string', maxLength: 255 }, expected_duration_days: { type: 'integer', min: 1, max: 365 }, start_odometer: { type: 'integer', min: 0 },
    });
    const requestNumber = await sequence.next('vehicle_requests', 'request_number', 'REQ');
    const r = await db.run(
      `INSERT INTO vehicle_requests (request_number, requester_id, org_unit_id, travel_date, requested_start_time, expected_end_time, destination, purpose, passenger_count, contact_number, remarks, is_external, external_org, expected_duration_days, start_odometer, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'pending', ${db.now()}, ${db.now()})`,
      [requestNumber, user.id, data.org_unit_id || user.org_unit_id || null, String(data.travel_date).slice(0, 10), data.requested_start_time, data.expected_end_time, data.destination, data.purpose, data.passenger_count, data.contact_number || null, data.remarks || null, data.external_org, data.expected_duration_days || null, data.start_odometer != null ? data.start_odometer : null]
    );
    await audit.from(req, { action: 'request.external_created', description: `${user.name} logged external travel request ${requestNumber} for ${data.external_org}`, entityType: 'vehicle_request', entityId: r.lastInsertRowid });
    await notifyApprovers('new_request', { request_id: r.lastInsertRowid, request_number: requestNumber, requester: user.name, external: true });
    res.status(201).json({ data: await loaders.loadRequest(r.lastInsertRowid) });
  });

  // ---- Assignment options (must precede /:id) ----------------------------
  router.get('/vehicle-requests/:id/assignment-options', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REQUESTS_ASSIGN))) throw forbidden('You may not assign vehicles.');
    const request = await findRequest(req.params.id);
    const requester = await db.get('SELECT id, is_super_admin, org_unit_id FROM users WHERE id = ?', [request.requester_id]);
    const scope = req.ouScope || await orgScope.servingOrgUnitIds(requester);
    const vehicles = await availability.availableVehicles(request.requested_start_time, request.expected_end_time, request.passenger_count, scope);
    const drivers = await availability.availableDrivers(request.requested_start_time, request.expected_end_time, scope);
    res.json({ vehicles: vehicles.map(present.vehicle), drivers: drivers.map(present.driver) });
  });

  router.post('/vehicle-requests/:id/assign', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REQUESTS_ASSIGN))) throw forbidden('You may not assign vehicles.');
    const request = await findRequest(req.params.id);
    const data = validate(req.body, { vehicle_id: { required: true, type: 'integer' }, driver_id: { required: true, type: 'integer' }, scheduled_start: { type: 'date' }, scheduled_end: { type: 'date' } });
    const tripId = await assignment.assign(request.id, data.vehicle_id, data.driver_id, req.session.user, data.scheduled_start || null, data.scheduled_end || null);
    res.status(201).json({ data: await loaders.loadTrip(tripId, { withRequest: true }) });
  });

  // ---- Approve / reject / request-changes / cancel -----------------------
  router.post('/vehicle-requests/:id/approve', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REQUESTS_APPROVE))) throw forbidden('You may not approve requests.');
    const request = await findRequest(req.params.id);
    const comment = req.body.comment != null ? String(req.body.comment) : null;
    await db.run(`UPDATE vehicle_requests SET status = 'approved', updated_at = ${db.now()} WHERE id = ?`, [request.id]);
    await db.run(`INSERT INTO request_approvals (vehicle_request_id, approver_id, action, comment, approved_at, created_at, updated_at) VALUES (?, ?, 'approved', ?, ${db.now()}, ${db.now()}, ${db.now()})`, [request.id, req.session.user.id, comment]);
    await audit.from(req, { action: 'request.approved', description: `${req.session.user.name} approved request ${request.request_number}`, entityType: 'vehicle_request', entityId: request.id });
    await notifications.toUser(request.requester_id, 'request_approved', { request_id: request.id, request_number: request.request_number, comment });
    res.json({ data: await loaders.loadRequest(request.id) });
  });

  router.post('/vehicle-requests/:id/reject', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REQUESTS_APPROVE))) throw forbidden('You may not reject requests.');
    const request = await findRequest(req.params.id);
    const { reason } = validate(req.body, { reason: { required: true, type: 'string', maxLength: 2000 } });
    await db.run(`UPDATE vehicle_requests SET status = 'rejected', updated_at = ${db.now()} WHERE id = ?`, [request.id]);
    await db.run(`INSERT INTO request_approvals (vehicle_request_id, approver_id, action, comment, approved_at, created_at, updated_at) VALUES (?, ?, 'rejected', ?, ${db.now()}, ${db.now()}, ${db.now()})`, [request.id, req.session.user.id, reason]);
    await audit.from(req, { action: 'request.rejected', description: `${req.session.user.name} rejected request ${request.request_number}`, entityType: 'vehicle_request', entityId: request.id, newValues: { reason } });
    await notifications.toUser(request.requester_id, 'request_rejected', { request_id: request.id, request_number: request.request_number, reason });
    res.json({ data: await loaders.loadRequest(request.id) });
  });

  router.post('/vehicle-requests/:id/request-changes', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.REQUESTS_APPROVE)) && !(await has(req, CAP.REQUESTS_ASSIGN))) throw forbidden('You may not request changes.');
    const request = await findRequest(req.params.id);
    const { reason } = validate(req.body, { reason: { required: true, type: 'string', maxLength: 2000 } });
    await db.run(`UPDATE vehicle_requests SET status = 'changes_requested', updated_at = ${db.now()} WHERE id = ?`, [request.id]);
    await db.run(`INSERT INTO request_approvals (vehicle_request_id, approver_id, action, comment, approved_at, created_at, updated_at) VALUES (?, ?, 'changes_requested', ?, ${db.now()}, ${db.now()}, ${db.now()})`, [request.id, req.session.user.id, reason]);
    await audit.from(req, { action: 'request.changes_requested', description: `${req.session.user.name} requested changes on ${request.request_number}`, entityType: 'vehicle_request', entityId: request.id, newValues: { reason } });
    await notifications.toUser(request.requester_id, 'request_changes_requested', { request_id: request.id, request_number: request.request_number, reason });
    res.json({ data: await loaders.loadRequest(request.id) });
  });

  router.post('/vehicle-requests/:id/cancel', requireAuth, async (req, res) => {
    const request = await findRequest(req.params.id);
    const user = req.session.user;
    const own = request.requester_id === user.id;
    const manages = (await has(req, CAP.REQUESTS_APPROVE)) || (await has(req, CAP.REQUESTS_ASSIGN));
    if (!own && !manages && !user.is_super_admin) throw forbidden('You may not cancel this request.');
    const enums = require('../../services/enums');
    if (!enums.requestStatus.isCancellable(request.status)) throw conflict('This request can no longer be cancelled.');
    await db.run(`UPDATE vehicle_requests SET status = 'cancelled', updated_at = ${db.now()} WHERE id = ?`, [request.id]);
    await audit.from(req, { action: 'request.cancelled', description: `Request ${request.request_number} was cancelled`, entityType: 'vehicle_request', entityId: request.id });
    res.json({ data: await loaders.loadRequest(request.id) });
  });

  // ---- Show --------------------------------------------------------------
  router.get('/vehicle-requests/:id', requireAuth, async (req, res) => {
    const request = await findRequest(req.params.id);
    const user = req.session.user;
    if (request.requester_id !== user.id && !user.is_super_admin && !(await has(req, CAP.REQUESTS_VIEW_ALL))) throw forbidden('You may not view this request.');
    res.json({ data: await loaders.loadRequest(request.id) });
  });

  // ---- Update / resubmit -------------------------------------------------
  router.put('/vehicle-requests/:id', requireAuth, async (req, res) => {
    const request = await findRequest(req.params.id);
    const user = req.session.user;
    const enums = require('../../services/enums');
    const own = request.requester_id === user.id;
    const scopedAdmin = !!req.ouScope && await has(req, CAP.REQUESTS_APPROVE);
    if (!own && !user.is_super_admin && !scopedAdmin) throw forbidden('You may not edit this request.');
    if (!enums.requestStatus.isEditableByRequester(request.status) && !user.is_super_admin) throw conflict('This request can no longer be edited.');

    const data = validate(req.body, {
      requested_start_time: { type: 'date' }, expected_end_time: { type: 'date' },
      destination: { type: 'string', maxLength: 255 }, additional_destination: { type: 'string', maxLength: 255 },
      purpose: { type: 'string', maxLength: 2000 }, passenger_count: { type: 'integer', min: 1, max: 100 },
      contact_number: { type: 'string', maxLength: 50 }, special_requirements: { type: 'string', maxLength: 500 }, remarks: { type: 'string', maxLength: 2000 },
    });

    const resubmitting = request.status === 'changes_requested';
    const windowChanged = req.body.requested_start_time != null || req.body.expected_end_time != null || req.body.passenger_count != null;
    if (resubmitting || windowChanged) {
      const start = data.requested_start_time || request.requested_start_time;
      const end = data.expected_end_time || request.expected_end_time;
      const passengers = data.passenger_count || request.passenger_count;
      if ((await availability.availableVehicles(start, end, passengers, req.ouScope || null)).length === 0) throw conflict('This time window is fully booked — no suitable vehicle is free then. Please choose another window.');
      if ((await availability.availableDrivers(start, end, req.ouScope || null)).length === 0) throw conflict('This time window is fully booked — no driver is free then. Please choose another window.');
    }

    const fields = []; const params = [];
    for (const [k, v] of Object.entries(data)) { if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(v); } }
    if (resubmitting) { fields.push("status = 'pending'"); }
    if (fields.length) { await db.run(`UPDATE vehicle_requests SET ${fields.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, request.id]); }
    await audit.from(req, { action: 'request.updated', description: `Request ${request.request_number} was updated`, entityType: 'vehicle_request', entityId: request.id });
    if (resubmitting) {
      await audit.from(req, { action: 'request.resubmitted', description: `${user.name} resubmitted ${request.request_number} after changes`, entityType: 'vehicle_request', entityId: request.id });
      await notifyApprovers('new_request', { request_id: request.id, request_number: request.request_number, requester: user.name, resubmitted: true });
    }
    res.json({ data: await loaders.loadRequest(request.id) });
  });
};
