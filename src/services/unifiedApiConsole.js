'use strict';
// Walk-in Unified API console adapted to VMTL settings, staff sync and transport.
const base = require('./unifiedApi');
const store = require('./settings');
const repository = {
  get: async (key, fallback) => { const value = await store.get(key, fallback); return typeof value === 'object' ? JSON.stringify(value) : value; },
  set: (key, value) => store.set(key, value),
  setMany: async (values) => { for (const [key, value] of Object.entries(values)) await store.set(key, value); },
};
const defaultFetch = base.doFetch;
const failureReason = err => err.name === 'TimeoutError' ? 'timeout' : err.cause?.code || err.code || err.message;
const TYPES = new Set(['STUDENT', 'STAFF', 'PROSPECTIVE']);
const KEYS = { url: 'unified_api_url', key: 'unified_api_key', timeout: 'unified_api_timeout_ms', enabled: 'unified_api_enabled', fields: 'unified_api_lookup_fields', seen: 'unified_api_seen_fields', order: 'unified_api_field_order', labels: 'unified_api_field_labels' };
const FIELD_KEY = /^[a-z0-9_]{1,64}$/i;

// Fields the walk-in profile can show, per type. Other fields the API returns
// are learned from lookups (see rememberFields) so they can be toggled too.
const BUILT_IN_FIELDS = {
  STUDENT: { programme: 'Programme', college: 'College', graduate_type: 'Graduate type', programme_class: 'Classification', year_of_admission: 'Year of admission', current_year: 'Current year', course_registration_status: 'Course registration', biometric_registration_status: 'Biometric registration', in_current_semester: 'In current semester', graduated: 'Graduated', fees_status: 'Fees status', email: 'Email', school_email: 'School email', personal_email: 'Personal email', phone: 'Phone', telecel_number: 'Telecel number', photo_url: 'Profile picture', date_of_birth: 'Age' },
  PROSPECTIVE: { application_type: 'Application type', admission_group: 'Admission group', admission_group_type: 'Admission group type', graduate_type: 'Graduate type', is_idl: 'Is IDL', country: 'Country', email: 'Email', phone: 'Phone', photo_url: 'Profile picture', programme_choices: 'Programmes Selected', admission_offers: 'Offers' },
  STAFF: { department: 'Department', designation: 'Designation', rank: 'Rank', email: 'Email', personal_email: 'Personal email', phone: 'Phone', photo_url: 'Profile picture', college: 'College', faculty: 'Faculty', staff_active: 'Employment status', staff_type: 'Staff type', staff_category: 'Staff category', id_number: 'Staff ID', full_name: 'Full name', username: 'Username', org_unit: 'Automatic organisational-unit updates' },
};

const repo = () => repository;
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
async function readJson(key) {
  try { return JSON.parse((await repo().get(key, '')) || '{}') || {}; } catch (_) { return {}; }
}

const settings = base.config;
async function publicSettings() {
  const cfg = await settings();
  return { url: cfg.url, key_configured: Boolean(cfg.key), timeout_ms: cfg.timeoutMs, switched_on: cfg.switchedOn, enabled: cfg.enabled, source: cfg.source };
}
async function saveSettings(body = {}) { await base.saveConfig(body); return publicSettings(); }

// Saved order first; fields not yet placed keep their default position after them.
function ordered(keys, saved = []) {
  const known = new Set(keys);
  const first = saved.filter((k) => known.has(k));
  const placed = new Set(first);
  return [...first, ...keys.filter((k) => !placed.has(k))];
}

// Field catalogue per type, in display order, with whether each field is shown
// on lookup (default: shown).
async function fieldSettings() {
  const visible = await readJson(KEYS.fields); const seen = await readJson(KEYS.seen); const order = await readJson(KEYS.order); const custom_labels = await readJson(KEYS.labels);
  visible.STAFF = { ...Object.fromEntries((await base.fieldSettings()).map(f => [f.key, f.enabled])), ...(visible.STAFF || {}) };
  const out = {};
  for (const type of TYPES) {
    // A built-in field keeps its own label even if it was learned from a lookup first.
    const labels = { ...BUILT_IN_FIELDS[type] };
    for (const [k, label] of Object.entries(seen[type] || {})) if (!(k in labels)) labels[k] = label;
    // A label renamed on the Unified API page replaces the default everywhere
    // the field is shown; default_label is what it goes back to.
    const custom = custom_labels[type] || {};
    out[type] = ordered(Object.keys(labels), order[type]).map((key) => ({ key, label: custom[key] || labels[key], default_label: labels[key], custom: Boolean(custom[key]), built_in: key in BUILT_IN_FIELDS[type], visible: (visible[type] || {})[key] !== false }));
    out[type] = [...out[type].filter(f => f.visible), ...out[type].filter(f => !f.visible)];
  }
  return out;
}

