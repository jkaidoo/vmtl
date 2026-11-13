'use strict';
// User management (ports UserController + UserPolicy). Scoped to the actor's OU
// subtree (+ unassigned accounts); scoped managers cannot grant the admin role
// or place users outside their subtree; the break-glass admin is protected.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const present = require('../../services/present');
const audit = require('../../services/audit');
const directoryAuth = require('../../services/directoryAuth');
const { hashPassword } = require('../../util/password');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, badRequest } = require('../../middleware/errorHandler');

const USER_SELECT = `SELECT u.*, r.slug AS role_slug, r.name AS role_name, o.name AS org_unit_name, o.type AS org_unit_type, dep.name AS department_name
  FROM users u LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN org_units o ON o.id = u.org_unit_id LEFT JOIN departments dep ON dep.id = u.department_id`;

async function seesAll(req) { return req.session.user.is_super_admin || (await has(req, CAP.USERS_MANAGE) && (await require('../../services/roleRepository').roleSlugForUser(req.session.user.id)) === 'administrator'); }
async function userDto(id) { return present.user(await db.get(`${USER_SELECT} WHERE u.id = ?`, [id])); }

// A scoped manager may act on users in their subtree, plus unassigned accounts.
async function inUserScope(actor, targetOrgUnitId) {
  const scope = await orgScope.visibleOrgUnitIds(actor);
  if (scope === null) return true;
  if (targetOrgUnitId == null) return true;
  return scope.includes(targetOrgUnitId);
}

async function guardAssignment(req, data) {
  if (await seesAll(req)) return;
  if (data.role_id) {
    const slug = (await db.get('SELECT slug FROM roles WHERE id = ?', [data.role_id]) || {}).slug;
    if (slug === 'administrator') throw badRequest('The given data was invalid.', { role_id: ['You cannot assign the System Administrator role.'] });
  }
  const scope = await orgScope.visibleOrgUnitIds(req.session.user);
  if (scope !== null && data.org_unit_id && !scope.includes(data.org_unit_id)) throw badRequest('The given data was invalid.', { org_unit_id: ['You can only assign units within your organisation.'] });
}

// Keep a linked driver record in step with a user's "can also drive" flag, so a
// Transport Officer who drives appears in the driver pool. Retiring the flag
// retires the auto-linked driver (history is kept).
async function syncDriverLink(userId) {
  const u = await db.get('SELECT id, name, phone, org_unit_id, can_drive, active FROM users WHERE id = ?', [userId]);
  if (!u) return;
  const existing = await db.get('SELECT id, deleted_at FROM drivers WHERE user_id = ?', [userId]);
  if (u.can_drive && u.active) {
    if (!existing) await db.run(`INSERT INTO drivers (user_id, name, phone, org_unit_id, status, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'available', 1, ${db.now()}, ${db.now()})`, [userId, u.name, u.phone || null, u.org_unit_id || null]);
    else if (existing.deleted_at) await db.run(`UPDATE drivers SET deleted_at = NULL, active = 1, status = 'available', name = ?, org_unit_id = ?, updated_at = ${db.now()} WHERE id = ?`, [u.name, u.org_unit_id || null, existing.id]);
  } else if (existing && !existing.deleted_at) {
    await db.run(`UPDATE drivers SET deleted_at = ${db.now()}, active = 0, status = 'inactive', updated_at = ${db.now()} WHERE id = ?`, [existing.id]);
  }
}

