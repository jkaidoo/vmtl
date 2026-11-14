'use strict';
// GET /dashboard (ports DashboardController). Not available to requester-only
// (Staff). Drivers see their own trips; approvers/managers see pending approvals
// and the audit feed; others see their recent requests.
const db = require('../../db/runtime');
const roleRepository = require('../../services/roleRepository');
const roles = require('../../services/roles');
const loaders = require('../../services/loaders');
const present = require('../../services/present');
const maintenanceAlerts = require('../../services/maintenanceAlerts');
const { requireAuth } = require('../../middleware/auth');
const { forbidden } = require('../../middleware/errorHandler');

const MANAGES = ['administrator', 'supervisor', 'transport_admin', 'schedule_transport_officer'];

module.exports = function register(router) {
  router.get('/dashboard', requireAuth, async (req, res) => {
    if (req.ouScope) return res.json({ data: await require('../../services/ouAdmin').dashboard(req) });
    const user = req.session.user;
    const caps = user.is_super_admin ? require('../../services/capabilities').all() : await roleRepository.capsForUser(user.id);
    if (roles.isRequesterOnly(caps)) throw forbidden('The dashboard is not available for your role.');

    if(caps.includes('fleet.global') && !caps.includes('requests.assign')) {
      const vehicles=await db.all(`${loaders.VEHICLE_SELECT} WHERE v.deleted_at IS NULL ORDER BY v.vehicle_number`);
      const drivers=await db.all(`${loaders.DRIVER_SELECT} WHERE d.deleted_at IS NULL ORDER BY d.name`);
      return res.json({data:{fleet_only:true,vehicles:vehicles.map(present.vehicle),drivers:drivers.map(present.driver)}});
    }
    const roleSlug = await roleRepository.roleSlugForUser(user.id);
    const manages = user.is_super_admin || MANAGES.includes(roleSlug);
    const isApprover = roleSlug === 'approver';
    const driver = roleSlug === 'driver' ? await db.get('SELECT id FROM drivers WHERE user_id = ?', [user.id]) : null;
    const driverId = driver ? driver.id : null;

    const today = new Date().toISOString().slice(0, 10);
    const todaysTripRows = await db.all(
      `SELECT id FROM trips WHERE substr(scheduled_start,1,10) = substr(?,1,10) ${driverId ? 'AND driver_id = ?' : ''} ORDER BY scheduled_start`,
      driverId ? [today, driverId] : [today]);
    const todays_schedule = [];
    for (const r of todaysTripRows) todays_schedule.push(await loaders.loadTrip(r.id, { withRequest: true, withStops: false }));

    const cards = {
      pending_requests: (await db.get("SELECT COUNT(*) AS n FROM vehicle_requests WHERE status = 'pending' AND deleted_at IS NULL")).n,
      todays_trips: todaysTripRows.length,
      vehicles_available: (await db.get("SELECT COUNT(*) AS n FROM vehicles WHERE active = 1 AND status = 'available'")).n,
      vehicles_on_trip: (await db.get("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'on_trip'")).n,
      completed_trips_today: todays_schedule.filter((t) => t.status === 'completed').length,
      total_distance_month: (await db.get("SELECT COALESCE(SUM(distance),0) AS d FROM trips WHERE status = 'completed' AND substr(actual_end,1,7) = ?", [new Date().toISOString().slice(0, 7)])).d,
    };

    const boardRows = await db.all(`${loaders.VEHICLE_SELECT} WHERE v.active = 1 ORDER BY v.vehicle_number`);
    const vehicle_board = [];
    for (const v of boardRows) {
      const activeTrip = await db.get("SELECT id FROM trips WHERE vehicle_id = ? AND status IN ('scheduled','in_progress') ORDER BY scheduled_start LIMIT 1", [v.id]);
      vehicle_board.push({ ...present.vehicle(v), active_trip: activeTrip ? await loaders.loadTrip(activeTrip.id, { withRequest: true, withStops: false }) : null });
    }

    const data = { cards, todays_schedule, vehicle_board, maintenance_alerts: await maintenanceAlerts.all() };

    if (driverId) {
      const myRows = await db.all("SELECT id FROM trips WHERE driver_id = ? AND status IN ('scheduled','in_progress') ORDER BY scheduled_start LIMIT 10", [driverId]);
      data.my_trips = [];
      for (const r of myRows) data.my_trips.push(await loaders.loadTrip(r.id, { withRequest: true, withStops: false }));
      return res.json({ data });
    }

    if (manages || isApprover) {
      const rows = await db.all(`${loaders.REQUEST_SELECT} WHERE r.status = 'pending' AND r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 8`);
      data.pending_approvals = rows.map((r) => present.request(r));
    } else {
      const rows = await db.all(`${loaders.REQUEST_SELECT} WHERE r.requester_id = ? AND r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 8`, [user.id]);
      data.my_recent_requests = [];
      for (const r of rows) data.my_recent_requests.push(present.request(r, { trip: await loaders.tripForRequest(r.id) }));
    }

    if (manages) {
      const rows = await db.all('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC, a.id DESC LIMIT 10');
      data.recent_activity = rows.map((a) => ({ id: a.id, action: a.action, description: a.description, user: a.user_name, entity_type: a.entity_type, entity_id: a.entity_id, created_at: a.created_at }));
    }

    res.json({ data });
  });
};
