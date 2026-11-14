'use strict';
const db = require('../db/runtime');
const { forbidden, notFound } = require('../middleware/errorHandler');
const GLOBAL = ['system.admin', 'fleet.global', 'roles.manage', 'schedule.events'];
async function identity(user) {
  if (!user || user.is_super_admin) return null;
  const row = await db.get('SELECT u.*, r.slug AS role_slug FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?', [user.id]);
  if (!row) return null;
  const caps = (await db.all('SELECT capability FROM role_capabilities WHERE role_id=?', [row.role_id])).map(r => r.capability);
  return row.role_slug === 'it_admin' || (caps.includes('ou.admin') && !caps.includes('system.admin')) ? { ...row, caps } : null;
}
function clause(req, column) { return req.ouScope ? req.ouScope.length ? `${column} IN (${req.ouScope.join(',')})` : '1=0' : '1=1'; }
function tripClause(req, alias = 't') {
  if (!req.ouScope) return '1=1';
  return `${alias}.vehicle_id IN (SELECT id FROM vehicles WHERE ${clause(req, 'org_unit_id')}) AND ${alias}.driver_id IN (SELECT id FROM drivers WHERE ${clause(req, 'org_unit_id')}) AND (${alias}.vehicle_request_id IS NULL OR ${alias}.vehicle_request_id IN (SELECT id FROM vehicle_requests WHERE ${clause(req, 'org_unit_id')}))`;
}
async function prepare(req) {
  const admin = await identity(req.session.user); if (!admin) return;
  if (!admin.active || admin.deleted_at) throw forbidden('This account is inactive.');
  req.session.user.org_unit_id = admin.org_unit_id; req.session.user.role_id = admin.role_id;
  req.ouAdmin = admin;
  req.ouScope = admin.org_unit_id ? await require('./orgScope').subtreeIds(admin.org_unit_id) : [];
  req.ouScope = req.ouScope.map(Number).filter(Number.isSafeInteger);
  const path = req.path.replace(/^\/api(?=\/)/, '');
  if (path === '/file-upload-config' && req.method === 'GET') return;
  if (/^\/(me|logout|meta|notifications|push)(\/|$)/.test(path)) return;
  if (!req.ouScope.length) throw forbidden('Assign an organisational unit to this IT Admin before managing records.');
  if (!/^\/(dashboard|users|vehicles|drivers|vehicle-requests|trips|schedule|tracking|availability|maintenance-records|fuel-logs|analytics|reports|audit-logs|org-units|fleet-files)(\/|$)/.test(path)) throw forbidden('IT Admin access is limited to records in the assigned OU. Application-wide settings require the App Owner.');
  if (/^\/users\/(directory|[^/]+\/resync)/.test(path)) throw forbidden('Directory administration requires the App Owner.');
  if (path === '/tracking/config' && req.method !== 'GET') throw forbidden('Map configuration applies to the whole application.');
  if (path === '/users' && req.method === 'POST' && !req.body?.org_unit_id) req.body.org_unit_id = admin.org_unit_id;
  const inScope = id => id != null && req.ouScope.includes(Number(id));
  const requireOU = id => { if (!inScope(id)) throw forbidden('This record is outside your assigned OU.'); };
  async function record(table, id) {
    const row = await db.get(`SELECT * FROM ${table} WHERE id=?`, [id]); if (!row) throw notFound('Record not found.');
    if (table === 'trips') {
      const valid = await db.get(`SELECT t.id FROM trips t WHERE t.id=? AND ${tripClause(req)}`, [id]);
      if (!valid) throw forbidden('This trip is outside your assigned OU.');
    } else if (['fuel_logs', 'maintenance_records', 'odometer_readings'].includes(table)) { const vehicle = await db.get('SELECT org_unit_id FROM vehicles WHERE id=?', [row.vehicle_id]); requireOU(vehicle?.org_unit_id); }
    else if (table === 'org_units') requireOU(row.id);
    else requireOU(row.org_unit_id);
    if (table === 'users') {
      const caps = await require('./roleRepository').capsForUser(row.id);
      if (row.is_super_admin || caps.some(c => GLOBAL.includes(c)) || (await require('./ownerAccess').pagesFor(row)).length) throw forbidden('You cannot manage an account with application-wide access.');
      const scoped = await identity(row);
      if (scoped && req.body?.role_id != null && Number(req.body.role_id) !== Number(row.role_id)) throw forbidden('Only the App Owner can change an IT Admin’s role.');
      if (scoped && 'org_unit_id' in (req.body || {}) && Number(req.body.org_unit_id) !== Number(row.org_unit_id)) throw forbidden('Only the App Owner can move an IT Admin to another OU.');
      if (path.endsWith('/apply-ou-change')) requireOU(row.pending_org_unit_id);
    }
    return row;
  }
  const tables = { users: 'users', vehicles: 'vehicles', drivers: 'drivers', 'vehicle-requests': 'vehicle_requests', trips: 'trips', 'org-units': 'org_units', 'fuel-logs': 'fuel_logs', 'maintenance-records': 'maintenance_records' };
  const match = path.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/);
  const collections = { users: ['ou-changes'], trips: ['in-progress'], 'org-units': ['tree'], 'vehicle-requests': ['goodwill', 'external'] };
  if (match && tables[match[1]] && !(collections[match[1]] || []).includes(match[2])) {
    if (!/^\d+$/.test(match[2])) throw notFound('Record not found.');
    await record(tables[match[1]], match[2]);
  }
  for (const input of [req.query || {}, req.body || {}]) {
    for (const key of ['org_unit_id', 'parent_id']) if (key in input && input[key] !== '' && input[key] != null) requireOU(input[key]);
    if (req.method !== 'GET' && 'org_unit_id' in input && !input.org_unit_id) throw forbidden('An OU-scoped record cannot be unassigned.');
    if (req.method !== 'GET' && path.startsWith('/org-units') && 'parent_id' in input && !input.parent_id) throw forbidden('Units must remain within your assigned OU.');
    for (const [key, table] of [['vehicle_id', 'vehicles'], ['driver_id', 'drivers'], ['requester_id', 'users'], ['user_id', 'users'], ['trip_id', 'trips']]) if (input[key]) await record(table, input[key]);
  }
  if (req.body?.role_id) {
    const wanted = await require('./roleRepository').capsForRole(req.body.role_id);
    if (wanted.some(c => GLOBAL.includes(c) || !admin.caps.includes(c)) || (wanted.includes('users.manage') && !wanted.includes('ou.admin'))) throw forbidden('Choose an OU-scoped role within your own permissions.');
  }
  if (/^\/org-units\/\d+/.test(path) && req.method !== 'GET' && Number(match?.[2]) === Number(admin.org_unit_id)) {
    if (req.method === 'DELETE' || 'parent_id' in (req.body || {}) || req.body?.active === false) throw forbidden('Only the App Owner can move, disable or remove your assigned OU.');
  }
  if (path === '/org-units' && req.method === 'POST' && !req.body?.parent_id) throw forbidden('Create new units beneath your assigned OU.');
}
async function ensureRole() {
  const settings = require('./settings');
  if (await settings.get('it_admin_role_installed', false)) return;
  if (!await db.get("SELECT id FROM roles WHERE slug='it_admin'")) {
    const caps = require('./capabilities').defaultsByRole().it_admin;
    await require('./roleManagement').create({ slug: 'it_admin', name: 'IT Admin', description: 'Full administration within the assigned OU and its descendants. No application-wide settings.', capabilities: caps });
  }
  await settings.set('it_admin_role_installed', '1');
}
async function dashboard(req) {
  const loaders = require('./loaders'); const present = require('./present');
  const today = new Date().toISOString().slice(0, 10);
  const tripRows = await db.all(`SELECT t.id FROM trips t WHERE ${tripClause(req)} AND substr(t.scheduled_start,1,10)=? AND t.deleted_at IS NULL ORDER BY t.scheduled_start`, [today]);
  const todays_schedule = []; for (const row of tripRows) todays_schedule.push(await loaders.loadTrip(row.id, { withRequest: true, withStops: false }));
  const vehicles = await db.all(`${loaders.VEHICLE_SELECT} WHERE v.deleted_at IS NULL AND v.active=1 AND ${clause(req, 'v.org_unit_id')} ORDER BY v.vehicle_number`);
  const vehicle_board = [];
  for (const vehicle of vehicles) {
    const trip = await db.get(`SELECT t.id FROM trips t WHERE t.vehicle_id=? AND ${tripClause(req)} AND t.status IN ('scheduled','in_progress') ORDER BY t.scheduled_start LIMIT 1`, [vehicle.id]);
    vehicle_board.push({ ...present.vehicle(vehicle), active_trip: trip ? await loaders.loadTrip(trip.id, { withRequest: true, withStops: false }) : null });
  }
  const requests = await db.all(`${loaders.REQUEST_SELECT} WHERE r.status='pending' AND r.deleted_at IS NULL AND ${clause(req, 'r.org_unit_id')} ORDER BY r.created_at DESC`);
  const activity = await db.all(`SELECT a.*,u.name AS user_name FROM audit_logs a JOIN users u ON u.id=a.user_id WHERE ${clause(req, 'u.org_unit_id')} ORDER BY a.created_at DESC,a.id DESC LIMIT 10`);
  const distance = await db.get(`SELECT COALESCE(SUM(distance),0) AS n FROM trips t WHERE ${tripClause(req)} AND t.status='completed' AND substr(t.actual_end,1,7)=?`, [today.slice(0, 7)]);
  return { cards: { pending_requests: requests.length, todays_trips: tripRows.length, vehicles_available: vehicles.filter(v => v.status === 'available').length, vehicles_on_trip: vehicles.filter(v => v.status === 'on_trip').length, completed_trips_today: todays_schedule.filter(t => t.status === 'completed').length, total_distance_month: distance.n },
    todays_schedule, vehicle_board, pending_approvals: requests.slice(0, 8).map(r => present.request(r)),
    maintenance_alerts: await require('./maintenanceAlerts').all(req.ouScope),
    recent_activity: activity.map(a => ({ id: a.id, action: a.action, description: a.description, user: a.user_name, entity_type: a.entity_type, entity_id: a.entity_id, created_at: a.created_at })) };
}
module.exports = { identity, prepare, clause, tripClause, ensureRole, dashboard, GLOBAL };
