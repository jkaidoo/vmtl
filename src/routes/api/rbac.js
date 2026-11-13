'use strict';
// RBAC editor (ports RbacController) — break-glass System Administrator only.
const db = require('../../db/runtime');
const capabilities = require('../../services/capabilities');
const roleRepository = require('../../services/roleRepository');
const audit = require('../../services/audit');
const { requireAuth, requireSystemAdmin } = require('../../middleware/auth');

async function snapshot() {
  const roles = await db.all('SELECT id, slug, name, description FROM roles ORDER BY id');
  const out = [];
  for (const role of roles) out.push({ ...role, capabilities: await roleRepository.capsForRole(role.id) });
  return {
    capabilities: Object.entries(capabilities.CATALOG).map(([key, m]) => ({ key, label: m.label, group: m.group, description: m.description })),
    roles: out,
    scopes: [
      { key: 'OWN', description: 'Acts only on records the user owns (their requests, their trips).' },
      { key: 'TEAM', description: 'Acts on records within the user’s department or team.' },
      { key: 'ALL', description: 'Acts on every record in the system.' },
    ],
    note: 'The System Administrator (break-glass) implicitly holds every capability.',
  };
}

module.exports = function register(router) {
  router.get('/rbac', requireAuth, requireSystemAdmin, async (req, res) => { res.json({ data: await snapshot() }); });

  router.put('/rbac/roles/:roleId/capabilities', requireAuth, requireSystemAdmin, async (req, res) => {
    const role = await db.get('SELECT * FROM roles WHERE id = ?', [req.params.roleId]);
    if (!role) return res.status(404).json({ error: 'Role not found.' });
    const current = await roleRepository.capsForRole(role.id);
    const desired = await roleRepository.setRoleCapabilities(role.id, Array.isArray(req.body.capabilities) ? req.body.capabilities : []);
    await audit.from(req, { action: 'rbac.updated', description: `${req.session.user.name} updated capabilities for role ${role.name}`, entityType: 'role', entityId: role.id, oldValues: { capabilities: current }, newValues: { capabilities: desired } });
    res.json({ data: await snapshot() });
  });
};
