'use strict';
// Departments (ports DepartmentController). Listing is open to any authenticated
// user (for dropdowns); management is gated on departments.manage.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, badRequest } = require('../../middleware/errorHandler');

const dept = (d) => ({ id: d.id, name: d.name, code: d.code, active: !!d.active, created_at: d.created_at });

module.exports = function register(router) {
  router.get('/departments', requireAuth, async (req, res) => {
    const where = ['deleted_at IS NULL']; const params = [];
    if (req.query.active_only === 'true' || req.query.active_only === '1') where.push('active = 1');
    if (req.query.search) { where.push('name LIKE ?'); params.push(`%${req.query.search}%`); }
    const rows = await db.all(`SELECT * FROM departments WHERE ${where.join(' AND ')} ORDER BY name`, params);
    res.json({ data: rows.map(dept) });
  });

  router.post('/departments', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage departments.');
    const data = validate(req.body, { name: { required: true, type: 'string', maxLength: 255 }, code: { type: 'string', maxLength: 50 }, active: { type: 'boolean', default: true } });
    if (data.code && await db.get('SELECT id FROM departments WHERE code = ? AND deleted_at IS NULL', [data.code])) throw badRequest('The given data was invalid.', { code: ['That code is already in use.'] });
    const r = await db.run(`INSERT INTO departments (name, code, active, created_at, updated_at) VALUES (?, ?, ?, ${db.now()}, ${db.now()})`, [data.name, data.code || null, data.active ? 1 : 0]);
    await audit.from(req, { action: 'department.created', description: `Department ${data.name} was created`, entityType: 'department', entityId: r.lastInsertRowid });
    res.status(201).json({ data: dept(await db.get('SELECT * FROM departments WHERE id = ?', [r.lastInsertRowid])) });
  });

  router.put('/departments/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage departments.');
    const existing = await db.get('SELECT * FROM departments WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Department not found.');
    const data = validate(req.body, { name: { required: true, type: 'string', maxLength: 255 }, code: { type: 'string', maxLength: 50 }, active: { type: 'boolean' } });
    const sets = ['name = ?', 'code = ?']; const params = [data.name, data.code || null];
    if (req.body.active !== undefined) { sets.push('active = ?'); params.push(data.active ? 1 : 0); }
    await db.run(`UPDATE departments SET ${sets.join(', ')}, updated_at = ${db.now()} WHERE id = ?`, [...params, existing.id]);
    await audit.from(req, { action: 'department.updated', description: `Department ${data.name} was updated`, entityType: 'department', entityId: existing.id });
    res.json({ data: dept(await db.get('SELECT * FROM departments WHERE id = ?', [existing.id])) });
  });

  router.delete('/departments/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage departments.');
    const existing = await db.get('SELECT * FROM departments WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Department not found.');
    await db.run(`UPDATE departments SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'department.deleted', description: `Department ${existing.name} was removed`, entityType: 'department', entityId: existing.id });
    res.json({ message: 'Department removed.' });
  });
};
