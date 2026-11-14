'use strict';
// Delegated access to App-Owner pages. The App Owner can open a small set of
// owner pages to chosen roles and/or named people. Grants are stored in the
// settings table (key `owner_page_access`) as { pageKey: { roles: [slug], users: [id] } }.
//
// Never delegable: Backup & cleanup (full snapshots with password hashes and
// secrets, restore and permanent deletion) and Owner page access itself, so a
// delegate can never widen their own access.
const db = require('../db/runtime');
const settings = require('./settings');
const { ApiError } = require('../middleware/errorHandler');

const DELEGABLE = {
  'app-overview': { label: 'App overview', path: '/app-overview.html', description: 'Live figures and a tour of how the application works.' },
  dropdowns: { label: 'Dropdowns', path: '/dropdowns.html', description: 'Edit business choice lists such as stations, providers, fuel types and expense categories.' },
  'file-server': { label: 'File Server', path: '/file-server.html', description: 'Choose where uploads are stored, set upload limits and move stored files. Can change storage credentials.' },
  broadcasts: { label: 'Broadcasts', path: '/broadcasts.html', description: 'Send announcements to everyone or a role, in the app, by email and by SMS.' },
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

// Keys of delegable pages this user may open (all of them for the App Owner).
async function pagesFor(user) {
  if (!user) return [];
  if (user.is_super_admin) return Object.keys(DELEGABLE);
  const all = await grants();
  const row = await db.get('SELECT r.slug FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.active = 1', [user.id]);
  if (!row) return [];
  return Object.keys(DELEGABLE).filter((key) => (row.slug && all[key].roles.includes(row.slug)) || all[key].users.includes(Number(user.id)));
}
async function can(user, key) { return !!user && (user.is_super_admin || (Object.hasOwn(DELEGABLE, key) && (await pagesFor(user)).includes(key))); }

// Express guard for an owner page's API. The App Owner always passes.
function requirePage(key) {
  if (!Object.hasOwn(DELEGABLE, key)) throw new Error(`Unknown delegable page: ${key}`);
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
      if (await can(req.session.user, key)) return next();
      return res.status(403).json({ error: 'App Owner access only.' });
    } catch (err) { return next(err); }
  };
}

// Roles granted a page, for the navigation editor's per-role defaults.
async function pagesForRole(slug) { const all = await grants(); return Object.keys(DELEGABLE).filter((key) => all[key].roles.includes(slug)); }

// Owner view: every delegable page with its grants, people resolved to names.
async function overview() {
  const all = await grants();
  const ids = [...new Set(Object.values(all).flatMap((g) => g.users))];
  const people = ids.length ? await db.all(`SELECT id, name, email, active FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  const byId = new Map(people.map((p) => [Number(p.id), p]));
  const roles = await db.all('SELECT slug, name FROM roles ORDER BY name');
  return {
    pages: Object.entries(DELEGABLE).map(([key, meta]) => ({ key, ...meta, roles: all[key].roles,
      users: all[key].users.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id).name, email: byId.get(id).email, active: !!byId.get(id).active })) })),
    roles: roles.map((r) => ({ slug: r.slug, name: require('./roles').LABELS[r.slug] || r.name })),
  };
}

async function save(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.pages || typeof input.pages !== 'object' || Array.isArray(input.pages)) throw bad('Provide page access settings.');
  const unknown = Object.keys(input.pages).filter((key) => !Object.hasOwn(DELEGABLE, key));
  if (unknown.length) throw bad('Only App overview, Dropdowns, File Server and Broadcasts can be shared.');
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
      const found = await db.all(`SELECT id, is_super_admin FROM users WHERE id IN (${users.map(() => '?').join(',')}) AND deleted_at IS NULL`, users);
      if (found.length !== users.length) throw bad(`Some people chosen for ${DELEGABLE[key].label} no longer exist.`);
    }
    next[key] = { roles: roles.sort(), users: users.sort((a, b) => a - b) };
  }
  const before = await grants();
  await settings.set(KEY, JSON.stringify(next));
  return { before, after: next };
}

module.exports = { DELEGABLE, grants, pagesFor, pagesForRole, can, requirePage, overview, save };
