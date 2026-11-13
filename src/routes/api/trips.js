'use strict';
// Trips (ports TripController): list (scoped), live in-progress feed, show,
// start/complete/no-show/correct-odometer, driver-ready, and mid-trip stops.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const roleRepository = require('../../services/roleRepository');
const tripService = require('../../services/trips');
const loaders = require('../../services/loaders');
const present = require('../../services/present');
const enums = require('../../services/enums');
const audit = require('../../services/audit');
const notifications = require('../../services/notifications');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict, badRequest } = require('../../middleware/errorHandler');

async function caps(req) { if (!req._caps) req._caps = req.session.user.is_super_admin ? require('../../services/capabilities').all() : await roleRepository.capsForUser(req.session.user.id); return req._caps; }
const has = async (req, c) => (await caps(req)).includes(c);

async function findTrip(id) { const t = await db.get('SELECT * FROM trips WHERE id = ? AND deleted_at IS NULL', [id]); if (!t) throw notFound('Trip not found.'); return t; }
// view: requester of its request, assigned driver's user, trips.operate/view_all, or super.
async function canView(req, trip) {
  const user = req.session.user;
  if (user.is_super_admin || await has(req, CAP.TRIPS_OPERATE) || await has(req, CAP.REQUESTS_VIEW_ALL)) return true;
  const r = await db.get('SELECT requester_id FROM vehicle_requests WHERE id = ?', [trip.vehicle_request_id]);
  if (r && r.requester_id === user.id) return true;
  const d = await db.get('SELECT user_id FROM drivers WHERE id = ?', [trip.driver_id]);
  return !!(d && d.user_id === user.id);
}
// operate: trips.operate, the assigned driver, or super.
async function canOperate(req, trip) {
  const user = req.session.user;
  if (user.is_super_admin || await has(req, CAP.TRIPS_OPERATE)) return true;
  const d = await db.get('SELECT user_id FROM drivers WHERE id = ?', [trip.driver_id]);
  return !!(d && d.user_id === user.id);
}

