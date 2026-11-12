'use strict';
// Live LDAP / Active Directory authentication (ports DirectoryAuthService using
// the native `ldapts` client). Login is local-first; when enabled this is the
// fallback. Unknown directory users are provisioned with a role AND org unit
// resolved from group→role/unit mapping, re-synced on every directory login
// (never touching the break-glass super admin). Settings live in system_settings
// (group 'directory'); bind passwords are write-only.
const db = require('./db_ref');
const settings = require('./settings');
const { hashPassword } = require('../util/password');
const log = require('../util/log');

async function isEnabled() { return !!(await settings.get('directory_enabled', false)); }
async function activeProvider() { const p = await settings.get('directory_provider', 'ldap'); return p === 'active_directory' ? 'ad' : 'ldap'; }

async function ldapConfig() {
  return {
    host: await settings.get('ldap_host', ''), port: await settings.get('ldap_port', '389'),
    encryption: await settings.get('ldap_encryption', 'none'), baseDn: await settings.get('ldap_base_dn', ''),
    bindDn: await settings.get('ldap_bind_dn', ''), bindPassword: await settings.get('ldap_bind_password', ''),
    userFilter: await settings.get('ldap_user_filter', '(uid={username})'),
    attrUsername: await settings.get('ldap_attr_username', 'uid'), attrEmail: await settings.get('ldap_attr_email', 'mail'),
    attrName: await settings.get('ldap_attr_name', 'cn'), groupBaseDn: await settings.get('ldap_group_base_dn', ''),
    requiredGroupDn: await settings.get('ldap_required_group_dn', ''),
  };
}
async function adConfig() {
  return {
    domain: await settings.get('ad_domain', ''), host: await settings.get('ad_host', ''), port: await settings.get('ad_port', '389'),
    ssl: !!(await settings.get('ad_use_ssl', false)), baseDn: await settings.get('ad_base_dn', ''),
    bindAccount: await settings.get('ad_bind_account', ''), bindPassword: await settings.get('ad_bind_password', ''),
    userFilter: await settings.get('ad_user_filter', '(sAMAccountName={username})'),
    attrUsername: await settings.get('ad_attr_username', 'sAMAccountName'), attrUpn: await settings.get('ad_attr_upn', 'userPrincipalName'),
    attrEmail: await settings.get('ad_attr_email', 'mail'), attrName: await settings.get('ad_attr_name', 'displayName'),
    requiredGroupDn: await settings.get('ad_required_group_dn', ''),
  };
}

function urlFor(provider, cfg) {
  if (provider === 'ad') return `${cfg.ssl ? 'ldaps' : 'ldap'}://${cfg.host}:${cfg.port || (cfg.ssl ? 636 : 389)}`;
  const scheme = cfg.encryption === 'ssl' ? 'ldaps' : 'ldap';
  return `${scheme}://${cfg.host}:${cfg.port || (scheme === 'ldaps' ? 636 : 389)}`;
}

function newClient(url) { const { Client } = require('ldapts'); return new Client({ url, timeout: 8000, connectTimeout: 8000 }); }
const memberOf = (entry) => { const m = entry.memberOf; return !m ? [] : (Array.isArray(m) ? m : [m]).map(String); };

// Resolve role slug + org unit id from the user's group memberships.
async function resolveMapping(groups) {
  const rules = (await settings.get('directory_role_map', [])) || [];
  const defaultRole = await settings.get('directory_default_role', 'staff');
  const defaultOrg = await settings.get('directory_default_org_unit', '');
  const lower = groups.map((g) => g.toLowerCase());
  for (const rule of rules) {
    if (rule && rule.group && lower.includes(String(rule.group).toLowerCase())) {
      return { role: rule.role || defaultRole, orgUnitId: rule.org_unit_id || (defaultOrg ? Number(defaultOrg) : null) };
    }
  }
  return { role: defaultRole || 'staff', orgUnitId: defaultOrg ? Number(defaultOrg) : null };
}

// Provision or re-sync a local mirror account for a directory user. Never touches a super admin.
async function provision({ provider, username, email, name, groups }) {
  const mapping = await resolveMapping(groups);
  const roleRow = await db.get('SELECT id FROM roles WHERE slug = ?', [mapping.role]);
  const roleId = roleRow ? roleRow.id : (await db.get("SELECT id FROM roles WHERE slug = 'staff'")).id;
  const addr = (email || `${username}@directory.local`).toLowerCase();
  const existing = await db.get('SELECT * FROM users WHERE lower(email) = ?', [addr]);
  if (existing) {
    if (!existing.is_super_admin) {
      await db.run(`UPDATE users SET name = ?, role_id = ?, org_unit_id = ?, directory_provider = ?, active = 1, updated_at = ${db.now()} WHERE id = ?`,
        [name || existing.name, roleId, mapping.orgUnitId, provider, existing.id]);
    }
    return existing.id;
  }
  const r = await db.run(`INSERT INTO users (name, email, password_hash, role_id, org_unit_id, active, is_super_admin, directory_provider, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 1, 0, ?, ${db.now()}, ${db.now()})`,
    [name || username, addr, roleId, mapping.orgUnitId, provider]);
  return r.lastInsertRowid;
}

