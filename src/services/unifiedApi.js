'use strict';

// Client for the external KNUST Unified API (the separate `unified-api`
// project): a read-only service on the campus network that returns live STAFF
// records — college, department, rank, designation, staff type/category — from
// the university databases. VMTL calls it after a directory (LDAP/AD) sign-in to
// learn the person's organisational unit. Staff data only; never vehicle data.
//
// Config: saved settings (unified_api_url / unified_api_key / unified_api_enabled)
// first, then the UNIFIED_API_URL / UNIFIED_API_KEY environment variables.
// KNUST's cloud serves a certificate signed by UITS, which Node does not trust
// by default, so HTTPS calls also trust certs/knust-cloud.pem (or the file in
// UNIFIED_API_CA_FILE). Certificates are still verified; nothing else is affected.
const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
const settings = require('./settings');

const DEFAULT_CA_FILE = path.join(__dirname, '..', '..', 'certs', 'knust-cloud.pem');
let caCache;
function extraCa(env = process.env) {
  const file = String(env.UNIFIED_API_CA_FILE || '').trim() || DEFAULT_CA_FILE;
  if (caCache && caCache.file === file) return caCache.pem;
  let pem = null;
  try { pem = fs.readFileSync(file, 'utf8'); } catch (_) { /* optional */ }
  caCache = { file, pem };
  return pem;
}

// Minimal GET that trusts the public roots plus `ca`. Returns the parts of a
// Response this module uses.
function fetchTrusting(ca) {
  return (url, { headers = {}, signal } = {}) => new Promise((resolve, reject) => {
    const req = https.get(url, { headers, ca: ca ? [...tls.rootCertificates, ca] : undefined, signal }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 4_000_000) { res.destroy(new Error('Unified API response exceeds size limit')); return; } chunks.push(c); });
      res.on('end', () => { const body = Buffer.concat(chunks); resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: { get: (name) => res.headers[name.toLowerCase()] }, json: async () => JSON.parse(body.toString('utf8')), arrayBuffer: async () => body }); });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}
// https:// goes through the trusting client; http:// (local dev) uses global fetch.
function doFetch(url, options) {
  return String(url).startsWith('https:') ? fetchTrusting(extraCa())(url, options) : fetch(url, options);
}
const failureReason = (err) => (err && (err.cause?.code || err.code || err.name || err.message)) || 'error';

// Saved settings first, environment variables as the fallback.
async function config() {
  let url = '';
  let key = '';
  let rawEnabled = '1';
  try {
    url = String((await settings.get('unified_api_url', '')) || process.env.UNIFIED_API_URL || '').trim().replace(/\/+$/, '');
    key = String((await settings.get('unified_api_key', '')) || process.env.UNIFIED_API_KEY || '').trim();
    rawEnabled = await settings.get('unified_api_enabled', '1');
  } catch (_) { /* settings table not ready */ }
  const switchedOn = !(rawEnabled === '0' || rawEnabled === false || rawEnabled === 0);
  const ms = Number.parseInt(await settings.get('unified_api_timeout_ms', '') || process.env.UNIFIED_API_TIMEOUT_MS, 10);
  const timeoutMs = ms > 0 ? Math.min(ms, 60000) : 8000;
  return { url, key, timeoutMs, switchedOn, enabled: Boolean(switchedOn && url && key), source: { url: await settings.get('unified_api_url', '') ? 'saved' : url ? 'env' : 'none', key: await settings.get('unified_api_key', '') ? 'saved' : key ? 'env' : 'none' } };
}
async function enabled() { return (await config()).enabled; }

const FIELD_LABELS = { id_number: 'Staff ID', full_name: 'Full name', email: 'Email', username: 'Username', photo_url: 'Profile picture', college: 'College', faculty: 'Faculty', department: 'Department', rank: 'Rank', designation: 'Designation', staff_type: 'Staff type', staff_category: 'Staff category', org_unit: 'Automatic organisational-unit updates' };
async function fieldSettings() {
  let saved = await settings.get('unified_api_fields', '{}');
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch (_) { saved = {}; } }
  return Object.entries(FIELD_LABELS).map(([key, label]) => ({ key, label, enabled: saved?.[key] !== false }));
}
async function saveFields(fields) {
  const current = await fieldSettings();
  const next = Object.fromEntries(current.map((f) => [f.key, typeof fields?.[f.key] === 'boolean' ? fields[f.key] : f.enabled]));
  await settings.set('unified_api_fields', JSON.stringify(next));
  return fieldSettings();
}
async function selectedFields(fields) {
  const allowed = await fieldSettings();
  return Object.fromEntries(allowed.filter((f) => f.enabled && f.key !== 'org_unit' && fields[f.key] !== undefined).map((f) => [f.key, fields[f.key]]));
}
async function manualSearch(q) {
  const out = await searchStaff(q);
  if (out.status !== 'ok') return out;
  const results = await Promise.all(out.results.slice(0, 20).filter((r) => r && r.id_number).map(async (r) => ({ id_number: String(r.id_number), fields: await selectedFields({ ...r, email: r.email || r.school_email, designation: r.designation || r.designation_group }) })));
  return { status: 'ok', results };
}
async function manualProfile(id) {
  const out = await staffProfile(id);
  if (out.status !== 'found') return out;
  const photo = await staffPhoto(id);
  return { status: 'found', fields: await selectedFields({ ...out.fields, photo_url: photo, id_number: out.id_number, designation: out.fields.designation || out.fields.designation_group }) };
}

