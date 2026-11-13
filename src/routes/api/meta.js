'use strict';
// GET /meta — selectors + enums for the frontend. Org units are scoped to the
// user's visible subtree (all for super admin), ordered by path with a depth
// for indented pickers.
const db = require('../../db/runtime');
const enums = require('../../services/enums');
const orgScope = require('../../services/orgScope');
const settings = require('../../services/settings');
const directoryAuth = require('../../services/directoryAuth');
const { requireAuth } = require('../../middleware/auth');

module.exports = function register(router) {
  router.get('/meta', requireAuth, async (req, res) => {
    const scope = await orgScope.visibleOrgUnitIds(req.session.user);
    let orgUnits = [];
    if (scope === null) orgUnits = await db.all("SELECT id, name, code, type, parent_id, path FROM org_units WHERE active = 1 ORDER BY path");
    else if (scope.length) orgUnits = await db.all(`SELECT id, name, code, type, parent_id, path FROM org_units WHERE active = 1 AND id IN (${scope.map(() => '?').join(',')}) ORDER BY path`, scope);

    const orgUnitDtos = orgUnits.map((u) => ({
      id: u.id, name: u.name, type: u.type, type_label: enums.orgUnitType.labels[u.type] || u.type,
      parent_id: u.parent_id, depth: u.path ? Math.max(0, (u.path.match(/\//g) || []).length - 2) : 0,
    }));

    const roles = await db.all('SELECT id, slug, name FROM roles ORDER BY id');
    const departments = await db.all('SELECT id, name, code FROM departments WHERE active = 1 ORDER BY name');

    let directoryEnabled = false; try { directoryEnabled = await directoryAuth.isEnabled(); } catch (_) { /* default off */ }
    const navHidden = (await settings.get('nav_hidden', [])) || [];
    const navLayout = await require('../../services/navigation').effective(req.session.user);
    res.json({ roles, departments, org_units: orgUnitDtos, enums: enums.options, directory_enabled: directoryEnabled, nav_hidden: navHidden, nav_layout: navLayout });
  });
};
