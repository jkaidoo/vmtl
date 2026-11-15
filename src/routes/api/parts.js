'use strict';
// Tyre & spare-parts inventory. Each part tracks on-hand quantity against a
// reorder level; stock movements (receipt / fitment to a vehicle / adjustment)
// change the quantity and keep a history. Org-scoped to the viewer.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has, inScope, resolveOrgUnit } = require('../../services/authz');
const audit = require('../../services/audit');
const orgScope = require('../../services/orgScope');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { forbidden, notFound, badRequest } = require('../../middleware/errorHandler');

const CATEGORIES = ['tyre', 'part', 'fluid', 'battery', 'other'];
const RULES = {
  name: { required: true, type: 'string', maxLength: 200 },
  category: { required: true, type: 'string', in: CATEGORIES },
  part_number: { type: 'string', maxLength: 100 },
  unit: { type: 'string', maxLength: 30 },
  quantity: { type: 'number', min: 0 },
  reorder_level: { type: 'number', min: 0 },
  unit_cost: { type: 'number', min: 0 },
  location: { type: 'string', maxLength: 120 },
  size: { type: 'string', maxLength: 60 },
  brand: { type: 'string', maxLength: 100 },
  notes: { type: 'string', maxLength: 1000 },
  org_unit_id: { type: 'integer' },
};
const MOVE_RULES = {
  movement_type: { required: true, type: 'string', in: ['receipt', 'fitment', 'adjustment'] },
  quantity: { required: true, type: 'number' },
  vehicle_id: { type: 'integer' }, work_order_id: { type: 'integer' },
  odometer: { type: 'integer', min: 0 }, position: { type: 'string', maxLength: 60 },
  unit_cost: { type: 'number', min: 0 }, note: { type: 'string', maxLength: 500 },
};

function partDto(p) {
  return {
    id: p.id, part_number: p.part_number, name: p.name, category: p.category,
    org_unit_id: p.org_unit_id, org_unit: p.org_unit_name ? { id: p.org_unit_id, name: p.org_unit_name } : null,
    unit: p.unit, quantity: p.quantity, reorder_level: p.reorder_level, unit_cost: p.unit_cost,
    location: p.location, size: p.size, brand: p.brand, notes: p.notes, active: !!p.active,
    low_stock: p.reorder_level != null && Number(p.quantity) <= Number(p.reorder_level),
    created_at: p.created_at,
  };
}

