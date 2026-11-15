'use strict';
// Emissions & fuel-efficiency reporting. CO₂ is derived from litres purchased
// and the fuel type's emission factor; efficiency (km/L and L/100km) uses the
// odometer delta between consecutive fuel logs. Org-scoped to the viewer.
const db = require('../../db/runtime');
const { CAP } = require('../../services/capabilities');
const { has } = require('../../services/authz');
const orgScope = require('../../services/orgScope');
const { requireAuth } = require('../../middleware/auth');
const { forbidden } = require('../../middleware/errorHandler');

// kg CO₂ per litre (well-to-wheel approximations). Electric has no tailpipe fuel.
const FACTOR = { petrol: 2.31, diesel: 2.68, lpg: 1.51, hybrid: 1.40, electric: 0 };
const factorFor = (t) => (t && FACTOR[t] != null ? FACTOR[t] : 2.4);
const r1 = (n) => Math.round(Number(n || 0) * 10) / 10;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const month = (d) => (d ? String(d).slice(0, 7) : null);

module.exports = function register(router) {
  router.get('/emissions', requireAuth, async (req, res) => {
    if (!(await has(req, CAP.ANALYTICS_VIEW))) throw forbidden('You may not view emissions.');
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    const from = req.query.date_from ? String(req.query.date_from).slice(0, 10) : null;
    const to = req.query.date_to ? String(req.query.date_to).slice(0, 10) : null;
    const inScope = (id) => scope === null || (id != null && scope.includes(id));
    const within = (d) => (!d ? false : (!from || d >= from) && (!to || d <= to));

    const rows = await db.all(
      `SELECT f.litres, f.fuel_type, f.purchase_date, f.odometer, f.previous_odometer, f.vehicle_id, v.vehicle_number, v.org_unit_id
         FROM fuel_logs f JOIN vehicles v ON v.id = f.vehicle_id`);

    let totalLitres = 0, totalCo2 = 0, totalDist = 0;
    const byType = new Map();   // fuel_type -> { litres, co2 }
    const byVehicle = new Map();// vehicle_id -> { label, litres, co2, dist }
    const byMonth = new Map();  // YYYY-MM -> co2

    for (const f of rows) {
      const litres = Number(f.litres || 0);
      const d = f.purchase_date ? String(f.purchase_date).slice(0, 10) : null;
      if (!litres || !within(d) || !inScope(f.org_unit_id)) continue;
      const co2 = litres * factorFor(f.fuel_type);
      const dist = (f.previous_odometer != null && f.odometer != null) ? Math.max(0, f.odometer - f.previous_odometer) : 0;
      totalLitres += litres; totalCo2 += co2; totalDist += dist;
      const t = f.fuel_type || 'other';
      const g = byType.get(t) || { type: t, litres: 0, co2: 0 }; g.litres += litres; g.co2 += co2; byType.set(t, g);
      const vg = byVehicle.get(f.vehicle_id) || { id: f.vehicle_id, label: f.vehicle_number, litres: 0, co2: 0, dist: 0 };
      vg.litres += litres; vg.co2 += co2; vg.dist += dist; byVehicle.set(f.vehicle_id, vg);
      const m = month(d); if (m) byMonth.set(m, (byMonth.get(m) || 0) + co2);
    }

    const label = (t) => ({ petrol: 'Petrol', diesel: 'Diesel', lpg: 'LPG', hybrid: 'Hybrid', electric: 'Electric', other: 'Other' }[t] || t);
    res.json({ data: {
      total_litres: r1(totalLitres), total_co2_kg: r1(totalCo2), total_distance: Math.round(totalDist),
      co2_per_km: totalDist ? r2(totalCo2 / totalDist) : null,
      avg_l_per_100km: totalDist ? r1((totalLitres / totalDist) * 100) : null,
      by_fuel_type: [...byType.values()].map((g) => ({ type: g.type, label: label(g.type), litres: r1(g.litres), co2_kg: r1(g.co2) })).sort((a, b) => b.co2_kg - a.co2_kg),
      by_vehicle: [...byVehicle.values()].map((v) => ({
        id: v.id, label: v.label, litres: r1(v.litres), co2_kg: r1(v.co2),
        km_per_litre: v.dist && v.litres ? r2(v.dist / v.litres) : null,
        l_per_100km: v.dist && v.litres ? r1((v.litres / v.dist) * 100) : null,
      })).sort((a, b) => b.co2_kg - a.co2_kg).slice(0, 20),
      monthly: [...byMonth.entries()].map(([m, co2]) => ({ period: m, co2_kg: r1(co2) })).sort((a, b) => a.period.localeCompare(b.period)),
    } });
  });
};
