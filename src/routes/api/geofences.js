'use strict';
// Geofences: circular inclusion / exclusion zones. A vehicle's live fixes are
// checked against active fences in its org scope; crossing one records a
// geofence event and (on a breach) notifies fleet oversight. Managed by fleet
// operators (requests.assign) or system administrators.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const audit = require('../../services/audit');
const orgScope = require('../../services/orgScope');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound } = require('../../middleware/errorHandler');

const RULES = {
  name: { required: true, type: 'string', maxLength: 120 },
  kind: { required: true, type: 'string', in: ['inclusion', 'exclusion'] },
  latitude: { required: true, type: 'number', min: -90, max: 90 },
  longitude: { required: true, type: 'number', min: -180, max: 180 },
  radius_m: { required: true, type: 'integer', min: 20, max: 200000 },
  org_unit_id: { type: 'integer' },
  active: { type: 'boolean' },
  notes: { type: 'string', maxLength: 1000 },
};

async function canManage(req) { return req.session.user.is_super_admin || await has(req, CAP.SYSTEM_ADMIN) || await has(req, CAP.REQUESTS_ASSIGN); }

module.exports = function register(router) {
  router.get('/geofences', requireAuth, async (req, res) => {
    if (!(await canManage(req))) throw forbidden('You may not view geofences.');
    const where = ['g.deleted_at IS NULL']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) {
      if (!scope.length) where.push('g.org_unit_id IS NULL');
      else { where.push(`(g.org_unit_id IS NULL OR g.org_unit_id IN (${scope.map(() => '?').join(',')}))`); params.push(...scope); }
    }
    const rows = await db.all(
      `SELECT g.*, o.name AS org_unit_name,
        (SELECT COUNT(*) FROM geofence_events WHERE geofence_id = g.id) AS event_count
       FROM geofences g LEFT JOIN org_units o ON o.id = g.org_unit_id
       WHERE ${where.join(' AND ')} ORDER BY g.name`, params);
    res.json({ data: rows.map((g) => ({
      id: g.id, name: g.name, kind: g.kind, latitude: g.latitude, longitude: g.longitude, radius_m: g.radius_m,
      org_unit_id: g.org_unit_id, org_unit: g.org_unit_id ? { id: g.org_unit_id, name: g.org_unit_name } : null,
      active: !!g.active, notes: g.notes, event_count: Number(g.event_count), created_at: g.created_at,
    })) });
  });

  router.get('/geofence-events', requireAuth, async (req, res) => {
    if (!(await canManage(req))) throw forbidden();
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const where = ['1=1']; const params = [];
    if (scope !== null) {
      if (!scope.length) where.push('(v.org_unit_id IS NULL)');
      else { where.push(`(v.org_unit_id IN (${scope.map(() => '?').join(',')}) OR g.org_unit_id IS NULL)`); params.push(...scope); }
    }
    const rows = await db.all(
      `SELECT ge.*, g.name AS geofence_name, g.kind, v.vehicle_number, t.trip_number
         FROM geofence_events ge
         JOIN geofences g ON g.id = ge.geofence_id
         LEFT JOIN vehicles v ON v.id = ge.vehicle_id
         LEFT JOIN trips t ON t.id = ge.trip_id
        WHERE ${where.join(' AND ')} ORDER BY ge.id DESC LIMIT 100`, params);
    res.json({ data: rows.map((e) => ({
      id: e.id, geofence: e.geofence_name, kind: e.kind, event_type: e.event_type,
      is_breach: (e.kind === 'exclusion' && e.event_type === 'enter') || (e.kind === 'inclusion' && e.event_type === 'exit'),
      vehicle_number: e.vehicle_number, trip_number: e.trip_number, occurred_at: e.occurred_at,
    })) });
  });

  router.post('/geofences', requireAuth, async (req, res) => {
    if (!(await canManage(req))) throw forbidden('You may not manage geofences.');
    const data = validate(req.body, RULES);
    if (data.org_unit_id && !await inScope(req.session.user, data.org_unit_id)) throw forbidden('That organisational unit is outside your scope.');
    const orgUnitId = data.org_unit_id || null;
    const r = await db.run(
      `INSERT INTO geofences (name, kind, latitude, longitude, radius_m, org_unit_id, active, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [data.name, data.kind, data.latitude, data.longitude, data.radius_m, orgUnitId, data.active === false ? 0 : 1, data.notes || null, req.session.user.id]);
    await audit.from(req, { action: 'geofence.created', description: `Geofence "${data.name}" (${data.kind}) created`, entityType: 'geofence', entityId: r.lastInsertRowid });
    res.status(201).json({ data: { id: r.lastInsertRowid } });
  });

  router.put('/geofences/:id', requireAuth, async (req, res) => {
    if (!(await canManage(req))) throw forbidden('You may not manage geofences.');
    const existing = await db.get('SELECT * FROM geofences WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Geofence not found.');
    if (existing.org_unit_id && !await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    const data = validate(req.body, RULES);
    if (data.org_unit_id && !await inScope(req.session.user, data.org_unit_id)) throw forbidden('That organisational unit is outside your scope.');
    await db.run(
      `UPDATE geofences SET name = ?, kind = ?, latitude = ?, longitude = ?, radius_m = ?, org_unit_id = ?, active = ?, notes = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.name, data.kind, data.latitude, data.longitude, data.radius_m, data.org_unit_id || null, data.active === false ? 0 : 1, data.notes || null, existing.id]);
    await audit.from(req, { action: 'geofence.updated', description: `Geofence "${data.name}" updated`, entityType: 'geofence', entityId: existing.id });
    res.json({ data: { id: existing.id } });
  });

  router.delete('/geofences/:id', requireAuth, async (req, res) => {
    if (!(await canManage(req))) throw forbidden('You may not manage geofences.');
    const existing = await db.get('SELECT * FROM geofences WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Geofence not found.');
    if (existing.org_unit_id && !await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    await db.run(`UPDATE geofences SET deleted_at = ${db.now()}, active = 0 WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'geofence.deleted', description: `Geofence "${existing.name}" removed`, entityType: 'geofence', entityId: existing.id });
    res.json({ message: 'Geofence removed.' });
  });
};
