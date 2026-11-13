'use strict';

// LDAP / Active Directory sign-in against one or more directories. Each
// directory is a saved entry (stored as a JSON list in the system setting
// `directory_auth_profiles`). At sign-in the enabled entries are tried in
// order: a service account finds the person, then their own DN binds with the
// password they typed, so the app never stores directory passwords. New
// accounts are provisioned with NO role and NO org unit (password_hash NULL) —
// an administrator assigns a role/unit in Users before they can do anything.
// Every attempt is recorded in audit_logs (directory.login_success /
// login_failure / error / test), the detail prefixed with "[directory name]",
// for the Activity tab.
//
// TLS: each entry carries `tls_verify` (certificate verification, on by default)
// and an optional `tls_ca` (the university's CA in PEM). Turning verification
// off, or pasting the CA, is what lets a self-signed / internal-CA domain
// controller (the usual cause of a BindRequest ECONNRESET) connect over LDAPS.
const crypto = require('crypto');
const db = require('./db_ref');
const settings = require('./settings');
const audit = require('./audit');
const log = require('../util/log');
const { hashPassword, verifyPassword } = require('../util/password');

const STORE_KEY = 'directory_auth_profiles';
const OFFLINE_DAYS_KEY = 'directory_auth_offline_days';
const OFFLINE_DAYS_DEFAULT = 7;
const OFFLINE_DAYS_MAX = 30;
const TIMEOUT_MS = 8000;
const DAY_MS = 86_400_000;

const TEXT_FIELDS = ['name', 'provider', 'url', 'base_dn', 'bind_dn', 'user_filter', 'username_attribute', 'email_attribute', 'display_name_attribute', 'group_base_dn', 'required_group_dn', 'tls_ca'];
const FLAG_FIELDS = ['enabled', 'start_tls', 'tls_verify'];

// ---- Stored entries ---------------------------------------------------------

// One stored entry with defaults filled in.
function normalise(p = {}) {
  const text = (k) => String(p[k] || '').trim();
  return {
    id: p.id, name: text('name') || 'Directory', enabled: Boolean(p.enabled),
    provider: p.provider === 'ACTIVE_DIRECTORY' ? 'ACTIVE_DIRECTORY' : 'LDAP',
    url: text('url'), base_dn: text('base_dn'), bind_dn: text('bind_dn'), bind_secret: String(p.bind_secret || ''),
    user_filter: text('user_filter') || '(sAMAccountName={{username}})',
    username_attribute: text('username_attribute') || 'sAMAccountName',
    email_attribute: text('email_attribute') || 'mail',
    display_name_attribute: text('display_name_attribute') || 'displayName',
    group_base_dn: text('group_base_dn'), required_group_dn: text('required_group_dn'),
    start_tls: Boolean(p.start_tls),
    // Certificate checks are on unless explicitly turned off.
    tls_ca: text('tls_ca'), tls_verify: p.tls_verify !== false,
    created_at: p.created_at || null, updated_at: p.updated_at || null,
  };
}
const ready = (c) => Boolean(c && c.enabled && c.url && c.base_dn);

