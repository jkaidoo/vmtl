'use strict';
// RBAC editor (ports RbacController) — break-glass System Administrator only.
const db = require('../../db/runtime');
const capabilities = require('../../services/capabilities');
const roleRepository = require('../../services/roleRepository');
const audit = require('../../services/audit');
const management = require('../../services/roleManagement');
const { conflict } = require('../../middleware/errorHandler');
const { requireAuth, requireSystemAdmin } = require('../../middleware/auth');
// System pages: System Administrators always, plus roles/people the App Owner shares them with (Owner page access).
const { requirePage: sharedPage, requireChannelPage: sharedChannel } = require('../../services/ownerAccess');

async function snapshot() {
  const roles = await db.all('SELECT r.id, r.slug, r.name, r.description, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) AS user_count FROM roles r ORDER BY r.id');
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
    note: 'The App Owner implicitly holds every capability, independently of roles.',
  };
}

module.exports = function register(router) {
  router.get('/rbac', requireAuth, sharedPage('rbac'), async (req, res) => { res.json({ data: await snapshot() }); });
  router.post('/rbac/roles', requireAuth, sharedPage('rbac'), async (req, res) => {
    const role = await management.create(req.body);
    await audit.from(req, { action: 'role.created', description: `Created role ${role.name}`, entityType: 'role', entityId: role.id, newValues: role });
    if (role.capabilities.includes('system.admin')) {
      const alerts = require('../../services/securityAlerts'); alerts.background(alerts.alert('administrator_role_changed', `Created role ${role.name} with System Administrator access.`, { role_id: role.id, actor_id: req.session.user.id }, `created:${role.id}`));
    }
    res.status(201).json({ data: await snapshot() });
  });
  router.put('/rbac/roles/:roleId', requireAuth, sharedPage('rbac'), async (req, res) => {
    const change = await management.update(req.params.roleId, req.body);
    await audit.from(req, { action: 'role.updated', description: `Updated role ${change.after.name}`, entityType: 'role', entityId: change.after.id, oldValues: change.before, newValues: change.after });
    res.json({ data: await snapshot() });
  });
  router.delete('/rbac/roles/:roleId', requireAuth, sharedPage('rbac'), async (req, res) => {
    const change = await management.remove(req.params.roleId, req.body?.replacement_role_id, req.session.user);
    await audit.from(req, { action: 'role.deleted', description: `Removed role ${change.role.name}; reassigned ${change.reassigned_count} accounts`, entityType: 'role', entityId: change.role.id, oldValues: change.role, newValues: { replacement_role_id: change.replacement_id, reassigned_count: change.reassigned_count } });
    if (change.reassigned_count && change.old_capabilities.includes('system.admin') !== change.new_capabilities.includes('system.admin')) {
      const alerts = require('../../services/securityAlerts'); alerts.background(alerts.alert('administrator_role_changed', 'Administrator access changed while removing a role and reassigning its accounts.', { role_id: change.role.id, replacement_role_id: change.replacement_id, actor_id: req.session.user.id }, `deleted:${change.role.id}`));
    }
    res.json({ data: await snapshot() });
  });

  router.put('/rbac/roles/:roleId/capabilities', requireAuth, sharedPage('rbac'), async (req, res) => {
    const role = await db.get('SELECT * FROM roles WHERE id = ?', [req.params.roleId]);
    if (!role) return res.status(404).json({ error: 'Role not found.' });
    const current = await roleRepository.capsForRole(role.id);
    const desiredCaps = management.caps(req.body.capabilities);
    const actor = await db.get('SELECT role_id FROM users WHERE id=?', [req.session.user.id]);
    if (!req.session.user.is_super_admin && Number(actor?.role_id) === Number(role.id) && current.includes('system.admin') && !desiredCaps.includes('system.admin') && !(await require('../../services/ownerAccess').pagesFor(req.session.user)).includes('rbac')) throw conflict('Keep System administration on your own role to retain RBAC access.');
    const desired = await roleRepository.setRoleCapabilities(role.id, desiredCaps);
    if (current.includes('system.admin') !== desired.includes('system.admin')) {
      const alerts = require('../../services/securityAlerts');
      alerts.background(alerts.alert('administrator_role_changed', `System Administrator access was ${desired.includes('system.admin') ? 'granted to' : 'removed from'} role ${role.name}.`, { role_id: role.id, actor_id: req.session.user.id, ip: req.ip }, `cap:${role.id}:${desired.includes('system.admin')}`));
    }
    await audit.from(req, { action: 'rbac.updated', description: `${req.session.user.name} updated capabilities for role ${role.name}`, entityType: 'role', entityId: role.id, oldValues: { capabilities: current }, newValues: { capabilities: desired } });
    res.json({ data: await snapshot() });
  });
};