// body: { type: 'STUDENT' | 'STAFF', keys: [field, ...] } — the full list in display order.
async function saveFieldOrder(body = {}) {
  const type = String(body.type || '');
  if (!TYPES.has(type)) throw badRequest('Type must be STUDENT or STAFF');
  if (!Array.isArray(body.keys) || body.keys.length > 500) throw badRequest('Send the fields in order');
  const keys = [...new Set(body.keys.map(String).filter((k) => FIELD_KEY.test(k)))];
  const order = await readJson(KEYS.order);
  order[type] = keys;
  await repo().set(KEYS.order, JSON.stringify(order));
  return fieldSettings();
}

// How the walk-in profile shows a type: field keys in display order and the
// ones switched off. Empty for types other than STUDENT and STAFF.
async function lookupDisplay(type) {
  if (!TYPES.has(type)) return { order: [], hidden: [], labels: {} };
  const list = (await fieldSettings())[type];
  return { order: list.map((f) => f.key), hidden: list.filter((f) => !f.visible).map((f) => f.key), labels: Object.fromEntries(list.filter((f) => f.custom).map((f) => [f.key, f.label])) };
}

// body: { type, key, label } — renames how a field is labelled on profiles.
// A blank label goes back to the default.
async function saveFieldLabel(body = {}) {
  const type = String(body.type || ''); const key = String(body.key || '');
  if (!TYPES.has(type)) throw badRequest('Type must be STUDENT or STAFF');
  if (!FIELD_KEY.test(key)) throw badRequest('Unknown field');
  const label = String(body.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const labels = await readJson(KEYS.labels);
  labels[type] = labels[type] || {};
  if (label) labels[type][key] = label; else delete labels[type][key];
  await repo().set(KEYS.labels, JSON.stringify(labels));
  return fieldSettings();
}

// body: { STUDENT: { field: true|false }, STAFF: { ... } }
async function saveFieldSettings(body = {}) {
  if (body.STAFF) await base.saveFields(body.STAFF);
  const catalogue = await fieldSettings();
  const order = await readJson(KEYS.order);
  const visible = await readJson(KEYS.fields);
  for (const type of TYPES) {
    if (!body[type] || typeof body[type] !== 'object') continue;
    visible[type] = visible[type] || {};
    const switchedOff = new Set();
    for (const [key, on] of Object.entries(body[type])) if (FIELD_KEY.test(key)) {
      if (!on && visible[type][key] !== false) switchedOff.add(key);
      visible[type][key] = Boolean(on);
    }
    const keys = catalogue[type].map(f => f.key);
    order[type] = [...keys.filter(key => !switchedOff.has(key)), ...keys.filter(key => switchedOff.has(key))];
  }
  await repo().setMany({ [KEYS.fields]: JSON.stringify(visible), [KEYS.order]: JSON.stringify(order) });
  return fieldSettings();
}

// Field keys switched off for a type (STUDENT or STAFF); empty for anything else.
async function hiddenFields(type) {
  if (!TYPES.has(type)) return [];
  const visible = (await readJson(KEYS.fields))[type] || {};
  return Object.keys(visible).filter((k) => visible[k] === false);
}

// Remembers extra fields the API returned so they can be toggled on the page.
async function rememberFields(type, extra = []) {
  if (!TYPES.has(type) || !extra.length) return;
  try {
    const seen = await readJson(KEYS.seen); const known = seen[type] || {};
    const fresh = extra.filter((f) => FIELD_KEY.test(f.key) && !(f.key in known) && !(f.key in BUILT_IN_FIELDS[type]));
    if (!fresh.length) return;
    for (const f of fresh) known[f.key] = String(f.label || f.key).slice(0, 80);
    seen[type] = known;
    await repo().set(KEYS.seen, JSON.stringify(seen));
  } catch (_) { /* never block a lookup on this */ }
}

const text = (v) => (v == null ? null : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

// Yes/no fields the API returns as a flag (true/false, 1/0, "Y"/"N"), shown as
// "Yes" or "No" like the other registration fields. Shown but not stored.
const YES_NO_FIELDS = new Set([
  'in_current_semester', 'graduated', 'has_graduated',
  'course_registration_status', 'biometric_registration_status',
  'application_submitted', 'application_reviewed', 'results_verified',
  'information_certified', 'consider_fee_paying', 'consider_parallel',
]);
// A numeric value alone cannot identify a flag: IDs, amounts and counts may
// also be 0 or 1. Recognise IS-prefixed fields and known boolean API aliases.
function isYesNoField(key, label = '') {
  const normalise = value => String(value).trim().replace(/[\s_-]+/g, '').toLowerCase();
  return YES_NO_FIELDS.has(String(key).toLowerCase()) || [key, label].some(value => {
    const name = normalise(value);
    return name.startsWith('is') && !/(?:id|count|amount|year)$/.test(name);
  });
}
function fieldText(key, value, label = '') {
  return typeof value === 'boolean' || isYesNoField(key, label) ? yesNo(value) : text(value);
}
function yesNo(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (['true', '1', 'y', 'yes'].includes(t)) return 'Yes';
  if (['false', '0', 'n', 'no'].includes(t)) return 'No';
  return t ? String(v).trim() : null;
}

// A field whose value is a list of rows, e.g. the registered courses returned by
// `SELECT (SELECT ... FOR JSON PATH) AS Courses`: a JSON array of objects, as a
// string or already parsed. Returns { columns, rows } with every cell as text,
// or null for anything else. Capped so one field cannot bloat a lookup.
const MAX_LIST_ROWS = 200; const MAX_LIST_COLUMNS = 12;
function toList(value, admissions = false) {
  let list = value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return null;
    try { list = JSON.parse(t); } catch (_) { return null; }
  }
  if (list && typeof list === 'object' && !Array.isArray(list)) list = [list];
  if (!Array.isArray(list) || !list.length || !list.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null;
  const columns = [];
  for (const row of list) for (const k of Object.keys(row)) if (!columns.includes(k) && (admissions || columns.length < MAX_LIST_COLUMNS)) columns.push(k);
  const rows = list.slice(0, admissions ? list.length : MAX_LIST_ROWS).map((row) => columns.map((k) => (row[k] == null ? '' : typeof row[k] === 'object' ? JSON.stringify(row[k]) : fieldText(k, row[k])?.trim() ?? '')));
  return { columns: columns.map((c) => String(c).slice(0, 60)), rows };
}

// Transaction history uses the same table model as registered courses, including
// responses that wrap the JSON in a SQL result column or encode it twice.
function transactionTable(value) {
  let records = value;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof records === 'string') {
      try { records = JSON.parse(records.trim()); continue; } catch (_) { return null; }
    }
    const wrapper = Array.isArray(records) && records.length === 1 ? records[0] : records;
    if (wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)) {
      const keys = Object.keys(wrapper);
      if (keys.length === 1 && /transaction.?history|^json(?:_|$)/i.test(keys[0])) { records = wrapper[keys[0]]; continue; }
    }
    break;
  }
  if (Array.isArray(records) && !records.length) return { columns: [], rows: [] };
  const list = toList(records, true);
  if (!list) return null;
  const names = {
    formreferencenumber: 'Form reference number', email: 'Email', phonenumber: 'Phone number',
    formamount: 'Form amount', paidamount: 'Paid amount', paymentmethod: 'Payment method',
    transactionstatus: 'Transaction status', acadyear: 'Academic year', createdat: 'Created at',
    transactionid: 'Transaction ID', id: 'Transaction ID',
  };
  list.columns = list.columns.map((key) => names[key.replace(/_/g, '').toLowerCase()] || key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
  return list;
}


