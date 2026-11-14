'use strict';
// Shape DB rows into the JSON the frontend expects (ports the Laravel API
// Resources). Keeps field names stable across the app.
const db = require('../db/runtime');
const roleRepository = require('./roleRepository');
const roles = require('./roles');

// A signed-in user with their role, org unit, capabilities and lockdown flag.
async function userForClient(userId) {
  const u = await db.get(
    `SELECT u.id, u.name, u.email, u.phone, u.active, u.is_super_admin, u.directory_provider, u.last_login_at, u.avatar,
            u.role_id, r.slug AS role_slug, r.name AS role_name, u.org_unit_id, o.name AS org_unit_name, o.path AS org_unit_path, o.type AS org_unit_type
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN org_units o ON o.id = u.org_unit_id
      WHERE u.id = ?`, [userId]);
  if (!u) return null;
  const caps = u.is_super_admin ? require('./capabilities').all() : await roleRepository.capsForUser(u.id);
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone,
    active: !!u.active, is_super_admin: !!u.is_super_admin,
    directory_provider: u.directory_provider, last_login_at: u.last_login_at,
    avatar: u.avatar || null,
    role: u.role_slug ? { slug: u.role_slug, label: u.role_name || roles.LABELS[u.role_slug] || u.role_slug } : null,
    org_unit: u.org_unit_id ? { id: u.org_unit_id, name: u.org_unit_name, type: u.org_unit_type, path: u.org_unit_path } : null,
    capabilities: caps,
    requester_only: !u.is_super_admin && roles.isRequesterOnly(caps),
  };
}

// The compact snapshot stamped onto the session at sign-in.
function sessionSnapshot(row) {
  return { id: row.id, name: row.name, email: row.email, is_super_admin: !!row.is_super_admin, role_id: row.role_id, org_unit_id: row.org_unit_id };
}

module.exports = { userForClient, sessionSnapshot };
