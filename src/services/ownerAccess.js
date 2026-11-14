'use strict';
// Shared access to restricted pages ("Owner page access"). The App Owner can open
// selected pages to chosen roles and/or named people. Grants are stored in the
// settings table (key `owner_page_access`) as { pageKey: { roles: [slug], users: [id] } }.
//
// Every System page is App Owner only unless explicitly shared.
const db = require('../db/runtime');
const settings = require('./settings');
const { ApiError } = require('../middleware/errorHandler');

const owner = (label, path, description, warning = null) => ({ group: 'owner', label, path, description, warning });
const system = (label, path, description, warning = null) => ({ group: 'system', label, path, description, warning });
const DELEGABLE = {
  'owner-access': owner('Owner page access', '/owner-access.html', 'Manage which roles and people can open System pages.', 'Can widen access to every System page, including their own access.'),
  'backup-cleanup': owner('Backup & cleanup', '/backup-cleanup.html', 'Download and restore database snapshots and clean up data.', 'Snapshots include password hashes and secrets; restore and cleanup permanently change data.'),
  'app-overview': owner('App overview', '/app-overview.html', 'Live figures and a tour of how the application works.'),
  dropdowns: owner('Dropdowns', '/dropdowns.html', 'Edit business choice lists such as stations, providers, fuel types and expense categories.'),
  'file-server': owner('File Server', '/file-server.html', 'Choose where uploads are stored, set upload limits and move stored files.', 'Can change the storage location and its credentials.'),
  broadcasts: owner('Broadcasts', '/broadcasts.html', 'Send announcements to everyone or a role, in the app, by email and by SMS.', 'Can message every user.'),
  'app-health': system('App Health', '/app-health.html', 'Server starts, sign-in trends and database health checks.'),
  rbac: system('RBAC', '/rbac.html', 'Create roles and choose the capabilities each role holds.', 'Can give any role — including their own — System Administrator access.'),
  'system-controls': system('System controls', '/system-controls.html', 'Feature switches, notification channels and operational settings.', 'Changes apply to every user.'),
  'directory-auth': system('Directory authentication', '/directory-auth.html', 'Sign-in directories (LDAP/AD), their order and connection settings.', 'Can change how people sign in and the directory bind credentials.'),
  'maps-config': system('Maps configuration', '/maps-config.html', 'Map key, default centre and zoom for the live map.'),
  sms: system('SMS', '/sms.html', 'SMS provider connection, message templates and test messages.', 'Can change the SMS provider credentials.'),
  email: system('Email', '/email.html', 'Email connection, message templates and test emails.', 'Can change the email connection credentials.'),
  database: system('Database connections', '/database-connections.html', 'Database connection profiles and copying the data store to PostgreSQL.', 'Can copy the entire database to another server.'),
  'unified-api': system('Unified API', '/unified-api.html', 'Staff directory connection, field settings and read-API tokens.', 'Can create read-API tokens that give other systems access to data.'),
  'report-config': system('Report configuration', '/report-configuration.html', 'Report layouts and the details printed on exports.'),
  navigation: system('Navigation menu', '/navigation-settings.html', 'Menu sections, order, labels and visibility for each role.'),
  documentation: system('Documentation', '/documentation.html', 'Technical overview, user guide and security assessment.'),
  'codebase-guide': system('Codebase guide', '/codebase-guide.html', 'A module-by-module tour of the code.'),
};
const KEY = 'owner_page_access';
const MAX_PEOPLE = 200;
const bad = (message) => new ApiError(422, message);

function normalise(raw) {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { value = {}; } }
  const out = {};
  for (const key of Object.keys(DELEGABLE)) {
    const g = value && typeof value === 'object' ? value[key] : null;
    out[key] = {
      roles: Array.isArray(g?.roles) ? [...new Set(g.roles.filter((s) => typeof s === 'string'))] : [],
      users: Array.isArray(g?.users) ? [...new Set(g.users.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))] : [],
    };
  }
  return out;
}

async function grants() { return normalise(await settings.get(KEY, {})); }

