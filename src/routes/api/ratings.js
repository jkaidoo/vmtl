'use strict';
// Requester trip feedback / ratings. After a trip is completed its requester (or
// a trip operator / administrator on their behalf) rates it 1–5 overall, with
// optional punctuality and vehicle-condition scores and a comment. Low ratings
// (≤2) or a flag notify fleet oversight. Managers see per-driver summaries.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const audit = require('../../services/audit');
const orgScope = require('../../services/orgScope');
const notifications = require('../../services/notifications');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, badRequest } = require('../../middleware/errorHandler');

const RULES = {
  rating: { required: true, type: 'integer', min: 1, max: 5 },
  punctuality: { type: 'integer', min: 1, max: 5 },
  vehicle_condition: { type: 'integer', min: 1, max: 5 },
  comment: { type: 'string', maxLength: 2000 },
};

function ratingDto(r) {
  if (!r) return null;
  return {
    id: r.id, trip_id: r.trip_id, trip_number: r.trip_number || null, request_id: r.request_id,
    rating: r.rating, punctuality: r.punctuality, vehicle_condition: r.vehicle_condition,
    comment: r.comment, flagged: !!r.flagged,
    driver_id: r.driver_id, driver_name: r.driver_name || null,
    vehicle_number: r.vehicle_number || null,
    rated_by: r.rated_by_name ? { id: r.rated_by, name: r.rated_by_name } : null,
    created_at: r.created_at,
  };
}

module.exports = function register(router) {
  async function tripContext(id) {
    const trip = await db.get('SELECT t.*, r.requester_id, r.org_unit_id FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id WHERE t.id = ? AND t.deleted_at IS NULL', [id]);
    if (!trip) throw notFound('Trip not found.');
    return trip;
  }

  router.get('/trips/:id/rating', requireAuth, async (req, res) => {
    const trip = await tripContext(req.params.id);
    const user = req.session.user;
    const isRequester = trip.requester_id === user.id;
    if (!isRequester && !user.is_super_admin && !await has(req, CAP.ANALYTICS_VIEW) && !await has(req, CAP.TRIPS_OPERATE)) throw forbidden();
    const row = await db.get(
      `SELECT tr.*, t.trip_number, d.name AS driver_name, v.vehicle_number, u.name AS rated_by_name
         FROM trip_ratings tr JOIN trips t ON t.id = tr.trip_id
         LEFT JOIN drivers d ON d.id = tr.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = tr.rated_by
        WHERE tr.trip_id = ?`, [req.params.id]);
    res.json({ data: ratingDto(row), can_rate: (isRequester || user.is_super_admin || await has(req, CAP.TRIPS_OPERATE)) && trip.status === 'completed' });
  });

  router.post('/trips/:id/rating', requireAuth, async (req, res) => {
    const trip = await tripContext(req.params.id);
    const user = req.session.user;
    const isRequester = trip.requester_id === user.id;
    if (!isRequester && !user.is_super_admin && !await has(req, CAP.TRIPS_OPERATE)) throw forbidden('Only the requester can rate this trip.');
    if (trip.status !== 'completed') throw badRequest('Only completed trips can be rated.');
    const data = validate(req.body, RULES);
    const flagged = data.rating <= 2 ? 1 : 0;
    const existing = await db.get('SELECT id FROM trip_ratings WHERE trip_id = ?', [trip.id]);
    if (existing) {
      await db.run(
        `UPDATE trip_ratings SET rating = ?, punctuality = ?, vehicle_condition = ?, comment = ?, flagged = ?, rated_by = ?, updated_at = ${db.now()} WHERE id = ?`,
        [data.rating, data.punctuality || null, data.vehicle_condition || null, data.comment || null, flagged, user.id, existing.id]);
    } else {
      await db.run(
        `INSERT INTO trip_ratings (trip_id, request_id, rated_by, driver_id, rating, punctuality, vehicle_condition, comment, flagged, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
        [trip.id, trip.vehicle_request_id, user.id, trip.driver_id, data.rating, data.punctuality || null, data.vehicle_condition || null, data.comment || null, flagged]);
    }
    await audit.from(req, { action: 'trip.rated', description: `Trip ${trip.trip_number} rated ${data.rating}/5`, entityType: 'trip', entityId: trip.id });
    if (flagged) { try { await notifications.toRoles(['administrator', 'it_admin'], 'trip_flagged', { title: 'Low trip rating', body: `Trip ${trip.trip_number} was rated ${data.rating}/5`, url: '/performance.html' }); } catch (_) {} }
    res.json({ message: 'Thank you for your feedback.' });
  });

  // Manager views: recent ratings + per-driver summary (org-scoped).
  router.get('/ratings', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.ANALYTICS_VIEW))) throw forbidden();
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['1=1']; const params = [];
    if (scope !== null) { if (!scope.length) return res.json({ data: [] }); where.push(`r.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    if (req.query.flagged === '1') where.push('tr.flagged = 1');
    const rows = await db.all(
      `SELECT tr.*, t.trip_number, d.name AS driver_name, v.vehicle_number, u.name AS rated_by_name
         FROM trip_ratings tr
         JOIN trips t ON t.id = tr.trip_id
         JOIN vehicle_requests r ON r.id = t.vehicle_request_id
         LEFT JOIN drivers d ON d.id = tr.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = tr.rated_by
        WHERE ${where.join(' AND ')} ORDER BY tr.id DESC LIMIT 100`, params);
    res.json({ data: rows.map(ratingDto) });
  });

  router.get('/ratings/summary', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.ANALYTICS_VIEW))) throw forbidden();
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['tr.driver_id IS NOT NULL']; const params = [];
    if (scope !== null) { if (!scope.length) return res.json({ data: [] }); where.push(`r.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    const rows = await db.all(
      `SELECT tr.driver_id, d.name AS driver_name, COUNT(*) AS trips,
              AVG(tr.rating) AS avg_rating, AVG(tr.punctuality) AS avg_punctuality, AVG(tr.vehicle_condition) AS avg_condition,
              SUM(CASE WHEN tr.flagged = 1 THEN 1 ELSE 0 END) AS flagged
         FROM trip_ratings tr
         JOIN trips t ON t.id = tr.trip_id
         JOIN vehicle_requests r ON r.id = t.vehicle_request_id
         LEFT JOIN drivers d ON d.id = tr.driver_id
        WHERE ${where.join(' AND ')}
        GROUP BY tr.driver_id, d.name ORDER BY avg_rating DESC, trips DESC`, params);
    const r1 = (n) => (n == null ? null : Math.round(Number(n) * 10) / 10);
    res.json({ data: rows.map((r) => ({
      driver_id: r.driver_id, driver_name: r.driver_name, trips: Number(r.trips),
      avg_rating: r1(r.avg_rating), avg_punctuality: r1(r.avg_punctuality), avg_condition: r1(r.avg_condition), flagged: Number(r.flagged),
    })) });
  });
};
