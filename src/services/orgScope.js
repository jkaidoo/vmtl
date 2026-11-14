'use strict';
// Org-unit scoping (ports User::visibleOrgUnitIds / servingOrgUnitIds and
// OrgUnit::subtreeIds / pathIds). Scoping uses the materialised `path`.
//   visible  = this unit + all descendants  (what you may see/manage)
//   serving  = this unit + all ancestors    (whose pool may fulfil your request)
const db = require('../db/runtime');

async function orgUnitRow(id) {
  if (!id) return null;
  return db.get('SELECT id, path FROM org_units WHERE id = ?', [id]);
}

// Ids of a unit and every descendant (self included).
async function subtreeIds(orgUnitId) {
  const unit = await orgUnitRow(orgUnitId);
  if (!unit) return [];
  const path = unit.path || `/${unit.id}/`;
  const rows = await db.all('SELECT id FROM org_units WHERE id = ? OR path LIKE ?', [unit.id, `${path}%`]);
  return rows.map((r) => r.id);
}

// Ids of a unit and every ancestor (self included), parsed from the path.
async function pathIds(orgUnitId) {
  const unit = await orgUnitRow(orgUnitId);
  if (!unit) return [];
  const trimmed = String(unit.path || `/${unit.id}/`).replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? [unit.id] : trimmed.split('/').map((n) => parseInt(n, 10));
}

// What a user may see/manage. null = unrestricted (super admin). [] = only
// records with no org unit (a user with no unit).
async function visibleOrgUnitIds(user) {
  if (!user) return [];
  if ((await require('./roleRepository').capsForUser(user.id)).includes('fleet.global')) return null;
  if (user.is_super_admin) return null;
  if (!user.org_unit_id) return [];
  return subtreeIds(user.org_unit_id);
}

// Which pools may serve a user's requests. null = unrestricted (super admin, or
// a user with no unit — avoids lockout).
async function servingOrgUnitIds(user) {
  if (!user) return null;
  if ((await require('./roleRepository').capsForUser(user.id)).includes('fleet.global')) return null;
  if (user.is_super_admin) return null;
  if (!user.org_unit_id) return null;
  return pathIds(user.org_unit_id);
}

module.exports = { subtreeIds, pathIds, visibleOrgUnitIds, servingOrgUnitIds };
