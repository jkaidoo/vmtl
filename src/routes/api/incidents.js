'use strict';
// Incident & accident reports. An incident is tied to a vehicle (and optionally
// a driver and trip), scoped by the vehicle's / incident's org unit, and moves
// through a claim workflow: reported → assessing → claim_filed → resolved →
// closed. Photos attach through the fleet-files system (entity_type 'incident').
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const present = require('../../services/present');
const audit = require('../../services/audit');
const sequence = require('../../services/sequence');
const orgScope = require('../../services/orgScope');
const notifications = require('../../services/notifications');
const enums = require('../../services/enums');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, badRequest } = require('../../middleware/errorHandler');

const TYPES = Object.keys(enums.incidentType.labels);
const SEVERITIES = Object.keys(enums.incidentSeverity.labels);
const STATUSES = Object.keys(enums.incidentStatus.labels);

const RULES = {
  vehicle_id: { required: true, type: 'integer' },
  driver_id: { type: 'integer' }, trip_id: { type: 'integer' },
  incident_type: { required: true, type: 'string', in: TYPES },
  severity: { required: true, type: 'string', in: SEVERITIES },
  occurred_at: { required: true, type: 'string', maxLength: 32 },
  location_text: { type: 'string', maxLength: 500 },
  latitude: { type: 'number', min: -90, max: 90 }, longitude: { type: 'number', min: -180, max: 180 },
  description: { required: true, type: 'string', maxLength: 5000 },
  injuries: { type: 'integer', min: 0, max: 9999 }, injury_details: { type: 'string', maxLength: 2000 },
  third_party: { type: 'string', maxLength: 1000 }, estimated_cost: { type: 'number', min: 0 },
};
const UPDATE_RULES = {
  ...RULES,
  status: { type: 'string', in: STATUSES },
  claim_reference: { type: 'string', maxLength: 120 }, resolution: { type: 'string', maxLength: 5000 },
};

const SELECT = `SELECT i.*, v.vehicle_number, d.name AS driver_name, t.trip_number,
       o.name AS org_unit_name, o.type AS org_unit_type, u.name AS reported_by_name,
       (SELECT COUNT(*) FROM fleet_files WHERE entity_type='incident' AND entity_id=i.id AND kind='photo') AS photo_count
  FROM incidents i
  LEFT JOIN vehicles v ON v.id = i.vehicle_id
  LEFT JOIN drivers d ON d.id = i.driver_id
  LEFT JOIN trips t ON t.id = i.trip_id
  LEFT JOIN org_units o ON o.id = i.org_unit_id
  LEFT JOIN users u ON u.id = i.reported_by`;

async function dto(id) { return present.incident(await db.get(`${SELECT} WHERE i.id = ?`, [id])); }