// Fold any pre-list ldap_*/ad_* settings into one entry, so a directory
// configured before this version keeps working.
async function legacyEntry() {
  const g = async (k, d = '') => (await settings.get(k, d)) || d;
  const provider = (await settings.get('directory_provider', 'ldap')) === 'active_directory' ? 'ad' : 'ldap';
  const enabled = !!(await settings.get('directory_enabled', false));
  if (provider === 'ad') {
    const host = await g('ad_host'); if (!host) return null;
    const ssl = !!(await settings.get('ad_use_ssl', false));
    const port = (await g('ad_port')) || (ssl ? '636' : '389');
    return {
      id: crypto.randomUUID(), name: 'Active Directory', enabled, provider: 'ACTIVE_DIRECTORY',
      url: `${ssl ? 'ldaps' : 'ldap'}://${host}:${port}`, base_dn: await g('ad_base_dn'),
      bind_dn: await g('ad_bind_account'), bind_secret: await g('ad_bind_password'),
      user_filter: ((await g('ad_user_filter')) || '(sAMAccountName=%s)').replace(/%s|\{username\}/g, '{{username}}'),
      username_attribute: (await g('ad_attr_username')) || 'sAMAccountName',
      email_attribute: (await g('ad_attr_email')) || 'mail',
      display_name_attribute: (await g('ad_attr_name')) || 'displayName',
      required_group_dn: await g('ad_required_group_dn'),
      start_tls: false, tls_verify: true, tls_ca: '',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
  }
  const host = await g('ldap_host'); if (!host) return null;
  const enc = await g('ldap_encryption', 'none');
  const port = (await g('ldap_port')) || (enc === 'ssl' ? '636' : '389');
  return {
    id: crypto.randomUUID(), name: 'LDAP directory', enabled, provider: 'LDAP',
    url: `${enc === 'ssl' ? 'ldaps' : 'ldap'}://${host}:${port}`, base_dn: await g('ldap_base_dn'),
    bind_dn: await g('ldap_bind_dn'), bind_secret: await g('ldap_bind_password'),
    user_filter: ((await g('ldap_user_filter')) || '(uid=%s)').replace(/%s|\{username\}/g, '{{username}}'),
    username_attribute: (await g('ldap_attr_username')) || 'uid',
    email_attribute: (await g('ldap_attr_email')) || 'mail',
    display_name_attribute: (await g('ldap_attr_name')) || 'cn',
    group_base_dn: await g('ldap_group_base_dn'), required_group_dn: await g('ldap_required_group_dn'),
    start_tls: enc === 'starttls', tls_verify: true, tls_ca: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

async function load() {
  const raw = await settings.get(STORE_KEY, '');
  if (raw) {
    try { const list = typeof raw === 'string' ? JSON.parse(raw) : raw; if (Array.isArray(list)) return list; } catch (_) { /* rebuilt below */ }
  }
  const legacy = await legacyEntry();
  const list = legacy ? [legacy] : [];
  if (legacy) await store(list);
  return list;
}
async function store(list) { await settings.set(STORE_KEY, JSON.stringify(list)); }

// Entries for sign-in and tests, in order, with defaults.
async function directories() { return (await load()).map(normalise); }
async function anyEnabled() { return (await directories()).some(ready); }
async function isEnabled() { return anyEnabled(); }
// Back-compat: the provider string ('ldap' | 'ad') of the first enabled entry,
// used when importing a directory person as a staff account.
async function activeProvider() {
  const first = (await directories()).find(ready) || (await directories())[0];
  return first && first.provider === 'ACTIVE_DIRECTORY' ? 'ad' : 'ldap';
}

// What the browser sees: everything except the bind password.
function publicView(p) {
  const { bind_secret: secret, ...rest } = normalise(p);
  return { ...rest, bind_secret_configured: Boolean(secret) };
}
async function list() { return (await load()).map(publicView); }

class ValidationError extends Error { constructor(message) { super(message); this.status = 400; } }

// Check an incoming entry (already merged over the stored one when editing).
function validate(entry, all) {
  const e = normalise(entry);
  if (!String(entry.name || '').trim()) throw new ValidationError('Give the directory a name, for example "Staff Active Directory".');
  if (all.some((other) => other.id !== entry.id && String(other.name || '').trim().toLowerCase() === e.name.toLowerCase())) throw new ValidationError(`A directory called "${e.name}" already exists.`);
  if (e.url && !/^ldaps?:\/\/[^\s/]+/i.test(e.url)) throw new ValidationError('The server URL must start with ldap:// or ldaps://');
  if (e.enabled && (!e.url || !e.base_dn)) throw new ValidationError('Enter the server URL and base DN before enabling this directory.');
  if (entry.provider !== undefined && !['LDAP', 'ACTIVE_DIRECTORY'].includes(entry.provider)) throw new ValidationError('Unknown directory provider.');
  if (!e.user_filter.includes('{{username}}')) throw new ValidationError('The user search filter must contain {{username}}.');
  if (e.tls_ca && !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(e.tls_ca)) throw new ValidationError('The trusted CA certificate must be in PEM format (-----BEGIN CERTIFICATE----- ...).');
}

// Copy only known fields from a request body. A blank bind password keeps the
// stored one.
function pick(body = {}, previous = {}) {
  const out = { ...previous };
  TEXT_FIELDS.forEach((k) => { if (body[k] !== undefined) out[k] = String(body[k] || '').trim(); });
  FLAG_FIELDS.forEach((k) => { if (body[k] !== undefined) out[k] = Boolean(body[k]); });
  if (body.bind_secret) out.bind_secret = String(body.bind_secret);
  return out;
}

async function create(body) {
  const all = await load();
  const entry = { ...pick(body, { tls_verify: true }), id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  validate(entry, all);
  all.push(entry);
  await store(all);
  return publicView(entry);
}
async function update(id, body) {
  const all = await load();
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const entry = { ...pick(body, all[index]), id, updated_at: new Date().toISOString() };
  validate(entry, all);
  all[index] = entry;
  await store(all);
  return publicView(entry);
}
async function remove(id) {
  const all = await load();
  const entry = all.find((p) => p.id === id);
  if (!entry) return null;
  await store(all.filter((p) => p.id !== id));
  return publicView(entry);
}
async function reorder(ids = []) {
  const all = await load();
  const rank = new Map(ids.map((id, i) => [id, i]));
  all.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
  await store(all);
  return all.map(publicView);
}

// ---- LDAP plumbing ----------------------------------------------------------

// RFC 4515 escaping for values placed inside a search filter.
const escapeFilter = (value) => String(value).replace(/[\\*()\0]/g, (ch) => `\\${ch.charCodeAt(0).toString(16).padStart(2, '0')}`);

// "KNUST\jdoe" and "jdoe@knust.edu.gh" both mean jdoe.
function normaliseUsername(input) {
  let name = String(input || '').trim();
  if (name.includes('\\')) name = name.slice(name.lastIndexOf('\\') + 1);
  if (name.includes('@')) name = name.slice(0, name.indexOf('@'));
  return name;
}

class DirectoryError extends Error {
  // kind: credentials | denied | unavailable | config. `step` says where it failed.
  constructor(message, kind, step) { super(message); this.kind = kind; this.step = step; }
}

function hostOf(url) { try { const u = new URL(url); return `${u.hostname}:${u.port || (u.protocol === 'ldaps:' ? 636 : 389)}`; } catch (_) { return url; } }

// The certificate controls that make a self-signed / internal-CA DC reachable.
function tlsOptions(c) {
  const options = { minVersion: 'TLSv1.2', rejectUnauthorized: c.tls_verify };
  if (c.tls_ca) options.ca = c.tls_ca;
  return options;
}

async function withClient(c, fn) {
  const { Client } = require('ldapts');
  const client = new Client({ url: c.url, timeout: TIMEOUT_MS, connectTimeout: TIMEOUT_MS, tlsOptions: tlsOptions(c) });
  try {
    if (c.start_tls) await client.startTLS(tlsOptions(c));
    return await fn(client);
  } finally {
    try { await client.unbind(); } catch (_) { /* already closed */ }
  }
}

// Active Directory adds a sub-code to "invalid credentials" (e.g. "data 775").
const AD_CODES = {
  525: 'the account was not found', '52e': 'the password is wrong', 530: 'the account may not sign in at this time',
  531: 'the account may not sign in from this computer', 532: 'the password has expired', 533: 'the account is disabled',
  701: 'the account has expired', 773: 'the password must be changed before signing in', 775: 'the account is locked',
};
const adCode = (error) => { const m = /data ([0-9a-f]{3})/i.exec((error && error.message) || ''); return m ? m[1].toLowerCase() : null; };

const NETWORK = {
  ECONNREFUSED: (h) => `The server at ${h} refused the connection. Nothing is accepting directory connections there: check the address and port (636 for ldaps://, 389 for ldap://).`,
  ETIMEDOUT: (h) => `No response from ${h} within ${TIMEOUT_MS / 1000} s. A firewall may be blocking this app's server, or the address is wrong.`,
  ENOTFOUND: (h) => `The host name in ${h} could not be found from this app's server. Check the server URL.`,
  EAI_AGAIN: (h) => `The host name in ${h} could not be looked up right now (DNS). Try again or use another address.`,
  EHOSTUNREACH: (h) => `${h} cannot be reached from this app's server (no route). It may be on a network the server cannot see.`,
  ENETUNREACH: (h) => `${h} cannot be reached from this app's server (network unreachable).`,
  ECONNRESET: (h) => `${h} closed the connection. Check that ldap:// / ldaps:// matches the port, and — for a self-signed or internal-CA certificate on LDAPS — paste the CA under "Trusted CA certificate" or turn off certificate verification.`,
};
const UNTRUSTED = ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_UNTRUSTED'];

// Turn a raw LDAP / network / TLS error into a DirectoryError with a plain
// explanation. `stage` is what was being attempted: connect, service, base,
// search, group or user.
function explain(error, c, stage) {
  if (error instanceof DirectoryError) return error;
  const h = hostOf(c.url);
  const code = error && error.code;
  const name = (error && error.name) || '';
  const message = (error && error.message) || '';
  if (NETWORK[code]) return new DirectoryError(NETWORK[code](h), 'unavailable', 'connect');
  if (/timeout|timed out/i.test(message) || /Timeout/.test(name)) return new DirectoryError(NETWORK.ETIMEDOUT(h), 'unavailable', 'connect');
  if (UNTRUSTED.includes(code)) return new DirectoryError(`The certificate presented by ${h} is not trusted by this app's server. Paste the university's CA certificate under "Trusted CA certificate", or turn off certificate verification while testing.`, 'unavailable', 'connect');
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return new DirectoryError(`The certificate on ${h} was issued for a different name. Use the host name on the certificate (for example dc01.knust.edu.gh) in the server URL instead of an IP address.`, 'unavailable', 'connect');
  if (code === 'CERT_HAS_EXPIRED') return new DirectoryError(`The certificate on ${h} has expired.`, 'unavailable', 'connect');
  if (code && /^(ERR_SSL|ERR_TLS|EPROTO)/.test(code)) return new DirectoryError(`A secure connection to ${h} could not be set up (${code}). Check ldaps:// versus StartTLS.`, 'unavailable', 'connect');
  if (name === 'InvalidCredentialsError') {
    const sub = adCode(error);
    if (stage === 'service') return new DirectoryError(`The service account (bind DN) was rejected${sub && AD_CODES[sub] ? `: ${AD_CODES[sub]}` : '. Check the bind DN and password'}.`, 'config', 'service');
    if (sub && !['52e', '525'].includes(sub)) return new DirectoryError(`Sign-in refused: ${AD_CODES[sub] || `directory code ${sub}`}.`, 'denied', 'user');
    return new DirectoryError('Invalid username or password', 'credentials', 'user');
  }
  if (name === 'NoSuchObjectError') return new DirectoryError(`Not found in the directory: check the ${stage === 'group' ? 'required group DN' : 'base DN'}.`, 'config', stage);
  if (name === 'InsufficientAccessError') return new DirectoryError('The service account is not allowed to search the directory.', 'config', stage);
  if (name === 'ConfidentialityRequiredError' || name === 'StrongAuthRequiredError') return new DirectoryError('The server requires a secure connection. Use ldaps:// or turn on StartTLS.', 'config', stage);
  if (name === 'OperationsError' && /bind/i.test(message)) return new DirectoryError('The server does not allow anonymous searches. Enter a bind DN and password for a service account.', 'config', stage);
  if (/filter/i.test(name) || /filter/i.test(message)) return new DirectoryError(`The user search filter is not valid: ${message}`, 'config', stage);
  return new DirectoryError(`Directory error during ${stage}: ${code || name || message || 'unknown error'}`, 'unavailable', stage);
}

const first = (value) => (Array.isArray(value) ? value[0] : value);
const STEP_LABEL = { connect: 'Connect to the server', service: 'Sign in with the service account', base: 'Read the base DN', search: 'Find the person', group: 'Check the required group', user: "Check the person's password" };

// The full check against one directory, step by step. `onStep(step, ok, detail)`
// reports progress. Without a username it stops after the service account and
// base DN checks.
async function walk(c, { username, password } = {}, onStep = () => {}) {
  let stage = 'connect';
  try {
    return await withClient(c, async (client) => {
      stage = 'service';
      await client.bind(c.bind_dn, c.bind_secret);
      onStep('connect', true, hostOf(c.url));
      onStep('service', true, c.bind_dn || 'anonymous');
      if (!username) {
        stage = 'base';
        await client.search(c.base_dn, { scope: 'base', filter: '(objectClass=*)', attributes: ['dn'] });
        onStep('base', true, c.base_dn);
        return null;
      }
      stage = 'search';
      let filter = c.user_filter.split('{{username}}').join(escapeFilter(username));
      if (!filter.startsWith('(')) filter = `(${filter})`;
      const { searchEntries } = await client.search(c.base_dn, { scope: 'sub', filter, sizeLimit: 2, attributes: ['dn', c.username_attribute, c.email_attribute, c.display_name_attribute] });
      if (searchEntries.length > 1) throw new DirectoryError(`More than one person matches ${filter}. Make the user search filter more specific.`, 'config', 'search');
      if (!searchEntries.length) throw new DirectoryError('Invalid username or password', 'credentials', 'search');
      const entry = searchEntries[0];
      onStep('search', true, entry.dn);
      if (c.required_group_dn) {
        stage = 'group';
        const nested = c.provider === 'ACTIVE_DIRECTORY';
        const { searchEntries: hits } = nested
          ? await client.search(c.base_dn, { scope: 'sub', filter: `(&${filter}(memberOf:1.2.840.113556.1.4.1941:=${escapeFilter(c.required_group_dn)}))`, sizeLimit: 2, attributes: ['dn'] })
          : await client.search(c.required_group_dn, { scope: 'base', filter: `(|(member=${escapeFilter(entry.dn)})(uniqueMember=${escapeFilter(entry.dn)})(memberUid=${escapeFilter(username)}))`, attributes: ['dn'] });
        if (!hits.length) throw new DirectoryError('Not a member of the required directory group', 'denied', 'group');
        onStep('group', true, c.required_group_dn);
      }
      // The person's own bind proves the password. An empty password would be
      // an anonymous bind on many servers, so it is refused before this point.
      stage = 'user';
      if (!password) throw new DirectoryError('Invalid username or password', 'credentials', 'user');
      await client.bind(entry.dn, password);
      onStep('user', true, 'Password accepted');
      const canonical = String(first(entry[c.username_attribute]) || username).trim().toLowerCase();
      return { username: canonical, full_name: String(first(entry[c.display_name_attribute]) || canonical).trim(), email: String(first(entry[c.email_attribute]) || '').trim(), dn: entry.dn };
    });
  } catch (error) {
    const e = explain(error, c, stage);
    if ((e.step || stage) !== 'connect' && stage === 'service') onStep('connect', true, hostOf(c.url));
    onStep(e.step || stage, false, e.message);
    throw e;
  }
}

// ---- Audit (Activity tab) ---------------------------------------------------

async function record(action, directory, actorName, detail, startedAt) {
  const prefix = directory ? `[${directory.name}] ` : '';
  try { await audit.record({ actorName: actorName ? String(actorName).slice(0, 120) : null, action, description: `${prefix}${detail} · ${Date.now() - startedAt} ms` }); }
  catch (_) { /* telemetry must not affect sign-in */ }
}

// ---- Provisioning -----------------------------------------------------------

// Create or re-sync the local mirror account for a directory person. New
// accounts get NO role and NO org unit; an existing account keeps whatever an
// administrator assigned. Never shadows the break-glass super admin or an
// existing local (password) account.
async function provision(identity, directory) {
  const provider = directory.provider === 'ACTIVE_DIRECTORY' ? 'ad' : 'ldap';
  const email = (identity.email || `${identity.username}@directory.local`).toLowerCase();
  const name = identity.full_name || identity.username;
  const existing = await db.get('SELECT * FROM users WHERE lower(email) = ?', [email]);
  if (existing) {
    if (existing.is_super_admin) return null;                                   // never shadow break-glass admin
    if (existing.password_hash && !existing.directory_provider) return null;    // a local account owns this email
    await db.run(`UPDATE users SET name = ?, directory_provider = ?, active = 1, deleted_at = NULL, updated_at = ${db.now()} WHERE id = ?`, [name, provider, existing.id]);
    return existing.id;
  }
  const r = await db.run(`INSERT INTO users (name, email, password_hash, role_id, org_unit_id, active, is_super_admin, directory_provider, created_at, updated_at) VALUES (?, ?, NULL, NULL, NULL, 1, 0, ?, ${db.now()}, ${db.now()})`, [name, email, provider]);
  return r.lastInsertRowid;
}

// ---- Saved sign-in while no directory can be reached ------------------------
// After each directory sign-in the password is kept as a bcrypt hash on the
// account, with the id of the directory that accepted it. While that directory
// is enabled but unreachable, the hash is accepted for `offline_days` days
// after the last directory sign-in (0 turns this off).

async function offlineDays() {
  const raw = await settings.get(OFFLINE_DAYS_KEY, '');
  const n = raw === '' || raw === null || raw === undefined ? OFFLINE_DAYS_DEFAULT : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= OFFLINE_DAYS_MAX ? n : OFFLINE_DAYS_DEFAULT;
}
async function setOfflineDays(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > OFFLINE_DAYS_MAX) throw new ValidationError(`Choose between 0 and ${OFFLINE_DAYS_MAX} days.`);
  await settings.set(OFFLINE_DAYS_KEY, String(n));
  if (n === 0) await db.run('UPDATE users SET directory_cache_hash = NULL, directory_cache_at = NULL, directory_cache_source = NULL WHERE directory_cache_hash IS NOT NULL');
  return n;
}
async function saveCache(userId, password, directoryId) {
  if (!(await offlineDays())) return clearCache(userId);
  return db.run('UPDATE users SET directory_cache_hash = ?, directory_cache_at = ?, directory_cache_source = ? WHERE id = ?', [hashPassword(password), Date.now(), String(directoryId), Number(userId)]);
}
async function clearCache(userId) {
  return db.run('UPDATE users SET directory_cache_hash = NULL, directory_cache_at = NULL, directory_cache_source = NULL WHERE id = ?', [Number(userId)]);
}
// Find a directory account by the typed username (matched against the local
// part of its email), so a wrong/old password clears or is checked offline.
async function findDirectoryUserByUsername(username) {
  const u = String(username || '').toLowerCase();
  if (!u) return null;
  const rows = await db.all("SELECT id, name, email, active, directory_cache_hash, directory_cache_at, directory_cache_source FROM users WHERE directory_provider IS NOT NULL AND deleted_at IS NULL");
  return rows.find((r) => {
    const addr = String(r.email || '').toLowerCase();
    return addr === u || addr.split('@')[0] === u || addr === `${u}@directory.local`;
  }) || null;
}

// Accept the saved password while every directory that might know the person is
// unreachable. Returns a user id or null.
async function offlineSignIn(username, password, unreachable, startedAt) {
  const days = await offlineDays();
  if (!days || !password || !unreachable.length) return null;
  const user = await findDirectoryUserByUsername(username);
  if (!user || !user.directory_cache_hash) return null;
  if (!unreachable.includes(user.directory_cache_source)) return null;
  if (Date.now() - (Number(user.directory_cache_at) || 0) > days * DAY_MS) return null;
  if (!user.active) { await record('directory.login_failure', null, username, 'Saved sign-in: account is deactivated in the app', startedAt); return null; }
  if (!verifyPassword(password, user.directory_cache_hash)) { await record('directory.login_failure', null, username, 'Saved sign-in: wrong password (no directory reachable)', startedAt); return null; }
  await record('directory.login_success', null, username, 'Saved sign-in: no directory reachable, accepted the last-checked password', startedAt);
  return user.id;
}

// ---- Sign in (called by the login route) ------------------------------------
// Returns the local user id on success, or null. Tries each enabled directory
// in order; a directory that does not know the person passes to the next, one
// that refuses the password decides, and if every directory is unreachable the
// saved password is accepted within its window.
async function authenticate(identifier, password) {
  const dirs = (await directories()).filter(ready);
  if (!dirs.length || !password) return null;
  const username = normaliseUsername(identifier);
  if (!username) return null;
  const startedAt = Date.now();
  const unreachable = [];
  for (const c of dirs) {
    const t = Date.now();
    try {
      const identity = await walk(c, { username, password });
      const id = await provision(identity, c);
      if (!id) { await record('directory.login_failure', c, identity.username, 'Username belongs to a local or protected account', t); return null; }
      try { await saveCache(id, password, c.id); } catch (_) { /* sign-in still succeeds */ }
      await record('directory.login_success', c, identity.username, 'Signed in', t);
      return id;
    } catch (error) {
      const e = error instanceof DirectoryError ? error : explain(error, c, 'user');
      if (e.kind === 'unavailable' || e.kind === 'config') { unreachable.push(c.id); await record('directory.error', c, username, e.message, t); continue; }
      if (e.step === 'search') continue;                                        // not in this directory
      await record('directory.login_failure', c, username, e.message, t);       // known person, refused
      try { const u = await findDirectoryUserByUsername(username); if (u) await clearCache(u.id); } catch (_) { /* ignore */ }
      return null;
    }
  }
  if (unreachable.length && unreachable.length === dirs.length) {
    const id = await offlineSignIn(username, password, unreachable, startedAt);
    if (id) return id;
  }
  await record('directory.login_failure', null, username, `Not found in ${dirs.length === 1 ? dirs[0].name : `any of ${dirs.length} directories`}`, startedAt);
  return null;
}

// ---- Test one directory -----------------------------------------------------
async function test(id, { username, password } = {}) {
  const startedAt = Date.now();
  const c = (await directories()).find((d) => d.id === id);
  if (!c) return null;
  if (!c.url || !c.base_dn) return { ok: false, error: 'Enter the server URL and base DN first.', steps: [] };
  const steps = [];
  const onStep = (step, ok, detail) => steps.push({ step, label: STEP_LABEL[step] || step, ok, detail });
  const who = normaliseUsername(username);
  try {
    if (who && !password) throw new DirectoryError('Enter the test password too.', 'config', 'user');
    const identity = await walk(c, who ? { username: who, password } : {}, onStep);
    const summary = identity ? `Connection test passed and ${identity.username} can sign in (${c.url})` : `Connection test passed (${c.url})`;
    await record('directory.test', c, who || null, summary, startedAt);
    return { ok: true, ms: Date.now() - startedAt, url: c.url, steps, identity: identity ? { username: identity.username, full_name: identity.full_name, email: identity.email } : null };
  } catch (error) {
    const e = error instanceof DirectoryError ? error : explain(error, c, 'connect');
    if (!steps.some((s) => !s.ok)) onStep(e.step || 'connect', false, e.message);
    await record('directory.test', c, who || null, `Connection test failed: ${e.message}`, startedAt);
    return { ok: false, error: e.message, ms: Date.now() - startedAt, steps };
  }
}

// ---- Looking people up so an admin can add them before they sign in ---------
const SEARCH_LIMIT = 25;
function anyUserFilter(c) {
  let filter = c.user_filter.split('{{username}}').join('*');
  if (!filter.startsWith('(')) filter = `(${filter})`;
  return filter;
}
function groupClause(c) {
  return c.required_group_dn && c.provider === 'ACTIVE_DIRECTORY' ? `(memberOf:1.2.840.113556.1.4.1941:=${escapeFilter(c.required_group_dn)})` : '';
}
function personFrom(c, entry) {
  const username = String(first(entry[c.username_attribute]) || '').trim().toLowerCase();
  if (!username) return null;
  return { username, name: String(first(entry[c.display_name_attribute]) || username).trim(), email: String(first(entry[c.email_attribute]) || '').trim(), dn: entry.dn, directory: c.name, suggested_role: null, suggested_org_unit_id: null };
}

// Search enabled directories for people whose name/username/email contains the
// text. Returns the shape the Users page expects.
async function searchDirectory(query, limit = SEARCH_LIMIT) {
  const enabled = (await directories()).filter(ready);
  const provider = await activeProvider();
  if (!enabled.length) return { enabled: false, provider, results: [] };
  const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 64);
  if (q.length < 2) return { enabled: true, provider, results: [] };
  const like = `*${escapeFilter(q)}*`;
  const people = new Map();
  const errors = [];
  for (const c of enabled) {
    const filter = `(&${anyUserFilter(c)}${groupClause(c)}(|(${c.username_attribute}=${like})(${c.display_name_attribute}=${like})(${c.email_attribute}=${like})))`;
    try {
      await withClient(c, async (client) => {
        await client.bind(c.bind_dn, c.bind_secret);
        const { searchEntries } = await client.search(c.base_dn, { scope: 'sub', filter, sizeLimit: limit, attributes: ['dn', c.username_attribute, c.email_attribute, c.display_name_attribute] });
        searchEntries.map((entry) => personFrom(c, entry)).filter(Boolean).forEach((person) => { if (!people.has(person.username)) people.set(person.username, person); });
      });
    } catch (error) { errors.push(`${c.name}: ${explain(error, c, 'search').message}`); }
  }
  const results = [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  const out = { enabled: true, provider, results };
  if (!results.length && errors.length === enabled.length) out.error = errors.join(' · ');
  return out;
}

// ---- Activity (the Activity tab) --------------------------------------------

// Directory sign-in sessions open right now, read from the session store
// (PostgreSQL app_sessions or SQLite sessions), best-effort.
async function activeDirectorySessions(idSet, byId) {
  const rows = [];
  const parse = (list) => {
    for (const r of list || []) {
      // app_sessions stores expire as epoch ms; the SQLite store as ISO text.
      const expMs = /^\d+$/.test(String(r.expire || '')) ? Number(r.expire) : Date.parse(r.expire);
      if (expMs && expMs < Date.now()) continue;
      let s = null; try { s = JSON.parse(r.sess); } catch (_) { continue; }
      const u = s && s.user; if (!u || !idSet.has(u.id)) continue;
      const info = byId.get(u.id) || {};
      rows.push({ user_id: u.id, name: info.name || u.name, email: info.email || u.email || '', mode: s.mode || 'web', signed_in_at: s.createdAt ? new Date(s.createdAt).toISOString() : null, last_seen_at: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null, awaiting_role: !!info.awaiting_role });
    }
  };
  try {
    if (db.isPostgres()) { parse(await db.all('SELECT sess, expire FROM app_sessions')); }
    else { parse(db.raw.prepare('SELECT sess, expire FROM sessions').all()); }
  } catch (_) { /* no store / unreadable → none */ }
  // Keep only the most recent session per user.
  const latest = new Map();
  for (const r of rows) { const prev = latest.get(r.user_id); if (!prev || String(r.last_seen_at) > String(prev.last_seen_at)) latest.set(r.user_id, r); }
  return [...latest.values()];
}

const ACTIVITY_KIND = { 'directory.login_success': 'success', 'directory.login_failure': 'failure', 'directory.error': 'error' };

async function activity(daysInput) {
  const days = Math.min(Math.max(Number(daysInput) || 7, 1), 90);
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 19).replace('T', ' ');
  const raw = await db.all(
    `SELECT actor_name, action, description, created_at FROM audit_logs WHERE action LIKE 'directory.%' AND created_at >= ? ORDER BY created_at DESC, id DESC LIMIT 2000`, [since]);
  const events = raw.map((e) => {
    const m = /^\[([^\]]+)\] /.exec(e.description || '');
    return { event_type: e.action, actor_name: e.actor_name, created_at: String(e.created_at).replace(' ', 'T'), directory: m ? m[1] : null, detail: m ? e.description.slice(m[0].length) : (e.description || '') };
  });
  const ms = (detail) => { const m = /(\d+) ms$/.exec(detail || ''); return m ? Number(m[1]) : null; };
  const totals = { success: 0, failure: 0, error: 0 };
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i -= 1) byDay.set(new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10), { success: 0, failure: 0, error: 0 });
  const times = [];
  const dirs = await list();
  const per = new Map(dirs.map((d) => [d.name, { id: d.id, name: d.name, enabled: d.enabled, url: d.url, success: 0, failure: 0, error: 0, times: [], last_used: null, last_test: null }]));
  for (const e of events) {
    const row = e.directory ? per.get(e.directory) : null;
    if (e.event_type === 'directory.test') { if (row && !row.last_test) row.last_test = { ok: /passed/.test(e.detail || ''), detail: e.detail, created_at: e.created_at }; continue; }
    const kind = ACTIVITY_KIND[e.event_type]; if (!kind) continue;
    totals[kind] += 1;
    const day = byDay.get(e.created_at.slice(0, 10)); if (day) day[kind] += 1;
    const t = ms(e.detail); if (t !== null && kind !== 'error') times.push(t);
    if (row) { row[kind] += 1; if (t !== null && kind !== 'error') row.times.push(t); if (!row.last_used && kind === 'success') row.last_used = e.created_at; }
  }
  const average = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const accounts = await db.all('SELECT id, name, email, active, role_id, created_at FROM users WHERE directory_provider IS NOT NULL AND deleted_at IS NULL');
  const byId = new Map(accounts.map((u) => [u.id, { name: u.name, email: u.email, awaiting_role: !u.role_id }]));
  const idSet = new Set(accounts.map((u) => u.id));
  const sessions = await activeDirectorySessions(idSet, byId);
  const lastTest = events.find((e) => e.event_type === 'directory.test') || null;
  return {
    days,
    totals: { ...totals, attempts: totals.success + totals.failure + totals.error, avg_ms: average(times) },
    daily: [...byDay].map(([date, v]) => ({ date, ...v })),
    directories: [...per.values()].map(({ times: tl, ...row }) => ({ ...row, attempts: row.success + row.failure + row.error, avg_ms: average(tl), sessions: sessions.filter((s) => s.directory === row.name).length })),
    sessions,
    accounts: { total: accounts.length, awaiting: accounts.filter((u) => u.active && !u.role_id).map((u) => ({ id: u.id, name: u.name, email: u.email, created_at: u.created_at })) },
    last_test: lastTest,
    recent: events.slice(0, 50),
  };
}

module.exports = {
  isEnabled, anyEnabled, activeProvider, authenticate, searchDirectory,
  list, create, update, remove, reorder, test, activity,
  offlineDays, setOfflineDays, OFFLINE_DAYS_MAX,
  DirectoryError, ValidationError,
};