async function staffPhoto(idNumber) {
  try {
    const cfg = await config();
    if (!cfg.enabled || !(await fieldSettings()).find((f) => f.key === 'photo_url').enabled) return null;
    const id = String(idNumber || '').trim();
    if (!id) return null;
    const res = await doFetch(`${cfg.url}/staff/${encodeURIComponent(id)}/photo`, { headers: headers(cfg), signal: AbortSignal.timeout(cfg.timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.found) return null;
    return await require('./staffPhoto').normalise(body.photo_url, { baseUrl: cfg.url, fetchImpl: doFetch, timeoutMs: cfg.timeoutMs });
  } catch (_) { return null; }
}

// Admin view of the config; the API key is never returned.
async function publicConfig() {
  const c = await config();
  return { url: c.url, has_key: Boolean(c.key), enabled: c.enabled, switched_on: c.switchedOn, fields: await fieldSettings() };
}
async function saveConfig(body = {}) {
  if (body.url) {
    let url; try { url = new URL(String(body.url)); } catch (_) { throw Object.assign(new Error('Enter a valid API URL.'), { status: 400 }); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Object.assign(new Error('Use an HTTP or HTTPS API URL without credentials, query or fragment.'), { status: 400 });
  }
  if (body.timeout_ms !== undefined) {
    const ms = Number(body.timeout_ms);
    if (!Number.isInteger(ms) || ms < 1000 || ms > 60000) throw Object.assign(new Error('Timeout must be between 1000 and 60000 ms.'), { status: 400 });
    await settings.set('unified_api_timeout_ms', String(ms));
  }
  if (body.url !== undefined) await settings.set('unified_api_url', String(body.url || '').trim().replace(/\/+$/, ''));
  if (body.key) await settings.set('unified_api_key', String(body.key));
  if (body.clear_key) await settings.set('unified_api_key', '');
  if (body.enabled !== undefined) await settings.set('unified_api_enabled', body.enabled ? '1' : '0');
  return publicConfig();
}

const headers = (cfg) => ({ 'x-api-key': cfg.key, accept: 'application/json' });

// Search staff by email / username / name. Returns { status, results:[{id_number,
// full_name, email, username, department, designation_group}] }.
async function searchStaff(q) {
  const cfg = await config();
  if (!cfg.enabled) return { status: 'unavailable', results: [], reason: 'disabled' };
  const query = String(q || '').trim();
  if (query.length < 2) return { status: 'invalid', results: [], reason: 'Enter at least two characters to search staff.' };
  try {
    const res = await doFetch(`${cfg.url}/staff/search?q=${encodeURIComponent(query)}`, { headers: headers(cfg), signal: AbortSignal.timeout(cfg.timeoutMs) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 400) return { status: 'invalid', results: [], reason: body.error };
    if (!res.ok || !Array.isArray(body.results)) return { status: 'unavailable', results: [], reason: body.error || `HTTP ${res.status}` };
    return { status: 'ok', results: body.results };
  } catch (err) { return { status: 'unavailable', results: [], reason: failureReason(err) }; }
}

// Full staff profile by id. Returns { status, id_number, fields:{college,
// department, rank, designation, staff_type, staff_category, ...} }.
async function staffProfile(idNumber) {
  const cfg = await config();
  if (!cfg.enabled) return { status: 'unavailable', reason: 'disabled' };
  const id = String(idNumber || '').trim();
  if (!id) return { status: 'not_found' };
  try {
    const res = await doFetch(`${cfg.url}/staff/${encodeURIComponent(id)}`, { headers: headers(cfg), signal: AbortSignal.timeout(cfg.timeoutMs) });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'unavailable', reason: `HTTP ${res.status}` };
    const body = await res.json();
    if (!body || !body.found) return { status: 'not_found' };
    return { status: 'found', id_number: String(body.id_number || id), fields: body.fields || {} };
  } catch (err) { return { status: 'unavailable', reason: failureReason(err) }; }
}

// Admin diagnostics: config + a probe search (no records returned).
async function status(sample) {
  const cfg = await config();
  const report = { configured: Boolean(cfg.url), key_configured: Boolean(cfg.key), switched_on: cfg.switchedOn, enabled: cfg.enabled, url: cfg.url, checks: [] };
  if (!cfg.enabled) { report.checks.push({ code: cfg.switchedOn ? 'NOT_CONFIGURED' : 'SWITCHED_OFF', ok: false }); return report; }
  const q = String(sample || '').trim();
  const out = await searchStaff(q || 'ad');
  report.checks.push({ code: 'STAFF_SEARCH', ok: out.status === 'ok', detail: out.status === 'ok' ? `${out.results.length} result(s)` : out.reason });
  return report;
}

module.exports = { config, enabled, publicConfig, saveConfig, searchStaff, staffProfile, status, fieldSettings, saveFields, manualSearch, manualProfile, staffPhoto, doFetch };
