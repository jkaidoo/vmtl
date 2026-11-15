'use strict';
// Booking calendar: a month view of how busy the fleet is, so a requester can
// pick a quiet day before raising a request. Shows every scheduled / in-progress
// trip in the viewer's scope for the month, plus the scoped fleet size.
const db = require('../../db/runtime');
const orgScope = require('../../services/orgScope');
const { requireAuth } = require('../../middleware/auth');
const { forbidden } = require('../../middleware/errorHandler');

function monthBounds(raw) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw || ''));
  const now = new Date();
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(y, mo, 1));
  const end = new Date(Date.UTC(y, mo + 1, 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`, from: iso(start), to: iso(end) };
}

module.exports = function register(router) {
  router.get('/booking/calendar', requireAuth, async (req, res) => {
    const { month, from, to } = monthBounds(req.query.month);
    const serving = await orgScope.servingOrgUnitIds(req.session.user);
    // Fleet size the requester can draw on.
    let fleetSize = 0;
    if (serving === null) fleetSize = (await db.get('SELECT COUNT(*) AS n FROM vehicles WHERE active = 1 AND deleted_at IS NULL')).n;
    else if (serving.length) fleetSize = (await db.get(`SELECT COUNT(*) AS n FROM vehicles WHERE active = 1 AND deleted_at IS NULL AND org_unit_id IN (${serving.map(() => '?').join(',')})`, serving)).n;

    // Blocking trips overlapping the month, scoped to what the requester may see.
    const where = ["t.status IN ('scheduled','in_progress')", 't.deleted_at IS NULL', 'substr(t.scheduled_start,1,10) < ?', 'substr(t.scheduled_end,1,10) >= ?'];
    const params = [to, from];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) { return res.json({ data: { month, from, to, fleet_size: Number(fleetSize), trips: [] } }); } where.push(`r.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    const trips = await db.all(
      `SELECT t.trip_number, t.scheduled_start, t.scheduled_end, t.status, v.vehicle_number, r.destination, o.name AS org_unit_name
         FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN org_units o ON o.id = r.org_unit_id
        WHERE ${where.join(' AND ')} ORDER BY t.scheduled_start`, params);
    res.json({ data: { month, from, to, fleet_size: Number(fleetSize), trips: trips.map((t) => ({
      trip_number: t.trip_number, vehicle_number: t.vehicle_number, destination: t.destination, org_unit: t.org_unit_name,
      start: t.scheduled_start, end: t.scheduled_end, status: t.status,
    })) } });
  });
};