// Authenticate `identifier` (username or email) + password against the directory.
// Returns the local user id on success, or null.
async function authenticate(identifier, password) {
  if (!(await isEnabled()) || !password) return null;
  const provider = await activeProvider();
  const cfg = provider === 'ad' ? await adConfig() : await ldapConfig();
  if (!cfg.host) return null;
  const username = String(identifier).includes('@') && provider === 'ldap' ? String(identifier).split('@')[0] : String(identifier);
  const client = newClient(urlFor(provider, cfg));
  try {
    if (provider === 'ldap' && cfg.encryption === 'starttls') await client.startTLS({});
    // Service bind to search.
    if (provider === 'ad') { if (cfg.bindAccount) await client.bind(cfg.bindAccount, cfg.bindPassword); }
    else if (cfg.bindDn) await client.bind(cfg.bindDn, cfg.bindPassword);
    const filter = (cfg.userFilter || '').replace(/\{username\}/g, username);
    const { searchEntries } = await client.search(cfg.baseDn, { scope: 'sub', filter, attributes: ['*', 'memberOf'] });
    if (!searchEntries.length) return null;
    const entry = searchEntries[0];
    const groups = memberOf(entry);
    const required = cfg.requiredGroupDn;
    if (required && !groups.map((g) => g.toLowerCase()).includes(required.toLowerCase())) return null;
    // Verify the password by binding as the user.
    await client.unbind();
    const verify = newClient(urlFor(provider, cfg));
    try {
      if (provider === 'ldap' && cfg.encryption === 'starttls') await verify.startTLS({});
      await verify.bind(entry.dn, password);
    } catch (_) { return null; } finally { await verify.unbind().catch(() => {}); }
    const email = Array.isArray(entry[cfg.attrEmail]) ? entry[cfg.attrEmail][0] : entry[cfg.attrEmail];
    const name = Array.isArray(entry[cfg.attrName]) ? entry[cfg.attrName][0] : entry[cfg.attrName];
    return provision({ provider, username, email: email ? String(email) : null, name: name ? String(name) : username, groups });
  } catch (err) { log.warn('directory_auth_error', { provider, message: err.message }); return null; }
  finally { await client.unbind().catch(() => {}); }
}

// Escape a user-typed query for safe inclusion in an LDAP filter (RFC 4515).
function ldapEscape(value) {
  return String(value).replace(/[\\*()\u0000]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

// Search the directory for people matching `query` (name, username or email).
// Used by an administrator to add staff from the directory — it service-binds
// and reads, but never verifies a password. Each result carries a suggested
// role + org unit from the group→role/unit mapping.
async function searchDirectory(query, limit = 25) {
  if (!(await isEnabled())) return { enabled: false, provider: null, results: [] };
  const provider = await activeProvider();
  const cfg = provider === 'ad' ? await adConfig() : await ldapConfig();
  if (!cfg.host) return { enabled: true, provider, results: [], error: 'No directory host is configured.' };
  const q = ldapEscape(String(query || '').trim());
  if (!q) return { enabled: true, provider, results: [] };
  const attrs = provider === 'ad'
    ? [cfg.attrName, cfg.attrUsername, cfg.attrEmail, cfg.attrUpn]
    : [cfg.attrName, cfg.attrUsername, cfg.attrEmail];
  const ors = provider === 'ad'
    ? `(|(${cfg.attrName}=*${q}*)(${cfg.attrUsername}=*${q}*)(${cfg.attrEmail}=*${q}*)(${cfg.attrUpn}=*${q}*))`
    : `(|(${cfg.attrName}=*${q}*)(${cfg.attrUsername}=*${q}*)(${cfg.attrEmail}=*${q}*))`;
  const filter = provider === 'ad' ? `(&(objectCategory=person)(objectClass=user)${ors})` : ors;
  const client = newClient(urlFor(provider, cfg));
  try {
    if (provider === 'ldap' && cfg.encryption === 'starttls') await client.startTLS({});
    if (provider === 'ad') { if (cfg.bindAccount) await client.bind(cfg.bindAccount, cfg.bindPassword); }
    else if (cfg.bindDn) await client.bind(cfg.bindDn, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDn, { scope: 'sub', filter, attributes: [...attrs, 'memberOf'], sizeLimit: limit });
    const results = [];
    for (const entry of searchEntries.slice(0, limit)) {
      const first = (a) => (Array.isArray(entry[a]) ? entry[a][0] : entry[a]);
      const username = String(first(cfg.attrUsername) || '').trim();
      if (!username) continue;
      const name = String(first(cfg.attrName) || username).trim();
      const email = (String(first(cfg.attrEmail) || (provider === 'ad' ? first(cfg.attrUpn) || '' : '')).trim()) || null;
      const groups = memberOf(entry);
      const mapping = await resolveMapping(groups);
      results.push({ username, name, email, dn: entry.dn, suggested_role: mapping.role, suggested_org_unit_id: mapping.orgUnitId });
    }
    return { enabled: true, provider, results };
  } catch (err) { log.warn('directory_search_error', { provider, message: err.message }); return { enabled: true, provider, results: [], error: err.message }; }
  finally { await client.unbind().catch(() => {}); }
}

async function testConnection(provider) {
  const p = provider === 'active_directory' ? 'ad' : provider;
  const cfg = p === 'ad' ? await adConfig() : await ldapConfig();
  if (!cfg.host) return { ok: false, message: 'No host configured.' };
  const client = newClient(urlFor(p, cfg));
  try {
    if (p === 'ldap' && cfg.encryption === 'starttls') await client.startTLS({});
    const dn = p === 'ad' ? cfg.bindAccount : cfg.bindDn;
    if (dn) await client.bind(dn, cfg.bindPassword);
    await client.search(cfg.baseDn, { scope: 'base', filter: '(objectclass=*)', attributes: ['dn'] });
    return { ok: true, message: `Connected to ${cfg.host} and bound successfully.` };
  } catch (err) { return { ok: false, message: `Failed: ${err.message}` }; }
  finally { await client.unbind().catch(() => {}); }
}

module.exports = { isEnabled, activeProvider, authenticate, testConnection, searchDirectory };
