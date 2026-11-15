'use strict';
// Fleet cost analytics (no budgets): running costs pulled from fuel, maintenance,
// work orders and incidents, attributed to the owning organisational unit for
// department chargeback, and divided by completed-trip distance for cost-per-km.
// Everything is org-scoped to the viewer's visible subtree.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const { requireAuth } = require('../../middleware/auth');
const { forbidden } = require('../../middleware/errorHandler');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const month = (d) => (d ? String(d).slice(0, 7) : null);

module.exports = function register(router) {
  router.get('/costs', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.ANALYTICS_VIEW))) throw forbidden('You may not view costs.');
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const from = req.query.date_from ? String(req.query.date_from).slice(0, 10) : null;
    const to = req.query.date_to ? String(req.query.date_to).slice(0, 10) : null;
    const inScope = (id) => scope === null || (id != null && scope.includes(id));
    const within = (d) => (!d ? false : (!from || d >= from) && (!to || d <= to));

    // Org-unit names for grouping labels.
    const orgRows = await db.all('SELECT id, name FROM org_units');
    const orgName = new Map(orgRows.map((o) => [o.id, o.name]));

    const byCategory = { fuel: 0, maintenance: 0, work_orders: 0, incidents: 0 };
    const byDept = new Map();   // org_unit_id -> cost
    const byVehicle = new Map(); // vehicle_id -> { label, cost }
    const byMonth = new Map();  // YYYY-MM -> cost
    const addDept = (orgId, amt) => { const k = orgId == null ? 0 : orgId; byDept.set(k, (byDept.get(k) || 0) + amt); };
    const addVehicle = (id, label, amt) => { if (id == null) return; const g = byVehicle.get(id) || { id, label, cost: 0 }; g.cost += amt; byVehicle.set(id, g); };
    const addMonth = (d, amt) => { const m = month(d); if (!m) return; byMonth.set(m, (byMonth.get(m) || 0) + amt); };

    // Fuel + maintenance attribute to the vehicle's org unit.
    const fuel = await db.all('SELECT f.total_cost, f.purchase_date, f.vehicle_id, v.vehicle_number, v.org_unit_id FROM fuel_logs f JOIN vehicles v ON v.id = f.vehicle_id');
    for (const f of fuel) { const amt = Number(f.total_cost || 0); if (!amt || !within(f.purchase_date) || !inScope(f.org_unit_id)) continue; byCategory.fuel += amt; addDept(f.org_unit_id, amt); addVehicle(f.vehicle_id, f.vehicle_number, amt); addMonth(f.purchase_date, amt); }

    const maint = await db.all('SELECT m.cost, m.service_date, m.vehicle_id, v.vehicle_number, v.org_unit_id FROM maintenance_records m JOIN vehicles v ON v.id = m.vehicle_id WHERE m.deleted_at IS NULL');
    for (const m of maint) { const amt = Number(m.cost || 0); if (!amt || !within(m.service_date) || !inScope(m.org_unit_id)) continue; byCategory.maintenance += amt; addDept(m.org_unit_id, amt); addVehicle(m.vehicle_id, m.vehicle_number, amt); addMonth(m.service_date, amt); }

    // Work orders whose cost has already been mirrored into a maintenance record
    // (on completion) are skipped here, so the cost is not counted twice.
    const wos = await db.all('SELECT w.total_cost, w.completed_date, w.created_at, w.org_unit_id, w.vehicle_id, w.maintenance_record_id, v.vehicle_number FROM work_orders w LEFT JOIN vehicles v ON v.id = w.vehicle_id WHERE w.deleted_at IS NULL');
    for (const w of wos) { if (w.maintenance_record_id) continue; const amt = Number(w.total_cost || 0); const d = w.completed_date || String(w.created_at).slice(0, 10); if (!amt || !within(d) || !inScope(w.org_unit_id)) continue; byCategory.work_orders += amt; addDept(w.org_unit_id, amt); addVehicle(w.vehicle_id, w.vehicle_number, amt); addMonth(d, amt); }

    const inc = await db.all('SELECT estimated_cost, occurred_at, org_unit_id, vehicle_id FROM incidents WHERE deleted_at IS NULL');
    for (const x of inc) { const amt = Number(x.estimated_cost || 0); const d = String(x.occurred_at).slice(0, 10); if (!amt || !within(d) || !inScope(x.org_unit_id)) continue; byCategory.incidents += amt; addDept(x.org_unit_id, amt); addMonth(d, amt); }

    // Distance from completed trips (by the request's org unit).
    const trips = await db.all("SELECT t.distance, t.scheduled_start, r.org_unit_id FROM trips t JOIN vehicle_requests r ON r.id = t.vehicle_request_id WHERE t.status = 'completed' AND t.deleted_at IS NULL");
    let totalDistance = 0; const distByDept = new Map();
    for (const t of trips) { const km = Number(t.distance || 0); const d = String(t.scheduled_start).slice(0, 10); if (!km || !within(d) || !inScope(t.org_unit_id)) continue; totalDistance += km; distByDept.set(t.org_unit_id, (distByDept.get(t.org_unit_id) || 0) + km); }

    const total = byCategory.fuel + byCategory.maintenance + byCategory.work_orders + byCategory.incidents;
    res.json({ data: {
      total: r2(total), total_distance: Math.round(totalDistance),
      cost_per_km: totalDistance ? r2(total / totalDistance) : null,
      by_category: Object.entries(byCategory).map(([k, v]) => ({ category: k, label: { fuel: 'Fuel', maintenance: 'Maintenance', work_orders: 'Work orders', incidents: 'Incidents' }[k], cost: r2(v) })),
      by_department: [...byDept.entries()].map(([id, cost]) => ({ org_unit_id: id || null, label: id ? (orgName.get(id) || `Unit #${id}`) : 'Unassigned', cost: r2(cost), distance: Math.round(distByDept.get(id) || 0), cost_per_km: distByDept.get(id) ? r2(cost / distByDept.get(id)) : null })).sort((a, b) => b.cost - a.cost),
      by_vehicle: [...byVehicle.values()].map((v) => ({ ...v, cost: r2(v.cost) })).sort((a, b) => b.cost - a.cost).slice(0, 20),
      monthly: [...byMonth.entries()].map(([m, cost]) => ({ period: m, cost: r2(cost) })).sort((a, b) => a.period.localeCompare(b.period)),
    } });
  });
};