module.exports = function register(router) {
  router.get('/trips', requireAuth, async (req, res) => {
    const user = req.session.user;
    const where = ['t.deleted_at IS NULL']; const params = [];
    if (!user.is_super_admin && !(await has(req, CAP.TRIPS_OPERATE)) && !(await has(req, CAP.REQUESTS_VIEW_ALL))) {
      where.push('(r.requester_id = ? OR dr.user_id = ?)'); params.push(user.id, user.id);
    }
    if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)); }
    if (req.query.vehicle_id) { where.push('t.vehicle_id = ?'); params.push(Number(req.query.vehicle_id)); }
    if (req.query.driver_id) { where.push('t.driver_id = ?'); params.push(Number(req.query.driver_id)); }
    if (req.query.date_from) { where.push('substr(t.scheduled_start,1,10) >= substr(?,1,10)'); params.push(req.query.date_from); }
    if (req.query.date_to) { where.push('substr(t.scheduled_start,1,10) <= substr(?,1,10)'); params.push(req.query.date_to); }
    if (req.query.search) { const s = `%${req.query.search}%`; where.push('(t.trip_number LIKE ? OR r.destination LIKE ?)'); params.push(s, s); }

    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 15));
    const page = Math.max(1, Number(req.query.page) || 1);
    const whereSql = where.join(' AND ');
    const base = `FROM trips t LEFT JOIN vehicle_requests r ON r.id = t.vehicle_request_id LEFT JOIN drivers dr ON dr.id = t.driver_id WHERE ${whereSql}`;
    const total = (await db.get(`SELECT COUNT(*) AS n ${base}`, params)).n;
    const rows = await db.all(`SELECT t.id ${base} ORDER BY t.scheduled_start DESC LIMIT ? OFFSET ?`, [...params, perPage, (page - 1) * perPage]);
    const data = [];
    for (const row of rows) data.push(await loaders.loadTrip(row.id, { withRequest: true, withStops: false }));
    res.json({ data, meta: { current_page: page, per_page: perPage, total, last_page: Math.max(1, Math.ceil(total / perPage)) } });
  });

  // Scheduling calendar: vehicles (OU-scoped) with their trips overlapping a
  // date window, for a week/gantt view that makes booking conflicts visible.
  router.get('/schedule', requireAuth, async (req, res) => {
    const orgScope = require('../../services/orgScope');
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const from = (String(req.query.from || '').slice(0, 10)) || new Date().toISOString().slice(0, 10);
    const to = (String(req.query.to || '').slice(0, 10)) || from;
    const vWhere = ['v.deleted_at IS NULL', 'v.active = 1']; const vParams = [];
    if (scope !== null) {
      if (!scope.length) return res.json({ data: { from, to, vehicles: [] } });
      vWhere.push(`v.org_unit_id IN (${scope.map(() => '?').join(',')})`); vParams.push(...scope);
    }
    const vehicles = await db.all(`SELECT v.id, v.vehicle_number, v.make, v.model, v.status FROM vehicles v WHERE ${vWhere.join(' AND ')} ORDER BY v.vehicle_number`, vParams);
    const trips = await db.all(`SELECT t.id, t.trip_number, t.vehicle_id, t.status, t.scheduled_start, t.scheduled_end, r.destination, dr.name AS driver_name
        FROM trips t LEFT JOIN vehicle_requests r ON r.id = t.vehicle_request_id LEFT JOIN drivers dr ON dr.id = t.driver_id
        WHERE t.deleted_at IS NULL AND substr(t.scheduled_start,1,10) <= substr(?,1,10) AND substr(t.scheduled_end,1,10) >= substr(?,1,10)
        ORDER BY t.scheduled_start`, [to, from]);
    const byV = new Map(vehicles.map((v) => [v.id, { ...v, trips: [] }]));
    for (const t of trips) { const g = byV.get(t.vehicle_id); if (g) g.trips.push(t); }
    res.json({ data: { from, to, vehicles: [...byV.values()] } });
  });

  // Live in-progress feed for the animated strip — every authenticated user.
  router.get('/trips/in-progress', requireAuth, async (req, res) => {
    const rows = await db.all(
      `SELECT t.id, t.trip_number, t.status, t.scheduled_start, t.scheduled_end, t.actual_start, t.actual_end,
              v.vehicle_number, v.vehicle_type, r.destination
         FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN vehicle_requests r ON r.id = t.vehicle_request_id
        WHERE t.status = 'in_progress' ORDER BY t.actual_start LIMIT 40`);
    res.json({ data: rows.map((t) => ({
      id: t.id, trip_number: t.trip_number, status: t.status,
      scheduled_start: t.scheduled_start, scheduled_end: t.scheduled_end, actual_start: t.actual_start, actual_end: t.actual_end,
      vehicle_number: t.vehicle_number, motif: enums.vehicleType.motifFor(t.vehicle_type), destination: t.destination,
    })) });
  });

  router.get('/trips/:id', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(await canView(req, trip))) throw forbidden('You may not view this trip.');
    res.json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });

  router.post('/trips/:id/start', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(await canOperate(req, trip))) throw forbidden('You may not operate this trip.');
    const data = validate(req.body, { starting_odometer: { type: 'integer', min: 0 }, notes: { type: 'string', maxLength: 500 } });
    const checklist = Array.isArray(req.body.checklist) ? req.body.checklist : null;
    await tripService.start(trip.id, req.session.user, data.starting_odometer != null ? data.starting_odometer : null, data.notes || null, checklist);
    res.json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });

  router.post('/trips/:id/complete', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(await canOperate(req, trip))) throw forbidden('You may not operate this trip.');
    const data = validate(req.body, { ending_odometer: { required: true, type: 'integer', min: 0 }, notes: { type: 'string', maxLength: 500 } });
    await tripService.complete(trip.id, req.session.user, data.ending_odometer, data.notes || null);
    res.json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });

  router.post('/trips/:id/no-show', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(await canOperate(req, trip))) throw forbidden('You may not operate this trip.');
    const data = validate(req.body, { reason: { type: 'string', maxLength: 500 } });
    await tripService.noShow(trip.id, req.session.user, data.reason || null);
    res.json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });

  router.post('/trips/:id/correct-odometer', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(req.session.user.is_super_admin || await has(req, CAP.TRIPS_CORRECT))) throw forbidden('You may not correct odometer readings.');
    const data = validate(req.body, { starting_odometer: { type: 'integer', min: 0 }, ending_odometer: { type: 'integer', min: 0 }, reason: { type: 'string', maxLength: 500 } });
    await tripService.correctOdometer(trip.id, req.session.user, data.starting_odometer != null ? data.starting_odometer : null, data.ending_odometer != null ? data.ending_odometer : null, data.reason || null);
    res.json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });

  // Driver signals ready — notifies the requester.
  router.post('/trips/:id/notify-ready', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    const driver = await db.get('SELECT user_id FROM drivers WHERE id = ?', [trip.driver_id]);
    const isDriver = driver && driver.user_id === req.session.user.id;
    if (!isDriver && !(await has(req, CAP.TRIPS_OPERATE)) && !req.session.user.is_super_admin) throw forbidden('Only the assigned driver can do this.');
    const request = await db.get('SELECT id, requester_id, request_number FROM vehicle_requests WHERE id = ?', [trip.vehicle_request_id]);
    if (!request || !request.requester_id) throw badRequest('This trip has no requester to notify.');
    const note = req.body.note ? String(req.body.note) : null;
    await notifications.toUser(request.requester_id, 'driver_ready', { trip_id: trip.id, trip_number: trip.trip_number, note });
    await audit.from(req, { action: 'trip.driver_ready', description: `Driver signalled ready to the requester for trip ${trip.trip_number}`, entityType: 'trip', entityId: trip.id });
    res.json({ message: 'The requester has been notified.' });
  });

  // Requester adds a destination mid-trip; driver accepts/declines.
  router.post('/trips/:id/stops', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(await canView(req, trip))) throw forbidden('You may not view this trip.');
    const request = await db.get('SELECT requester_id FROM vehicle_requests WHERE id = ?', [trip.vehicle_request_id]);
    const isRequester = request && request.requester_id === req.session.user.id;
    if (!isRequester && !(await has(req, CAP.TRIPS_OPERATE)) && !req.session.user.is_super_admin) throw forbidden('Only the requester may add a destination.');
    if (trip.status !== 'in_progress') throw conflict('Destinations can only be added while the trip is in progress.');
    const data = validate(req.body, { destination: { required: true, type: 'string', maxLength: 255 }, note: { type: 'string', maxLength: 500 } });
    await db.run(`INSERT INTO trip_stops (trip_id, destination, note, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ${db.now()}, ${db.now()})`, [trip.id, data.destination, data.note || null, req.session.user.id]);
    await audit.from(req, { action: 'trip.stop_requested', description: `${req.session.user.name} requested an added destination (${data.destination}) on trip ${trip.trip_number}`, entityType: 'trip', entityId: trip.id });
    const driver = await db.get('SELECT user_id FROM drivers WHERE id = ?', [trip.driver_id]);
    if (driver && driver.user_id) await notifications.toUser(driver.user_id, 'trip_stop_requested', { trip_id: trip.id, destination: data.destination, trip_number: trip.trip_number });
    res.status(201).json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });

  router.post('/trips/:id/stops/:stopId/decide', requireAuth, async (req, res) => {
    const trip = await findTrip(req.params.id);
    if (!(await canOperate(req, trip))) throw forbidden('You may not operate this trip.');
    const stop = await db.get('SELECT * FROM trip_stops WHERE id = ? AND trip_id = ?', [req.params.stopId, trip.id]);
    if (!stop) throw notFound('Stop not found.');
    if (stop.status !== 'pending') throw conflict('This destination has already been decided.');
    const accept = req.body.accept === true || req.body.accept === 1 || req.body.accept === '1' || req.body.accept === 'true';
    await db.run(`UPDATE trip_stops SET status = ?, decided_by = ?, decided_at = ${db.now()}, updated_at = ${db.now()} WHERE id = ?`, [accept ? 'accepted' : 'declined', req.session.user.id, stop.id]);
    await audit.from(req, { action: accept ? 'trip.stop_accepted' : 'trip.stop_declined', description: `${req.session.user.name} ${accept ? 'accepted' : 'declined'} added destination (${stop.destination}) on trip ${trip.trip_number}`, entityType: 'trip', entityId: trip.id });
    const request = await db.get('SELECT requester_id FROM vehicle_requests WHERE id = ?', [trip.vehicle_request_id]);
    if (request && request.requester_id) await notifications.toUser(request.requester_id, accept ? 'trip_stop_accepted' : 'trip_stop_declined', { trip_id: trip.id, destination: stop.destination, trip_number: trip.trip_number });
    if (accept) {
      const next = await db.get(`SELECT t.id, t.trip_number, t.vehicle_request_id, t.driver_id FROM trips t WHERE t.vehicle_id = ? AND t.id != ? AND t.status = 'scheduled' AND t.scheduled_start >= ? ORDER BY t.scheduled_start LIMIT 1`, [trip.vehicle_id, trip.id, trip.scheduled_start]);
      if (next) {
        const nreq = await db.get('SELECT requester_id FROM vehicle_requests WHERE id = ?', [next.vehicle_request_id]);
        const ndrv = await db.get('SELECT user_id FROM drivers WHERE id = ?', [next.driver_id]);
        const payload = { trip_id: next.id, trip_number: next.trip_number, from_trip: trip.trip_number };
        if (nreq && nreq.requester_id) await notifications.toUser(nreq.requester_id, 'trip_delay_warning', payload);
        if (ndrv && ndrv.user_id) await notifications.toUser(ndrv.user_id, 'trip_delay_warning', payload);
        await audit.from(req, { action: 'trip.delay_notified', description: `Next trip ${next.trip_number} notified of a possible delay from ${trip.trip_number}`, entityType: 'trip', entityId: next.id });
      }
    }
    res.json({ data: await loaders.loadTrip(trip.id, { withRequest: true }) });
  });
};
