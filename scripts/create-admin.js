'use strict';
// Create (or promote) a break-glass super-admin "App Owner" account, plus the
// RBAC roles + capabilities. NO demo data (no departments, org tree, vehicles or
// trips) — safe to run in production.
//
// Runs against the app's configured database (DATABASE_URL / DB_RUNTIME). In the
// Prodmate shell:
//   ADMIN_EMAIL=you@knust.edu.gh ADMIN_NAME="App Owner" ADMIN_PASSWORD='Str0ngPass!' npm run create-admin
//
// - ADMIN_EMAIL is required (this is also the sign-in username).
// - ADMIN_NAME defaults to "App Owner".
// - ADMIN_PASSWORD is optional; if omitted a strong random password is generated
//   and printed once. Change it in the app after signing in.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const db = require('../src/db/runtime');
const capabilities = require('../src/services/capabilities');
const { hashPassword } = require('../src/util/password');

const ROLE_META = {
  staff: ['Staff', 'Can create and track their own vehicle requests.'],
  approver: ['Approver', 'Reviews and approves or rejects vehicle requests.'],
  transport_admin: ['Transport / Admin Officer', 'Assigns vehicles and drivers, runs trips.'],
  supervisor: ['Supervisor', 'Manages users and operations within their organisational unit and its sub-units.'],
  administrator: ['System Administrator', 'Full system access.'],
  driver: ['Driver', 'Views and operates their own assigned trips.'],
};

// Ensure the RBAC roles and their default capabilities exist (idempotent).
async function ensureRoles() {
  const ids = {};
  for (const [slug, [name, description]] of Object.entries(ROLE_META)) {
    const existing = await db.get('SELECT id FROM roles WHERE slug = ?', [slug]);
    if (existing) {
      await db.run(`UPDATE roles SET name = ?, description = ?, updated_at = ${db.now()} WHERE id = ?`, [name, description, existing.id]);
      ids[slug] = existing.id;
    } else {
      const r = await db.run(`INSERT INTO roles (slug, name, description, created_at, updated_at) VALUES (?, ?, ?, ${db.now()}, ${db.now()})`, [slug, name, description]);
      ids[slug] = r.lastInsertRowid;
    }
  }
  for (const [slug, caps] of Object.entries(capabilities.defaultsByRole())) {
    const roleId = ids[slug];
    if (!roleId) continue;
    for (const cap of caps) {
      const has = await db.get('SELECT id FROM role_capabilities WHERE role_id = ? AND capability = ?', [roleId, cap]);
      if (!has) await db.run(`INSERT INTO role_capabilities (role_id, capability, created_at, updated_at) VALUES (?, ?, ${db.now()}, ${db.now()})`, [roleId, cap]);
    }
  }
  return ids;
}

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.error('ERROR: set ADMIN_EMAIL, e.g.  ADMIN_EMAIL=you@knust.edu.gh npm run create-admin');
    process.exit(1);
  }
  const name = (process.env.ADMIN_NAME || 'App Owner').trim();
  let password = process.env.ADMIN_PASSWORD;
  const generated = !password;
  if (generated) password = crypto.randomBytes(12).toString('base64url');

  console.log('[create-admin] runtime =', db.mode());
  await db.ensureSchema();
  const roleIds = await ensureRoles();
  const pw = hashPassword(password);

  const existing = await db.get('SELECT id FROM users WHERE lower(email) = ?', [email]);
  if (existing) {
    await db.run(
      `UPDATE users SET name = ?, password_hash = ?, role_id = ?, is_super_admin = 1, active = 1, deleted_at = NULL, updated_at = ${db.now()} WHERE id = ?`,
      [name, pw, roleIds.administrator, existing.id]
    );
    console.log(`[create-admin] promoted existing account to super-admin App Owner: ${email}`);
  } else {
    await db.run(
      `INSERT INTO users (name, email, password_hash, role_id, is_super_admin, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ${db.now()}, ${db.now()})`,
      [name, email, pw, roleIds.administrator]
    );
    console.log(`[create-admin] created super-admin App Owner: ${email}`);
  }

  console.log('----------------------------------------------------------');
  console.log(`  Sign in with:  ${email}`);
  if (generated) console.log(`  Password (shown once, save it now):  ${password}`);
  else console.log('  Password: the ADMIN_PASSWORD you provided.');
  console.log('  Change the password in the app after signing in.');
  console.log('----------------------------------------------------------');
}

main().then(() => process.exit(0)).catch((err) => { console.error('[create-admin] failed:', err.message); process.exit(1); });
