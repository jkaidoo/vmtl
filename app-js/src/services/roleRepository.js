'use strict';
// Runtime RBAC resolution. Capabilities live in the role_capabilities table and
// are read fresh on each check so RBAC edits take effect immediately (no re-login).
// The break-glass System Administrator (users.is_super_admin) implicitly holds
// every capability and is the sole principal for the deep admin tier.
const db = require('../db/runtime');
const capabilities = require('./capabilities');

async function roleSlugForUser(userId) {
  const row = await db.get('SELECT r.slug FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?', [userId]);
  return row ? row.slug : null;
}

// Capabilities for a user id. Super admins get the full catalog.
async function capsForUser(userId) {
  const user = await db.get('SELECT id, role_id, is_super_admin FROM users WHERE id = ?', [userId]);
  if (!user) return [];
  if (user.is_super_admin) return capabilities.all();
  if (!user.role_id) return [];
  const rows = await db.all('SELECT capability FROM role_capabilities WHERE role_id = ?', [user.role_id]);
  return rows.map((r) => r.capability);
}

async function capsForRole(roleId) {
  const rows = await db.all('SELECT capability FROM role_capabilities WHERE role_id = ?', [roleId]);
  return rows.map((r) => r.capability);
}

// Replace a role's capability set (RBAC editor). Unknown capabilities are ignored.
async function setRoleCapabilities(roleId, caps) {
  const valid = new Set(capabilities.all());
  const wanted = [...new Set((caps || []).filter((c) => valid.has(c)))];
  return db.transaction(async (tx) => {
    await tx.run('DELETE FROM role_capabilities WHERE role_id = ?', [roleId]);
    for (const cap of wanted) {
      await tx.run(`INSERT INTO role_capabilities (role_id, capability, created_at, updated_at) VALUES (?, ?, ${db.now()}, ${db.now()})`, [roleId, cap]);
    }
    return wanted;
  });
}

async function userHasCap(userId, cap) { return (await capsForUser(userId)).includes(cap); }

module.exports = { roleSlugForUser, capsForUser, capsForRole, setRoleCapabilities, userHasCap };
