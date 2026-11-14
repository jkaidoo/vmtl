'use strict';
// Drivers (ports DriverController): scoped list, CRUD, (de)activate, optional
// self-service login account provisioning, per-driver trip history.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const loaders = require('../../services/loaders');
const present = require('../../services/present');
const audit = require('../../services/audit');
const { hashPassword, passwordProblems } = require('../../util/password');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict, badRequest } = require('../../middleware/errorHandler');

const DRIVER_RULES = {
  name: { required: true, type: 'string', maxLength: 255 }, employee_id: { type: 'string', maxLength: 50 },
  phone: { type: 'string', maxLength: 50 }, licence_number: { type: 'string', maxLength: 100 }, licence_expiry: { type: 'date' },
  status: { type: 'string', in: ['available', 'on_trip', 'unavailable', 'on_leave', 'inactive'] }, org_unit_id: { type: 'integer' },
  notes: { type: 'string', maxLength: 2000 },
};

async function findDriver(id) { const d = await db.get('SELECT * FROM drivers WHERE id = ? AND deleted_at IS NULL', [id]); if (!d) throw notFound('Driver not found.'); return d; }
async function driverDto(id) { return present.driver(await db.get(`${loaders.DRIVER_SELECT} WHERE d.id = ?`, [id])); }

const wantsLogin=body=>[true,1,'1','true'].includes(body.create_login);
async function authorizeLogin(req,driver){
  if(!wantsLogin(req.body)) return;
  if(!await has(req,CAP.USERS_MANAGE)) throw forbidden('Accounts and roles are assigned on the Users page.');
  if(driver?.user_id && !req.session.user.is_super_admin){
    const linked=await db.get('SELECT u.*,r.slug AS role_slug FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=?',[driver.user_id]);
    if(!linked || linked.is_super_admin || linked.role_slug!=='driver' || !await inScope(req.session.user,linked.org_unit_id)) throw forbidden('Manage this linked account on the Users page.');
  }
}

async function syncLogin(driver, body, conn=db) {
  if (!(body.create_login === true || body.create_login === '1' || body.create_login === 'true')) return;
  const email = String(body.login_email || '').trim().toLowerCase();
  if (!email) throw badRequest('The given data was invalid.', { login_email: ['A login email is required to create an account.'] });
  const password = body.login_password;
  if (password) { const problems = passwordProblems(password); if (problems.length) throw badRequest('The given data was invalid.', { login_password: problems }); }
  const roleId = (await conn.get("SELECT id FROM roles WHERE slug = 'driver'")).id;
  if (driver.user_id) {
    const sets = ['name = ?', 'email = ?', 'phone = ?']; const params = [driver.name, email, driver.phone];
    if (password) { sets.push('password_hash = ?'); params.push(hashPassword(password)); }
    await conn.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, driver.user_id]);
    return;
  }
  if (!password) throw badRequest('The given data was invalid.', { login_password: ['A password is required to create a new login account.'] });
  const dupe = await conn.get('SELECT id FROM users WHERE lower(email) = ?', [email]);
  if (dupe) throw badRequest('The given data was invalid.', { login_email: ['That email is already in use.'] });
  const r = await conn.run(`INSERT INTO users (name, email, password_hash, role_id, phone, org_unit_id, active, is_super_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ${db.now()}, ${db.now()})`, [driver.name, email, hashPassword(password), roleId, driver.phone, driver.org_unit_id]);
  await conn.run(`UPDATE drivers SET user_id = ?, updated_at = ${db.now()} WHERE id = ?`, [r.lastInsertRowid, driver.id]);
  driver.user_id = r.lastInsertRowid;
}