async function testStaffSearch(query, { fetchImpl = defaultFetch } = {}) {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 100) throw badRequest('Enter a name or staff ID between 2 and 100 characters.');
  const cfg = await settings();
  let target = '';
  try { const u = new URL(cfg.url); target = u.origin + u.pathname; } catch (_) { /* reported below */ }
  const report = { checked_at: new Date().toISOString(), target, timeout_ms: cfg.timeoutMs, configuration: { switched_on: cfg.switchedOn, url_configured: Boolean(cfg.url), key_configured: Boolean(cfg.key), source: cfg.source }, checks: [] };
  if (!cfg.enabled) {
    report.checks.push({ code: cfg.switchedOn ? 'NOT_CONFIGURED' : 'SWITCHED_OFF', ok: false, hint: cfg.switchedOn ? 'Save the API URL and key in Integration settings.' : 'Enable Use live lookups and save settings.' });
    return report;
  }
  const probe = async (path, search) => {
    const started = Date.now();
    const result = { endpoint: search ? '/staff/search' : '/health', ok: false };
    try {
      const res = await fetchImpl(cfg.url + path, { headers: { 'x-api-key': cfg.key, accept: 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs) });
      result.http_status = res.status;
      let body; try { body = await res.json(); } catch (_) { /* classify HTML/proxy responses below */ }
      if (res.status === 401 || res.status === 403) {
        result.code = 'AUTH_REJECTED'; result.hint = 'Check the saved API key and the API or proxy access rules.';
      } else if (res.status === 404) {
        result.code = 'ENDPOINT_NOT_FOUND'; result.hint = search ? 'Check the API base URL. Deploy the Unified API staff-search update and restart that service.' : 'Check the API base URL and reverse proxy routing.';
      } else if (res.status === 400) {
        result.code = 'QUERY_REJECTED'; result.hint = 'The API rejected the query. Try a surname or a staff ID.';
      } else if (!res.ok) {
        result.code = res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR'; result.hint = 'Check Unified API and proxy logs, and the staff SQL Server connection and search query configuration.';
      } else if (!body || (search ? !Array.isArray(body.results) || body.results.some(r => !r || typeof r !== 'object' || !String(r.id_number || '').trim()) : typeof body.status !== 'string')) {
        result.code = 'INVALID_RESPONSE'; result.hint = 'The endpoint did not return the expected JSON. Check the base URL, proxy routing and API version.';
      } else if (search) {
        result.ok = true; result.result_count = body.results.length; result.code = body.results.length ? 'MATCHES_FOUND' : 'NO_MATCHES';
        result.hint = body.results.length ? 'Staff search is working from this app server.' : 'The endpoint works but returned no matches. Try a known surname or ID; check the staff search SQL if expected records are missing.';
      } else {
        result.ok = body.status.toLowerCase() === 'ok'; result.code = result.ok ? 'HEALTH_OK' : 'HEALTH_DEGRADED';
        result.hint = result.ok ? 'The health endpoint is reachable. The staff-search check verifies search separately.' : 'The API reports degraded health. Check its database connections and server logs.';
      }
    } catch (err) {
      const reason = String(failureReason(err));
      result.code = /timeout|ETIMEDOUT/i.test(reason) ? 'TIMEOUT' : /CERT|TLS|SSL|SELF_SIGNED|VERIFY_LEAF/i.test(reason) ? 'TLS_ERROR' : /ENOTFOUND|EAI_AGAIN/i.test(reason) ? 'DNS_ERROR' : /ECONNREFUSED/i.test(reason) ? 'CONNECTION_REFUSED' : 'NETWORK_ERROR';
      result.hint = { TIMEOUT: 'Check API availability, slow SQL queries and the configured timeout.', TLS_ERROR: 'Check the API certificate chain and the app server trusted CA configuration.', DNS_ERROR: 'Check the API hostname and DNS on the app server.', CONNECTION_REFUSED: 'Check the API service, port and firewall.' }[result.code] || 'Check connectivity between the app server and the Unified API.';
    }
    result.ms = Date.now() - started;
    return result;
  };
  report.checks = await Promise.all([probe('/health', false), probe('/staff/search?q=' + encodeURIComponent(q), true)]);
  return report;
}