module.exports = function register(router) {
  router.get('/users', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['u.deleted_at IS NULL']; const params = [];
    if (scope !== null) { where.push(`(u.org_unit_id IN (${scope.length ? scope.map(() => '?').join(',') : 'NULL'}) OR u.org_unit_id IS NULL)`); params.push(...scope); }
    if (req.query.role_id) { where.push('u.role_id = ?'); params.push(Number(req.query.role_id)); }
    if (req.query.department_id) { where.push('u.department_id = ?'); params.push(Number(req.query.department_id)); }
    if (req.query.directory === 'true' || req.query.directory === '1') where.push('u.directory_provider IS NOT NULL');
    // Stakeholders hold a role (or are the App Owner); clients are role-less staff awaiting one.
    if (req.query.type === 'stakeholder') where.push('(u.role_id IS NOT NULL OR u.is_super_admin = 1)');
    else if (req.query.type === 'client') where.push('(u.role_id IS NULL AND u.is_super_admin = 0)');
    if (req.query.search) { const s = `%${req.query.search}%`; where.push('(u.name LIKE ? OR u.email LIKE ?)'); params.push(s, s); }
    const order = (req.query.directory === 'true' || req.query.directory === '1') ? 'u.last_login_at DESC' : 'u.name';
    const rows = await db.all(`${USER_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
    const mapped = rows.map(present.user);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 15));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  // People whose Unified API organisational unit now differs from their current
  // one, awaiting an admin decision (or auto-move once the grace period passes).
  router.get('/users/ou-changes', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['u.deleted_at IS NULL', 'u.pending_org_unit_id IS NOT NULL']; const params = [];
    if (scope !== null) { where.push(`(u.org_unit_id IN (${scope.length ? scope.map(() => '?').join(',') : 'NULL'}) OR u.org_unit_id IS NULL)`); params.push(...scope); }
    const rows = await db.all(`SELECT u.id, u.name, u.email, u.role_id, u.org_unit_id, u.pending_org_unit_id, u.pending_org_since,
        cur.name AS current_ou, pend.name AS pending_ou
      FROM users u LEFT JOIN org_units cur ON cur.id = u.org_unit_id LEFT JOIN org_units pend ON pend.id = u.pending_org_unit_id
      WHERE ${where.join(' AND ')} ORDER BY u.pending_org_since`, params);
    res.json({ data: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, user_type: r.role_id ? 'stakeholder' : 'client', current_ou: r.current_ou || 'Unassigned', pending_ou: r.pending_ou || null, pending_since: r.pending_org_since })) });
  });

  router.post('/users', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const data = validate(req.body, {
      name: { required: true, type: 'string', maxLength: 255 }, email: { required: true, type: 'string', maxLength: 255 },
      password: { required: true, type: 'string' }, role_id: { required: true, type: 'integer' },
      department_id: { type: 'integer' }, org_unit_id: { type: 'integer' }, phone: { type: 'string', maxLength: 50 },
      active: { type: 'boolean', default: true }, avatar: { type: 'string', maxLength: 700000 }, can_drive: { type: 'boolean' },
    });
    const email = data.email.trim().toLowerCase();
    if (await db.get('SELECT id FROM users WHERE lower(email) = ?', [email])) throw badRequest('The given data was invalid.', { email: ['That email is already in use.'] });
    await guardAssignment(req, data);
    const r = await db.run(`INSERT INTO users (name, email, password_hash, role_id, department_id, org_unit_id, phone, active, is_super_admin, avatar, can_drive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ${db.now()}, ${db.now()})`,
      [data.name, email, hashPassword(data.password), data.role_id, data.department_id || null, data.org_unit_id || null, data.phone || null, data.active ? 1 : 0, data.avatar || null, data.can_drive ? 1 : 0]);
    await syncDriverLink(r.lastInsertRowid);
    await audit.from(req, { action: 'user.created', description: `User ${data.name} (${email}) was created`, entityType: 'user', entityId: r.lastInsertRowid });
    res.status(201).json({ data: await userDto(r.lastInsertRowid) });
  });

  // Search the directory (LDAP/AD) for people to add as staff.
  router.get('/users/directory/search', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    res.json(await directoryAuth.searchDirectory(req.query.q || '', 25));
  });

  // Create a local staff account from a directory entry (no password; they sign
  // in through the directory). Role + org unit are chosen by the administrator.
  router.post('/users/directory/import', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    if (!(await directoryAuth.isEnabled())) throw badRequest('Directory sign-in is not enabled.');
    const data = validate(req.body, {
      username: { type: 'string', maxLength: 255 }, name: { required: true, type: 'string', maxLength: 255 },
      email: { type: 'string', maxLength: 255 }, role_id: { required: true, type: 'integer' },
      department_id: { type: 'integer' }, org_unit_id: { type: 'integer' },
    });
    const provider = await directoryAuth.activeProvider();
    const base = (data.email && data.email.trim()) ? data.email.trim() : `${String(data.username || data.name).replace(/\s+/g, '.').toLowerCase()}@directory.local`;
    const email = base.toLowerCase();
    if (await db.get('SELECT id FROM users WHERE lower(email) = ?', [email])) throw badRequest('The given data was invalid.', { email: ['A user with that email already exists.'] });
    await guardAssignment(req, data);
    const r = await db.run(`INSERT INTO users (name, email, password_hash, role_id, department_id, org_unit_id, active, is_super_admin, directory_provider, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, 1, 0, ?, ${db.now()}, ${db.now()})`,
      [data.name, email, data.role_id, data.department_id || null, data.org_unit_id || null, provider]);
    await audit.from(req, { action: 'user.imported', description: `${data.name} (${email}) was added from the ${provider.toUpperCase()} directory`, entityType: 'user', entityId: r.lastInsertRowid });
    res.status(201).json({ data: await userDto(r.lastInsertRowid) });
  });

  router.get('/users/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    if (!(await inUserScope(req.session.user, target.org_unit_id))) throw forbidden('That user is outside your scope.');
    res.json({ data: await userDto(target.id) });
  });

  router.put('/users/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    if (target.is_super_admin && !req.session.user.is_super_admin) throw forbidden('You cannot edit the System Administrator.');
    if (!(await inUserScope(req.session.user, target.org_unit_id))) throw forbidden('That user is outside your scope.');
    const data = validate(req.body, {
      name: { required: true, type: 'string', maxLength: 255 }, email: { required: true, type: 'string', maxLength: 255 },
      password: { type: 'string' }, role_id: { required: true, type: 'integer' },
      department_id: { type: 'integer' }, org_unit_id: { type: 'integer' }, phone: { type: 'string', maxLength: 50 },
      active: { type: 'boolean' }, avatar: { type: 'string', maxLength: 700000 }, can_drive: { type: 'boolean' },
    });
    const email = data.email.trim().toLowerCase();
    if (await db.get('SELECT id FROM users WHERE lower(email) = ? AND id != ?', [email, target.id])) throw badRequest('The given data was invalid.', { email: ['That email is already in use.'] });
    await guardAssignment(req, data);
    const sets = ['name = ?', 'email = ?', 'role_id = ?', 'department_id = ?', 'org_unit_id = ?', 'phone = ?'];
    const params = [data.name, email, data.role_id, data.department_id || null, data.org_unit_id || null, data.phone || null];
    if (req.body.active !== undefined) { sets.push('active = ?'); params.push(data.active ? 1 : 0); }
    if (req.body.avatar !== undefined) { sets.push('avatar = ?'); params.push(data.avatar || null); }
    if (req.body.can_drive !== undefined) { sets.push('can_drive = ?'); params.push(data.can_drive ? 1 : 0); }
    if (data.password) { sets.push('password_hash = ?'); params.push(hashPassword(data.password)); }
    await db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, target.id]);
    await syncDriverLink(target.id);
    await audit.from(req, { action: 'user.updated', description: `User ${data.name} was updated`, entityType: 'user', entityId: target.id });
    res.json({ data: await userDto(target.id) });
  });

  // Partial update — used by the Clients page to assign a role (promote to
  // stakeholder) and/or move a client's org unit, without a full edit.
  router.patch('/users/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    if (target.is_super_admin && !req.session.user.is_super_admin) throw forbidden('You cannot edit the System Administrator.');
    if (!(await inUserScope(req.session.user, target.org_unit_id))) throw forbidden('That user is outside your scope.');
    const data = validate(req.body, { role_id: { type: 'integer' }, org_unit_id: { type: 'integer' }, active: { type: 'boolean' } });
    await guardAssignment(req, data);
    const sets = []; const params = [];
    if ('role_id' in req.body) { sets.push('role_id = ?'); params.push(data.role_id || null); }
    if ('org_unit_id' in req.body) { sets.push('org_unit_id = ?'); params.push(data.org_unit_id || null); if (!data.org_unit_id || Number(data.org_unit_id) === Number(target.pending_org_unit_id)) { sets.push('pending_org_unit_id = NULL', 'pending_org_since = NULL'); } }
    if (req.body.active !== undefined) { sets.push('active = ?'); params.push(data.active ? 1 : 0); }
    if (!sets.length) return res.json({ data: await userDto(target.id) });
    await db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, target.id]);
    await audit.from(req, { action: 'user.updated', description: `${target.name} was updated`, entityType: 'user', entityId: target.id });
    res.json({ data: await userDto(target.id) });
  });

  // Re-sync a person from the Unified API now (ignores the throttle).
  router.post('/users/:id/resync', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT id, email FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    const out = await require('../../services/staffSync').syncUser(target.id, target.email, { force: true });
    res.json({ data: { ...out, user: await userDto(target.id) } });
  });

  // Apply a pending OU change now (admin acts before the grace period).
  router.post('/users/:id/apply-ou-change', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    if (!target.pending_org_unit_id) throw badRequest('There is no pending unit change for this person.');
    if (!(await inUserScope(req.session.user, target.org_unit_id))) throw forbidden('That user is outside your scope.');
    await db.run(`UPDATE users SET org_unit_id = ?, pending_org_unit_id = NULL, pending_org_since = NULL, updated_at = ${db.now()} WHERE id = ?`, [target.pending_org_unit_id, target.id]);
    await audit.from(req, { action: 'user.ou_changed', description: `${req.session.user.name} moved ${target.name} to their new organisational unit`, entityType: 'user', entityId: target.id });
    res.json({ data: await userDto(target.id) });
  });
  // Dismiss a pending OU change (keep the current unit, clear the pending one).
  router.post('/users/:id/dismiss-ou-change', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    if (!(await inUserScope(req.session.user, target.org_unit_id))) throw forbidden('That user is outside your scope.');
    await db.run(`UPDATE users SET pending_org_unit_id = NULL, pending_org_since = NULL, updated_at = ${db.now()} WHERE id = ?`, [target.id]);
    await audit.from(req, { action: 'user.ou_change_dismissed', description: `${req.session.user.name} kept ${target.name} in their current organisational unit`, entityType: 'user', entityId: target.id });
    res.json({ data: await userDto(target.id) });
  });

  router.delete('/users/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.USERS_MANAGE))) throw forbidden('You may not manage users.');
    const target = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User not found.');
    if (target.is_super_admin && !req.session.user.is_super_admin) throw forbidden('You cannot remove the System Administrator.');
    if (target.id === req.session.user.id) throw forbidden('You cannot remove your own account.');
    if (!(await inUserScope(req.session.user, target.org_unit_id))) throw forbidden('That user is outside your scope.');
    await db.run(`UPDATE users SET deleted_at = ${db.now()}, active = 0 WHERE id = ?`, [target.id]);
    await audit.from(req, { action: 'user.deleted', description: `User ${target.name} was removed`, entityType: 'user', entityId: target.id });
    res.json({ message: 'User removed.' });
  });
};