module.exports = function register(router) {
  router.get('/incidents', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.INCIDENTS_MANAGE))) throw forbidden('You may not view incidents.');
    const where = ['i.deleted_at IS NULL']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) {
      if (!scope.length) return res.json({ data: [], meta: { current_page: 1, per_page: 10, total: 0, last_page: 1 } });
      where.push(`i.org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope);
    }
    if (req.query.vehicle_id) { where.push('i.vehicle_id = ?'); params.push(Number(req.query.vehicle_id)); }
    if (req.query.status) { where.push('i.status = ?'); params.push(String(req.query.status)); }
    if (req.query.incident_type) { where.push('i.incident_type = ?'); params.push(String(req.query.incident_type)); }
    if (req.query.open === '1') { where.push("i.status NOT IN ('resolved','closed')"); }
    const rows = await db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY i.occurred_at DESC, i.id DESC`, params);
    const mapped = rows.map(present.incident);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    res.json({ data: mapped.slice((page - 1) * perPage, page * perPage), meta: { current_page: page, per_page: perPage, total: mapped.length, last_page: Math.max(1, Math.ceil(mapped.length / perPage)) } });
  });

  router.get('/incidents/stats', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.INCIDENTS_MANAGE))) throw forbidden();
    const where = ['deleted_at IS NULL']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) return res.json({ data: { total: 0, open: 0, by_severity: [] } }); where.push(`org_unit_id IN (${scope.map(() => '?').join(',')})`); params.push(...scope); }
    const rows = await db.all(`SELECT severity, status FROM incidents WHERE ${where.join(' AND ')}`, params);
    const bySev = {};
    for (const r of rows) bySev[r.severity] = (bySev[r.severity] || 0) + 1;
    res.json({ data: {
      total: rows.length,
      open: rows.filter((r) => !['resolved', 'closed'].includes(r.status)).length,
      by_severity: SEVERITIES.map((s) => ({ severity: s, label: enums.incidentSeverity.labels[s], count: bySev[s] || 0 })),
    } });
  });

  async function loadScopedVehicle(req, vehicleId) {
    const v = await db.get('SELECT id, org_unit_id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]);
    if (!v) throw notFound('Vehicle not found.');
    if (!await inScope(req.session.user, v.org_unit_id)) throw forbidden('Vehicle is outside your scope.');
    return v;
  }

  router.post('/incidents', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.INCIDENTS_MANAGE))) throw forbidden('You may not report incidents.');
    const data = validate(req.body, RULES);
    const vehicle = await loadScopedVehicle(req, data.vehicle_id);
    if (data.driver_id) { const d = await db.get('SELECT id FROM drivers WHERE id = ? AND deleted_at IS NULL', [data.driver_id]); if (!d) throw badRequest('Driver not found.'); }
    if (data.trip_id) { const t = await db.get('SELECT id FROM trips WHERE id = ? AND deleted_at IS NULL', [data.trip_id]); if (!t) throw badRequest('Trip not found.'); }
    const orgUnitId = await resolveOrgUnit(req.session.user, vehicle.org_unit_id);
    const number = await sequence.next('incidents', 'incident_number', 'INC');
    const r = await db.run(
      `INSERT INTO incidents (incident_number, vehicle_id, driver_id, trip_id, org_unit_id, incident_type, severity, status, occurred_at, location_text, latitude, longitude, description, injuries, injury_details, third_party, estimated_cost, reported_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [number, data.vehicle_id, data.driver_id || null, data.trip_id || null, orgUnitId, data.incident_type, data.severity,
        String(data.occurred_at).slice(0, 19).replace('T', ' '), data.location_text || null,
        data.latitude != null ? data.latitude : null, data.longitude != null ? data.longitude : null,
        data.description, data.injuries != null ? data.injuries : 0, data.injury_details || null, data.third_party || null,
        data.estimated_cost != null ? data.estimated_cost : null, req.session.user.id]);
    await audit.from(req, { action: 'incident.created', description: `Incident ${number} (${data.incident_type}) reported for vehicle #${data.vehicle_id}`, entityType: 'incident', entityId: r.lastInsertRowid });
    // Notify fleet oversight of major/total-loss incidents.
    if (['major', 'total_loss'].includes(data.severity)) {
      try { await notifications.toRoles(['administrator', 'it_admin'], 'incident_major', { title: 'Serious incident reported', body: `${number}: ${enums.incidentType.labels[data.incident_type]} (${enums.incidentSeverity.labels[data.severity]})`, url: '/incidents.html' }); } catch (_) { /* non-fatal */ }
    }
    res.status(201).json({ data: await dto(r.lastInsertRowid) });
  });

  router.get('/incidents/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.INCIDENTS_MANAGE))) throw forbidden();
    const row = await db.get(`${SELECT} WHERE i.id = ? AND i.deleted_at IS NULL`, [req.params.id]);
    if (!row) throw notFound('Incident not found.');
    if (!await inScope(req.session.user, row.org_unit_id)) throw forbidden();
    const photos = await db.all("SELECT id FROM fleet_files WHERE entity_type='incident' AND entity_id=? AND kind='photo' ORDER BY id", [row.id]);
    res.json({ data: { ...present.incident(row), photos: photos.map((p) => ({ id: p.id, url: `/api/fleet-files/${p.id}` })) } });
  });

  router.put('/incidents/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.INCIDENTS_MANAGE))) throw forbidden('You may not manage incidents.');
    const existing = await db.get('SELECT * FROM incidents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Incident not found.');
    if (!await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    const data = validate(req.body, UPDATE_RULES);
    await loadScopedVehicle(req, data.vehicle_id);
    const status = data.status || existing.status;
    const closing = ['resolved', 'closed'].includes(status) && !['resolved', 'closed'].includes(existing.status);
    const reopening = !['resolved', 'closed'].includes(status) && ['resolved', 'closed'].includes(existing.status);
    const closedAt = closing ? `${db.now()}` : (reopening ? 'NULL' : 'closed_at');
    await db.run(
      `UPDATE incidents SET vehicle_id = ?, driver_id = ?, trip_id = ?, incident_type = ?, severity = ?, status = ?, occurred_at = ?, location_text = ?, latitude = ?, longitude = ?, description = ?, injuries = ?, injury_details = ?, third_party = ?, estimated_cost = ?, claim_reference = ?, resolution = ?, closed_at = ${closedAt}, updated_at = ${db.now()} WHERE id = ?`,
      [data.vehicle_id, data.driver_id || null, data.trip_id || null, data.incident_type, data.severity, status,
        String(data.occurred_at).slice(0, 19).replace('T', ' '), data.location_text || null,
        data.latitude != null ? data.latitude : null, data.longitude != null ? data.longitude : null,
        data.description, data.injuries != null ? data.injuries : 0, data.injury_details || null, data.third_party || null,
        data.estimated_cost != null ? data.estimated_cost : null, data.claim_reference || null, data.resolution || null, existing.id]);
    await audit.from(req, { action: 'incident.updated', description: `Incident ${existing.incident_number} updated (status ${status})`, entityType: 'incident', entityId: existing.id });
    res.json({ data: await dto(existing.id) });
  });

  router.delete('/incidents/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.INCIDENTS_MANAGE))) throw forbidden('You may not manage incidents.');
    const existing = await db.get('SELECT * FROM incidents WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Incident not found.');
    if (!await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    await db.run(`UPDATE incidents SET deleted_at = ${db.now()} WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'incident.deleted', description: `Incident ${existing.incident_number} was removed`, entityType: 'incident', entityId: existing.id });
    res.json({ message: 'Incident removed.' });
  });
};
