'use strict';
// Microsoft 365 (Entra ID) application configuration shared by OneDrive backups.
// VMTL has no other Microsoft integration, so this is the single place that holds
// the Entra app registration (tenant, client id, client secret) and the token
// encryption used to store OneDrive refresh tokens at rest.
//
// Configured on the Backup & cleanup page (App Owner). Any field left blank falls
// back to the environment:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET   required to turn this on
//   MS_REDIRECT_URI     optional; default <APP_URL>/api/admin/backups/microsoft/callback
//   BACKUP_ENCRYPTION_KEY  optional; defaults to SESSION_SECRET
const crypto = require('crypto');
const settings = require('./settings');

const AUTH_HOST = 'https://login.microsoftonline.com';
// Public path (outside the owner-gated /admin/backups guard): the browser lands
// here on the Microsoft redirect without the strict-SameSite session cookie, so
// the OAuth state nonce — not the session — authorises the connection.
const CALLBACK_PATH = '/api/microsoft/backup-callback';
const SETTINGS_KEY = 'microsoft365_config';

// A tenant is a GUID or a domain (e.g. knust.edu.gh); anything else would change the sign-in URL.
const TENANT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i;
const REDIRECT = /^(https:\/\/[^\s?#]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s?#]*)$/i;

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

// ---- Token encryption (AES-256-GCM) ----------------------------------------
function key() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'vmtl-development-only';
  return crypto.scryptSync(secret, 'vmtl-microsoft365', 32);
}
function encrypt(text) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}
function decrypt(value) {
  const [version, iv, tag, data] = String(value || '').split('.');
  if (version !== 'v1' || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) { return null; } // key changed: reconnect / re-enter the secret
}

// ---- Stored config ----------------------------------------------------------
async function savedConfig() {
  const raw = await settings.get(SETTINGS_KEY, null);
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
}
async function save(obj) { await settings.set(SETTINGS_KEY, JSON.stringify(obj)); }

// Saved values win; blank ones fall back to the environment.
function resolve(saved = {}, env = process.env) {
  const pick = (own, name) => {
    const value = String(own || '').trim();
    if (value) return { value, source: 'app' };
    const fromEnv = String(env[name] || '').trim();
    return fromEnv ? { value: fromEnv, source: 'environment' } : { value: '', source: '' };
  };
  const tenant = pick(saved.tenant_id, 'MS_TENANT_ID');
  const client = pick(saved.client_id, 'MS_CLIENT_ID');
  const redirect = pick(saved.redirect_uri, 'MS_REDIRECT_URI');
  const ownSecret = saved.secret ? decrypt(saved.secret) : '';
  const secret = ownSecret ? { value: ownSecret, source: 'app' }
    : (env.MS_CLIENT_SECRET ? { value: String(env.MS_CLIENT_SECRET), source: 'environment' } : { value: '', source: '' });
  return {
    configured: Boolean(TENANT.test(tenant.value) && client.value && secret.value),
    tenant: tenant.value, clientId: client.value, secret: secret.value, redirect: redirect.value,
    sources: { tenant_id: tenant.source, client_id: client.source, secret: secret.source, redirect_uri: redirect.source },
    secretUnreadable: Boolean(saved.secret && !ownSecret),
  };
}
async function config() { return resolve(await savedConfig()); }

function defaultRedirect() {
  const base = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}${CALLBACK_PATH}` : CALLBACK_PATH;
}
async function redirectUri(cfg) { return (cfg || await config()).redirect || defaultRedirect(); }

// Non-secret view for the configuration screen.
async function adminView() {
  const saved = await savedConfig();
  const cfg = resolve(saved);
  return {
    configured: cfg.configured,
    tenant_id: cfg.tenant, client_id: cfg.clientId, redirect_uri: cfg.redirect || defaultRedirect(),
    default_redirect: defaultRedirect(), has_secret: Boolean(cfg.secret), secret_unreadable: cfg.secretUnreadable,
    sources: cfg.sources,
  };
}
// Save the Entra app registration. A blank secret keeps the stored one.
async function saveConfig(input = {}) {
  const tenant = String(input.tenant_id || '').trim();
  const clientId = String(input.client_id || '').trim();
  const redirect = String(input.redirect_uri || '').trim();
  if (tenant && !TENANT.test(tenant)) fail('Enter a valid tenant ID (GUID) or domain.');
  if (redirect && !REDIRECT.test(redirect)) fail('Enter a valid HTTPS redirect URI.');
  const saved = await savedConfig();
  const next = { ...saved, tenant_id: tenant, client_id: clientId, redirect_uri: redirect };
  if (typeof input.secret === 'string' && input.secret.trim()) next.secret = encrypt(input.secret.trim());
  else if (input.clear_secret === true) delete next.secret;
  await save(next);
  return adminView();
}

module.exports = { config, adminView, saveConfig, redirectUri, defaultRedirect, encrypt, decrypt, savedConfig, CALLBACK_PATH, SETTINGS_KEY, AUTH_HOST };