// Keys of pages shared with this user through a grant (every page for the App Owner).
// All other users require an explicit grant.
async function pagesFor(user) {
  if (!user) return [];
  if (user.is_super_admin) return Object.keys(DELEGABLE);
  const all = await grants();
  const row = await db.get('SELECT r.slug FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.active = 1', [user.id]);
  if (!row) return [];
  return Object.keys(DELEGABLE).filter((key) => (row.slug && all[key].roles.includes(row.slug)) || all[key].users.includes(Number(user.id)));
}
async function can(user, key) {
  if (!user || !Object.hasOwn(DELEGABLE, key)) return !!user?.is_super_admin;
  if (user.is_super_admin) return true;
  return (await pagesFor(user)).includes(key);
}

const deny = (res) => res.status(403).json({ error: 'App Owner access only.' });
// Express guard for a shareable page's API.
function requirePage(key) {
  if (!Object.hasOwn(DELEGABLE, key)) throw new Error(`Unknown shareable page: ${key}`);
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
      return (await can(req.session.user, key)) ? next() : deny(res, key);
    } catch (err) { return next(err); }
  };
}
// Messaging routes are shared by the SMS and Email pages (/admin/messaging/:channel/...).
async function requireChannelPage(req, res, next) {
  try {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const key = ['sms', 'email'].includes(req.params.channel) ? req.params.channel : null;
    const ok = key ? await can(req.session.user, key) : !!req.session.user.is_super_admin;
    return ok ? next() : deny(res, 'sms');
  } catch (err) { return next(err); }
}

// Pages shared with a role, for the navigation editor's per-role defaults.
async function pagesForRole(slug) { const all = await grants(); return Object.keys(DELEGABLE).filter((key) => all[key].roles.includes(slug)); }

// Owner view: every shareable page with its grants, people resolved to names, and
// their current grants.
async function overview() {
  const all = await grants();
  const ids = [...new Set(Object.values(all).flatMap((g) => g.users))];
  const people = ids.length ? await db.all(`SELECT u.id, u.name, u.email, u.active, r.slug AS role_slug FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  const byId = new Map(people.map((p) => [Number(p.id), p]));
  const roles = await db.all("SELECT r.slug, r.name, EXISTS (SELECT 1 FROM role_capabilities c WHERE c.role_id = r.id AND c.capability = 'system.admin') AS system_admin FROM roles r ORDER BY r.name");
  return {
    pages: Object.entries(DELEGABLE).map(([key, meta]) => ({ key, ...meta, roles: all[key].roles,
      users: all[key].users.filter((id) => byId.has(id)).map((id) => { const p = byId.get(id); return { id, name: p.name, email: p.email, active: !!p.active, role_slug: p.role_slug || null }; }) })),
    roles: roles.map((r) => ({ slug: r.slug, name: require('./roles').LABELS[r.slug] || r.name, system_admin: !!Number(r.system_admin) })),
  };
}

async function save(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.pages || typeof input.pages !== 'object' || Array.isArray(input.pages)) throw bad('Provide page access settings.');
  const unknown = Object.keys(input.pages).filter((key) => !Object.hasOwn(DELEGABLE, key));
  if (unknown.length) throw bad('Choose from the listed pages.');
  const roleSlugs = new Set((await db.all('SELECT slug FROM roles')).map((r) => r.slug));
  const next = {};
  for (const key of Object.keys(DELEGABLE)) {
    const g = input.pages[key] || { roles: [], users: [] };
    if (!Array.isArray(g.roles) || !Array.isArray(g.users)) throw bad(`Choose roles and people for ${DELEGABLE[key].label}.`);
    const roles = [...new Set(g.roles)];
    if (roles.some((s) => typeof s !== 'string' || !roleSlugs.has(s))) throw bad(`Choose valid roles for ${DELEGABLE[key].label}.`);
    const users = [...new Set(g.users.map(Number))];
    if (users.length > MAX_PEOPLE || users.some((n) => !Number.isSafeInteger(n) || n < 1)) throw bad(`Choose up to ${MAX_PEOPLE} people for ${DELEGABLE[key].label}.`);
    if (users.length) {
      const found = await db.all(`SELECT id FROM users WHERE id IN (${users.map(() => '?').join(',')}) AND deleted_at IS NULL`, users);
      if (found.length !== users.length) throw bad(`Some people chosen for ${DELEGABLE[key].label} no longer exist.`);
    }
    next[key] = { roles: roles.sort(), users: users.sort((a, b) => a - b) };
  }
  const before = await grants();
  await settings.set(KEY, JSON.stringify(next));
  return { before, after: next };
}

module.exports = { DELEGABLE, grants, pagesFor, pagesForRole, can, requirePage, requireChannelPage, overview, save };
