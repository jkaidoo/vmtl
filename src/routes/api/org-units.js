'use strict';
// Organisational units (ports OrgUnitController): scoped selector list, the full
// management tree (with counts), and CRUD gated on departments.manage.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const orgUnitsSvc = require('../../services/orgUnits');
const present = require('../../services/present');
const enums = require('../../services/enums');
const audit = require('../../services/audit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, conflict } = require('../../middleware/errorHandler');

const TYPES = ['institution', 'college', 'faculty', 'directorate', 'department', 'unit', 'office'];

module.exports = function register(router) {
  router.get('/org-units', requireAuth, async (req, res) => {
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    let rows = [];
    if (scope === null) rows = await db.all('SELECT * FROM org_units ORDER BY path');
    else if (scope.length) rows = await db.all(`SELECT * FROM org_units WHERE id IN (${scope.map(() => '?').join(',')}) ORDER BY path`, scope);
    res.json({ data: rows.map(present.orgUnit) });
  });

  router.get('/org-units/tree', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage organisation units.');
    const rows = await db.all(`SELECT * FROM org_units WHERE ${require('../../services/ouAdmin').clause(req, 'id')} ORDER BY path`);
    const data = [];
    for (const u of rows) {
      const counts = await db.get('SELECT (SELECT COUNT(*) FROM vehicles WHERE org_unit_id = o.id AND deleted_at IS NULL) AS v, (SELECT COUNT(*) FROM drivers WHERE org_unit_id = o.id AND deleted_at IS NULL) AS d, (SELECT COUNT(*) FROM users WHERE org_unit_id = o.id AND deleted_at IS NULL) AS u FROM org_units o WHERE o.id = ?', [u.id]);
      data.push({ ...present.orgUnit(u), vehicles_count: counts.v, drivers_count: counts.d, users_count: counts.u, active: !!u.active });
    }
    res.json({ data, types: enums.options.org_unit_type });
  });

  router.post('/org-units', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage organisation units.');
    const data = validate(req.body, { name: { required: true, type: 'string', maxLength: 255 }, code: { type: 'string', maxLength: 50 }, type: { required: true, type: 'string', in: TYPES }, parent_id: { type: 'integer' } });
    const id = await orgUnitsSvc.create(data);
    await audit.from(req, { action: 'org_unit.created', description: `Org unit '${data.name}' was added`, entityType: 'org_unit', entityId: id });
    res.status(201).json({ data: present.orgUnit(await db.get('SELECT * FROM org_units WHERE id = ?', [id])) });
  });

  router.put('/org-units/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage organisation units.');
    const unit = await db.get('SELECT * FROM org_units WHERE id = ?', [req.params.id]);
    if (!unit) throw notFound('Org unit not found.');
    const data = validate(req.body, { name: { required: true, type: 'string', maxLength: 255 }, code: { type: 'string', maxLength: 50 }, type: { required: true, type: 'string', in: TYPES }, parent_id: { type: 'integer' }, active: { type: 'boolean' } });
    if (data.parent_id && (await orgScope.subtreeIds(unit.id)).includes(data.parent_id)) throw conflict('A unit cannot be moved under itself or one of its descendants.');
    const fields = {};
    for (const k of ['name', 'code', 'type', 'parent_id', 'active']) if (req.body[k] !== undefined) fields[k] = k === 'active' ? (data.active ? 1 : 0) : data[k];
    await orgUnitsSvc.update(unit.id, fields);
    await audit.from(req, { action: 'org_unit.updated', description: `Org unit '${unit.name}' was updated`, entityType: 'org_unit', entityId: unit.id });
    res.json({ data: present.orgUnit(await db.get('SELECT * FROM org_units WHERE id = ?', [unit.id])) });
  });

  router.delete('/org-units/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.DEPARTMENTS_MANAGE))) throw forbidden('You may not manage organisation units.');
    const unit = await db.get('SELECT * FROM org_units WHERE id = ?', [req.params.id]);
    if (!unit) throw notFound('Org unit not found.');
    if ((await db.get('SELECT COUNT(*) AS n FROM org_units WHERE parent_id = ?', [unit.id])).n > 0) throw conflict('Remove or re-parent the sub-units first.');
    const used = await db.get('SELECT (SELECT COUNT(*) FROM vehicles WHERE org_unit_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM drivers WHERE org_unit_id = ? AND deleted_at IS NULL) + (SELECT COUNT(*) FROM users WHERE org_unit_id = ? AND deleted_at IS NULL) AS n', [unit.id, unit.id, unit.id]);
    if (used.n > 0) throw conflict('This unit still has vehicles, drivers or staff assigned.');
    await db.run(`UPDATE org_units SET deleted_at = ${db.now()} WHERE id = ?`, [unit.id]);
    await audit.from(req, { action: 'org_unit.deleted', description: `Org unit '${unit.name}' was removed`, entityType: 'org_unit', entityId: unit.id });
    res.json({ message: 'Org unit removed.' });
  });
};
