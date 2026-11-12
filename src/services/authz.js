'use strict';
// Per-request authorization helpers shared by routes: capability lookup (cached
// on the request), and org-unit scope resolution for fleet create/update.
const roleRepository = require('./roleRepository');
const capabilities = require('./capabilities');
const orgScope = require('./orgScope');

async function caps(req) {
  if (!req._caps) req._caps = req.session.user.is_super_admin ? capabilities.all() : await roleRepository.capsForUser(req.session.user.id);
  return req._caps;
}
async function has(req, cap) { return (await caps(req)).includes(cap); }

// Whether an org unit is within the user's visible scope (null scope = all).
async function inScope(user, orgUnitId) {
  const scope = await orgScope.visibleOrgUnitIds(user);
  return scope === null || (orgUnitId != null && scope.includes(orgUnitId));
}

// Constrain a chosen org unit to the actor's scope; default to the actor's unit.
async function resolveOrgUnit(user, orgUnitId) {
  const scope = await orgScope.visibleOrgUnitIds(user);
  if (orgUnitId && (scope === null || scope.includes(orgUnitId))) return orgUnitId;
  return user.org_unit_id || null;
}

module.exports = { caps, has, inScope, resolveOrgUnit };