async function status({ fetchImpl = defaultFetch } = {}) {
  const cfg = await settings();
  if (!cfg.enabled) return { enabled: false, switched_on: cfg.switchedOn, configured: Boolean(cfg.url && cfg.key) };
  let host = ''; try { host = new URL(cfg.url).host; } catch (_) { /* keep blank */ }
  const started = Date.now();
  try {
    const res = await fetchImpl(`${cfg.url}/health`, { signal: AbortSignal.timeout(cfg.timeoutMs) });
    const body = await res.json().catch(() => ({}));
    const ms = Date.now() - started;
    // A degraded API still answers /health (with per-database state); only a bare error is "unreachable".
    if (!res.ok && !body.status) return { enabled: true, host, reachable: false, reason: `HTTP ${res.status}`, ms };
    return { enabled: true, host, reachable: true, status: body.status || `HTTP ${res.status}`, sources: body.sources || {}, ms };
  } catch (err) {
    return { enabled: true, host, reachable: false, reason: failureReason(err) };
  }
}


// Read-only live lookup; only field catalogue metadata is saved.
async function testLookup(idNumber, { source, fetchImpl = defaultFetch } = {}) {
  const id = String(idNumber || '').trim();
  if (!id || id.length > 100) throw badRequest('Enter an ID between 1 and 100 characters.');
  if (source && !TYPES.has(source)) throw badRequest('Choose students, staff, admissions or all records.');
  const cfg = await settings(); const started = Date.now();
  if (!cfg.enabled) return { status: 'unavailable', reason: cfg.switchedOn ? 'not_configured' : 'switched_off', ms: 0 };
  const endpoint = { STUDENT: 'students', STAFF: 'staff', PROSPECTIVE: 'admissions' }[source] || 'people';
  try {
    const res = await fetchImpl(`${cfg.url}/${endpoint}/${encodeURIComponent(id)}`, { headers: { 'x-api-key': cfg.key, accept: 'application/json' }, signal: AbortSignal.timeout(cfg.timeoutMs) });
    if (res.status === 404) return { status: 'not_found', ms: Date.now() - started };
    if (!res.ok) return { status: 'unavailable', reason: `HTTP ${res.status}`, ms: Date.now() - started };
    const body = await res.json();
    if (!body?.found) return { status: 'not_found', ms: Date.now() - started };
    const type = body.type === 'APPLICANT' ? 'PROSPECTIVE' : body.type || source;
    if (!TYPES.has(type) || !body.fields || typeof body.fields !== 'object') return { status: 'unavailable', reason: 'Unexpected API response', ms: Date.now() - started };
    const values = { ...body.fields };
    const extra = Object.keys(values).filter(key => FIELD_KEY.test(key)).map(key => ({ key, label: String(body.labels?.[key] || BUILT_IN_FIELDS[type][key] || key.replace(/_/g, ' ')).slice(0, 80) }));
    await rememberFields(type, extra);
    const catalogue = (await fieldSettings())[type];
    const photoEnabled = catalogue.find(f => f.key === 'photo_url')?.visible !== false;
    let photo = null;
    if (photoEnabled) {
      if (type === 'STAFF') photo = await base.staffPhoto(body.id_number || id);
      if (!photo && values.photo_url) {
        try { photo = await require('./staffPhoto').normalise(values.photo_url, { baseUrl: cfg.url, fetchImpl, timeoutMs: cfg.timeoutMs }); } catch (_) { /* optional image */ }
      }
    }
    // Include photo status even when the dedicated endpoint supplied it separately.
    values.photo_url = photo ? '(picture)' : photoEnabled ? 'No picture available' : '';
    const fields = catalogue.filter(f => Object.hasOwn(values, f.key)).map(f => {
      const value = values[f.key];
      const list = f.key === 'photo_url' ? null : /transaction.?history/i.test(f.key) ? transactionTable(value) : toList(value);
      return { key: f.key, label: f.label, visible: f.visible, stored: type === 'STAFF' && ['college', 'department', 'rank', 'designation', 'staff_category', 'staff_type', 'photo_url'].includes(f.key), value: list ? `${list.rows.length} rows` : value && typeof value === 'object' && !Array.isArray(value) ? fieldText(f.key, value.value ?? value.text ?? value.name ?? JSON.stringify(value), f.label) : fieldText(f.key, value, f.label), ...(list ? { list } : {}) };
    });
    return { status: 'found', type, id_number: String(body.id_number || id), full_name: String(body.full_name || values.full_name || ''), photo_url: photo, fields, errors: Array.isArray(body.errors) ? body.errors : Object.keys(body.errors || {}), fetched_at: body.fetched_at || new Date().toISOString(), ms: Date.now() - started };
  } catch (err) { return { status: 'unavailable', reason: failureReason(err), ms: Date.now() - started }; }
}
module.exports = { publicSettings, saveSettings, fieldSettings, saveFieldSettings, saveFieldLabel, saveFieldOrder, status, testStaffSearch, testLookup };