module.exports = function register(router) {
  router.get('/parts', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden('You may not view the parts inventory.');
    const where = ['p.deleted_at IS NULL', 'p.active = 1']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) where.push('p.org_unit_id IS NULL'); else { where.push(`(p.org_unit_id IS NULL OR p.org_unit_id IN (${scope.map(() => '?').join(',')}))`); params.push(...scope); } }
    if (req.query.category) { where.push('p.category = ?'); params.push(String(req.query.category)); }
    if (req.query.low === '1') where.push('p.reorder_level IS NOT NULL AND p.quantity <= p.reorder_level');
    const rows = await db.all(`SELECT p.*, o.name AS org_unit_name FROM parts_inventory p LEFT JOIN org_units o ON o.id = p.org_unit_id WHERE ${where.join(' AND ')} ORDER BY p.category, p.name`, params);
    res.json({ data: rows.map(partDto) });
  });

  router.get('/parts/stats', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden();
    const where = ['deleted_at IS NULL', 'active = 1']; const params = [];
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    if (scope !== null) { if (!scope.length) where.push('org_unit_id IS NULL'); else { where.push(`(org_unit_id IS NULL OR org_unit_id IN (${scope.map(() => '?').join(',')}))`); params.push(...scope); } }
    const rows = await db.all(`SELECT category, quantity, reorder_level FROM parts_inventory WHERE ${where.join(' AND ')}`, params);
    res.json({ data: {
      items: rows.length,
      tyres: rows.filter((r) => r.category === 'tyre').length,
      low_stock: rows.filter((r) => r.reorder_level != null && Number(r.quantity) <= Number(r.reorder_level)).length,
    } });
  });

  router.post('/parts', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden('You may not manage parts.');
    const data = validate(req.body, RULES);
    if (data.org_unit_id && !await inScope(req.session.user, data.org_unit_id)) throw forbidden('That organisational unit is outside your scope.');
    const orgUnitId = data.org_unit_id || await resolveOrgUnit(req.session.user, null);
    const r = await db.run(
      `INSERT INTO parts_inventory (part_number, name, category, org_unit_id, unit, quantity, reorder_level, unit_cost, location, size, brand, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()}, ${db.now()})`,
      [data.part_number || null, data.name, data.category, orgUnitId, data.unit || null, data.quantity != null ? data.quantity : 0, data.reorder_level != null ? data.reorder_level : null,
        data.unit_cost != null ? data.unit_cost : null, data.location || null, data.size || null, data.brand || null, data.notes || null, req.session.user.id]);
    await audit.from(req, { action: 'part.created', description: `Part "${data.name}" added to inventory`, entityType: 'part', entityId: r.lastInsertRowid });
    res.status(201).json({ data: { id: r.lastInsertRowid } });
  });

  router.put('/parts/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden('You may not manage parts.');
    const existing = await db.get('SELECT * FROM parts_inventory WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Part not found.');
    if (existing.org_unit_id && !await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    const data = validate(req.body, RULES);
    await db.run(
      `UPDATE parts_inventory SET part_number = ?, name = ?, category = ?, unit = ?, reorder_level = ?, unit_cost = ?, location = ?, size = ?, brand = ?, notes = ?, updated_at = ${db.now()} WHERE id = ?`,
      [data.part_number || null, data.name, data.category, data.unit || null, data.reorder_level != null ? data.reorder_level : null, data.unit_cost != null ? data.unit_cost : null,
        data.location || null, data.size || null, data.brand || null, data.notes || null, existing.id]);
    await audit.from(req, { action: 'part.updated', description: `Part "${data.name}" updated`, entityType: 'part', entityId: existing.id });
    res.json({ data: { id: existing.id } });
  });

  router.delete('/parts/:id', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden('You may not manage parts.');
    const existing = await db.get('SELECT * FROM parts_inventory WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!existing) throw notFound('Part not found.');
    if (existing.org_unit_id && !await inScope(req.session.user, existing.org_unit_id)) throw forbidden();
    await db.run(`UPDATE parts_inventory SET deleted_at = ${db.now()}, active = 0 WHERE id = ?`, [existing.id]);
    await audit.from(req, { action: 'part.deleted', description: `Part "${existing.name}" removed`, entityType: 'part', entityId: existing.id });
    res.json({ message: 'Part removed.' });
  });

  router.get('/parts/:id/movements', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden();
    const part = await db.get('SELECT * FROM parts_inventory WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!part) throw notFound('Part not found.');
    if (part.org_unit_id && !await inScope(req.session.user, part.org_unit_id)) throw forbidden();
    const rows = await db.all(
      `SELECT pm.*, v.vehicle_number, u.name AS recorded_by_name FROM part_movements pm
         LEFT JOIN vehicles v ON v.id = pm.vehicle_id LEFT JOIN users u ON u.id = pm.recorded_by
        WHERE pm.part_id = ? ORDER BY pm.id DESC LIMIT 100`, [req.params.id]);
    res.json({ data: rows.map((m) => ({
      id: m.id, movement_type: m.movement_type, quantity: m.quantity, vehicle_number: m.vehicle_number,
      position: m.position, odometer: m.odometer, unit_cost: m.unit_cost, note: m.note,
      recorded_by: m.recorded_by_name, created_at: m.created_at,
    })) });
  });

  router.post('/parts/:id/movements', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.PARTS_MANAGE))) throw forbidden('You may not record stock movements.');
    const part = await db.get('SELECT * FROM parts_inventory WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!part) throw notFound('Part not found.');
    if (part.org_unit_id && !await inScope(req.session.user, part.org_unit_id)) throw forbidden();
    const data = validate(req.body, MOVE_RULES);
    // Signed delta: receipt adds, fitment removes, adjustment is signed as entered.
    let delta = data.quantity;
    if (data.movement_type === 'receipt') delta = Math.abs(data.quantity);
    else if (data.movement_type === 'fitment') delta = -Math.abs(data.quantity);
    const newQty = Number(part.quantity) + delta;
    if (newQty < 0) throw badRequest('That would take the stock below zero.');
    if (data.vehicle_id) { const v = await db.get('SELECT id, org_unit_id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [data.vehicle_id]); if (!v) throw badRequest('Vehicle not found.'); if (!await inScope(req.session.user, v.org_unit_id)) throw forbidden('Vehicle is outside your scope.'); }
    await db.run(
      `INSERT INTO part_movements (part_id, vehicle_id, work_order_id, movement_type, quantity, odometer, position, unit_cost, note, recorded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${db.now()})`,
      [part.id, data.vehicle_id || null, data.work_order_id || null, data.movement_type, delta, data.odometer != null ? data.odometer : null, data.position || null, data.unit_cost != null ? data.unit_cost : null, data.note || null, req.session.user.id]);
    await db.run(`UPDATE parts_inventory SET quantity = ?, updated_at = ${db.now()} WHERE id = ?`, [newQty, part.id]);
    await audit.from(req, { action: 'part.movement', description: `${data.movement_type} of ${Math.abs(delta)} for "${part.name}" (now ${newQty})`, entityType: 'part', entityId: part.id });
    res.status(201).json({ data: { id: part.id, quantity: newQty } });
  });
};