module.exports = function register(router) {
  router.get('/drivers', requireAuth, async (req, res) => {
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['d.deleted_at IS NULL']; const params = [];
    if (scope !== null) { if (!scope.length) return res.json({ data: [] }); where.push(`d.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    if (req.query.status) { where.push('d.status = ?'); params.push(String(req.query.status)); }
    if (req.query.active_only === 'true' || req.query.active_only === '1') where.push('d.active = 1');
    if (req.query.org_unit_id) { where.push('d.org_unit_id = ?'); params.push(Number(req.query.org_unit_id)); }
    if (req.query.search) { const s = `%${req.query.search}%`; where.push('(d.name LIKE ? OR d.employee_id LIKE ? OR d.licence_number LIKE ?)'); params.push(s, s, s); }
    const rows = await db.all(`${loaders.DRIVER_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.name`, params);
    const mapped = rows.map(present.driver);
    if (req.query.all === 'true' || req.query.all === '1') return res.json({ data: mapped });
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  router.post('/drivers', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DRIVERS_MANAGE))) throw forbidden('You may not manage drivers.');
    await authorizeLogin(req, null);
    const data = validate(req.body, await require('../../services/dropdowns').rules(DRIVER_RULES, {status:'driver_status'}));
    if (data.employee_id) { const dupe = await db.get('SELECT id FROM drivers WHERE employee_id = ? AND deleted_at IS NULL', [data.employee_id]); if (dupe) throw badRequest('The given data was invalid.', { employee_id: ['That employee ID is already in use.'] }); }
    const orgUnitId = await resolveOrgUnit(req.session.user, data.org_unit_id);
    const driver=await db.transaction(async tx=>{
    const r = await tx.run(`INSERT INTO drivers (name, employee_id, phone, licence_number, licence_expiry, status, org_unit_id, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ${db.now()}, ${db.now()})`,
      [data.name, data.employee_id || null, data.phone || null, data.licence_number || null, data.licence_expiry || null, data.status || 'available', orgUnitId, data.notes || null]);
    const driver=await tx.get('SELECT * FROM drivers WHERE id=?',[r.lastInsertRowid]);
    await syncLogin(driver, req.body, tx);
      return driver;
    });
    await audit.from(req, { action: 'driver.created', description: `Driver ${data.name} was added`, entityType: 'driver', entityId: driver.id });
    res.status(201).json({ data: await driverDto(driver.id) });
  });

  router.get('/drivers/:id', requireAuth, async (req, res) => { const driver=await findDriver(req.params.id); if(!await inScope(req.session.user,driver.org_unit_id)) throw forbidden('Driver is outside your scope.'); res.json({ data: await driverDto(req.params.id) }); });

  router.put('/drivers/:id', requireAuth, async (req, res) => {
    const driver = await findDriver(req.params.id);
    if (!(await has(req, CAP.DRIVERS_MANAGE)) || !(await inScope(req.session.user, driver.org_unit_id))) throw forbidden('You may not manage this driver.');
    await authorizeLogin(req, driver);
    const data = validate(req.body, await require('../../services/dropdowns').rules(DRIVER_RULES, {status:'driver_status'}));
    if (req.body.org_unit_id !== undefined) data.org_unit_id = await resolveOrgUnit(req.session.user, data.org_unit_id);
    const fields = []; const params = [];
    for (const k of Object.keys(DRIVER_RULES)) if (req.body[k] !== undefined) { fields.push(`${k} = ?`); params.push(data[k]); }
    await db.transaction(async tx=>{
    if (fields.length) await tx.run(`UPDATE drivers SET ${fields.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, driver.id]);
    await syncLogin(await tx.get('SELECT * FROM drivers WHERE id=?',[driver.id]), req.body, tx);
    });
    await audit.from(req, { action: 'driver.updated', description: `Driver ${driver.name} was updated`, entityType: 'driver', entityId: driver.id });
    res.json({ data: await driverDto(driver.id) });
  });

  router.post('/drivers/:id/active', requireAuth, async (req, res) => {
    const driver = await findDriver(req.params.id);
    if (!(await has(req, CAP.DRIVERS_MANAGE)) || !(await inScope(req.session.user, driver.org_unit_id))) throw forbidden('You may not manage this driver.');
    const active = req.body.active === true || req.body.active === 1 || req.body.active === '1' || req.body.active === 'true';
    if (!active && driver.status === 'on_trip') throw conflict('This driver is on a trip and cannot be deactivated.');
    await db.run(`UPDATE drivers SET active = ?, status = ?, updated_at = ${db.now()} WHERE id = ?`, [active ? 1 : 0, active ? 'available' : 'inactive', driver.id]);
    await audit.from(req, { action: active ? 'driver.activated' : 'driver.deactivated', description: `Driver ${driver.name} was ${active ? 'reactivated' : 'deactivated'}`, entityType: 'driver', entityId: driver.id });
    res.json({ data: await driverDto(driver.id) });
  });

  router.delete('/drivers/:id', requireAuth, async (req, res) => {
    const driver = await findDriver(req.params.id);
    if (!(await has(req, CAP.DRIVERS_MANAGE)) || !(await inScope(req.session.user, driver.org_unit_id))) throw forbidden('You may not manage this driver.');
    if(await db.get("SELECT id FROM trips WHERE driver_id=? AND status IN ('scheduled','in_progress') LIMIT 1",[driver.id])) throw conflict('Cancel or complete the assigned trips before removing this driver.');
    await db.run(`UPDATE drivers SET deleted_at = ${db.now()} WHERE id = ?`, [driver.id]);
    await audit.from(req, { action: 'driver.deleted', description: `Driver ${driver.name} was removed`, entityType: 'driver', entityId: driver.id });
    res.json({ message: 'Driver removed.' });
  });

  router.get('/drivers/:id/trips', requireAuth, async (req, res) => {
    const driver=await findDriver(req.params.id);
    if(!await inScope(req.session.user,driver.org_unit_id)) throw forbidden('Driver is outside your scope.');
    const rows = await db.all(`SELECT id FROM trips WHERE driver_id = ? AND deleted_at IS NULL AND ${require('../../services/ouAdmin').tripClause(req, 'trips')} ORDER BY scheduled_start DESC LIMIT 50`, [req.params.id]);
    const data = []; for (const r of rows) data.push(await loaders.loadTrip(r.id, { withRequest: true, withStops: false }));
    res.json({ data });
  });
};
