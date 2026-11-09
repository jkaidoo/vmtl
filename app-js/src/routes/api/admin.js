'use strict';
// Break-glass System Administrator tier (ports AppHealth/SystemControl/DirectoryAuth/
// Messaging/DatabaseConnection/Documentation controllers). All require super.
const db = require('../../db/runtime');
const runtime = require('../../db/runtime');
const settings = require('../../services/settings');
const directoryAuth = require('../../services/directoryAuth');
const sms = require('../../services/sms');
const email = require('../../services/email');
const audit = require('../../services/audit');
const log = require('../../util/log');
const { requireAuth, requireSuper } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { notFound } = require('../../middleware/errorHandler');

const SC_GROUPS = ['features', 'notifications', 'retention', 'maintenance'];

// Directory-auth field catalog (key → {label,type,options,group}).
const DIR_FIELDS = {
  general: [
    ['directory_enabled', 'Enable directory authentication', 'boolean'],
    ['directory_provider', 'Active provider', 'select', { ldap: 'LDAP', active_directory: 'Active Directory' }],
  ],
  ldap: [
    ['ldap_host', 'Host / Server URL', 'string'], ['ldap_port', 'Port', 'string'],
    ['ldap_encryption', 'Encryption', 'select', { none: 'None', starttls: 'StartTLS', ssl: 'LDAPS (SSL)' }],
    ['ldap_base_dn', 'Base DN', 'string'], ['ldap_bind_dn', 'Bind DN (service account)', 'string'],
    ['ldap_user_filter', 'User search filter', 'string'], ['ldap_attr_username', 'Username attribute', 'string'],
    ['ldap_attr_email', 'Email attribute', 'string'], ['ldap_attr_name', 'Display-name attribute', 'string'],
    ['ldap_group_base_dn', 'Group base DN', 'string'], ['ldap_required_group_dn', 'Required group DN (membership gate)', 'string'],
  ],
  ad: [
    ['ad_domain', 'Domain (FQDN)', 'string'], ['ad_host', 'Domain controller host(s)', 'string'], ['ad_port', 'Port', 'string'],
    ['ad_use_ssl', 'Use SSL / LDAPS', 'boolean'], ['ad_base_dn', 'Base DN', 'string'], ['ad_bind_account', 'Bind account (user@domain)', 'string'],
    ['ad_user_filter', 'User search filter', 'string'], ['ad_attr_username', 'Username attribute (sAMAccountName)', 'string'],
    ['ad_attr_upn', 'UPN attribute (userPrincipalName)', 'string'], ['ad_attr_email', 'Email attribute (mail)', 'string'],
    ['ad_attr_name', 'Display-name attribute (displayName)', 'string'], ['ad_required_group_dn', 'Required group DN (membership gate)', 'string'],
  ],
};
async function dirFields(group) {
  const out = [];
  for (const [key, label, type, options] of DIR_FIELDS[group]) {
    const raw = await settings.get(key, '');
    out.push({ key, label, type, options: options || null, value: type === 'boolean' ? !!raw : (raw || '') });
  }
  return out;
}

const SMS_PROVIDERS = {
  hubtel: { label: 'Hubtel', fields: [['hubtel_client_id', 'Client ID', false], ['hubtel_client_secret', 'Client Secret', true]] },
  mnotify: { label: 'mNotify', fields: [['mnotify_api_key', 'API Key', true]] },
  arkesel: { label: 'Arkesel', fields: [['arkesel_api_key', 'API Key', true]] },
  wigal: { label: 'Wigal (SMSGH)', fields: [['wigal_username', 'Username', false], ['wigal_api_key', 'API Key', true]] },
};

const DOCS = {
  readme: { title: 'Project README', summary: 'Setup, stack, credentials and feature overview.' },
  architecture: { title: 'Technical Overview', summary: 'How the backend and frontend fit together.' },
  'user-guide': { title: 'User Guide', summary: 'How each role uses the system.' },
  security: { title: 'Security Assessment', summary: 'Authentication, RBAC and data-integrity controls.' },
};
function docContent(slug) {
  if (slug === 'architecture') return `# Technical Overview\n\n## Stack\n- **Backend:** Node.js + Express (plain JavaScript), SQLite (dev) / PostgreSQL (prod), session auth.\n- **Frontend:** Static HTML + vanilla JS + CSS (KNUST UITS design tokens), PWA.\n\n## Layers\n- **Services** hold business logic: availability, assignment, trips, analytics, maintenance alerts, directory auth, web push.\n- **Capability RBAC** (role_capabilities) is enforced server-side on every route; the break-glass System Administrator holds every capability.\n- **Notifications** fan out over in-app, email and Web Push channels.\n\n## Request lifecycle\nRequest → Approval → Assignment (vehicle + driver, conflict-checked) → Trip start → Trip completion (odometer-validated) → Reporting → Analytics, with an append-only audit trail throughout.`;
  if (slug === 'user-guide') return `# User Guide\n\n- **Staff** submit and track vehicle requests, and cancel eligible ones.\n- **Approvers** review pending requests and approve or reject (a reason is required to reject).\n- **Transport Officers** assign a vehicle + driver, then start, end or mark trips as no-show, and record maintenance.\n- **Drivers** operate their own assigned trips from a phone.\n- **Supervisors** manage users and operations within their organisational unit and its sub-units.\n- **Administrators** manage users, departments, settings and the audit log.\n- The **System Administrator** holds the break-glass controls: App Health, RBAC, System Controls, Directory Auth, Database Connections, Documentation.`;
  if (slug === 'security') return `# Security Assessment\n\n- **Authentication:** server-side sessions (httpOnly, SameSite=strict); passwords hashed (bcrypt); failed sign-ins recorded.\n- **Authorisation:** capability-based RBAC enforced on every route — the UI is never the boundary. One break-glass System Administrator.\n- **Data integrity:** transactions prevent double-booking; odometer readings are validated and every correction is audited. Soft deletes retain history.\n- **Auditability:** an append-only ledger records who did what, when, with IP.\n- **Secrets:** VAPID private key and directory bind passwords are server-side, write-only, and redacted from exports.`;
  return '# UITS Vehicle Management & Trip Logging\n\nSee the Technical Overview and User Guide.';
}

module.exports = function register(router) {
  // ---- App Health --------------------------------------------------------
  router.get('/admin/app-health', requireAuth, requireSuper, async (req, res) => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const count = async (sql, p) => (await db.get(sql, p)).n;
    const stats = {
      successful_signins: await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.login' AND created_at >= ?", [since]),
      failed_signins: await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('auth.login_failed','auth.login_blocked') AND created_at >= ?", [since]),
      events_7d: await count('SELECT COUNT(*) AS n FROM audit_logs WHERE created_at >= ?', [since]),
      errors_recent: log.recent(50).filter((e) => e.level === 'error').length,
    };
    const rows = (sql, p) => db.all(sql, p);
    const mapAudit = (a) => ({ id: a.id, action: a.action, description: a.description, user: a.user_name, ip_address: a.ip_address, created_at: a.created_at });
    res.json({ data: {
      stats,
      successful_signins: (await rows("SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action = 'auth.login' AND a.created_at >= ? ORDER BY a.created_at DESC LIMIT 15", [since])).map(mapAudit),
      failed_signins: (await rows("SELECT * FROM audit_logs WHERE action IN ('auth.login_failed','auth.login_blocked') AND created_at >= ? ORDER BY created_at DESC LIMIT 15", [since])).map(mapAudit),
      recent_events: (await rows('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 20', [])).map(mapAudit),
      error_log: log.recent(50).filter((e) => e.level === 'error').map((e) => ({ level: 'ERROR', timestamp: e.at, message: e.message || e.event })),
    } });
  });

  // ---- System Controls ---------------------------------------------------
  async function scList() {
    const rows = await db.all(`SELECT key, value, type, "group" AS grp, label FROM system_settings WHERE "group" IN (${SC_GROUPS.map(() => '?').join(',')}) ORDER BY "group", key`, SC_GROUPS);
    return rows.map((s) => ({ key: s.key, label: s.label, group: s.grp, type: s.type, value: settings.cast(s.value, s.type) }));
  }
  router.get('/admin/system-controls', requireAuth, requireSuper, async (req, res) => res.json({ data: await scList() }));
  router.put('/admin/system-controls', requireAuth, requireSuper, async (req, res) => {
    for (const item of (req.body.settings || [])) {
      if (!item || !item.key) continue;
      const existing = await db.get(`SELECT "group" AS grp FROM system_settings WHERE key = ?`, [item.key]);
      if (existing && SC_GROUPS.includes(existing.grp)) await settings.set(item.key, item.value);
    }
    await audit.from(req, { action: 'system_controls.updated', description: `${req.session.user.name} updated system controls` });
    res.json({ data: await scList() });
  });

  // ---- Directory Auth ----------------------------------------------------
  async function dirPayload() {
    return { data: {
      general: { fields: await dirFields('general') },
      ldap: { fields: await dirFields('ldap'), has_bind_password: !!(await settings.get('ldap_bind_password', '')) },
      ad: { fields: await dirFields('ad'), has_bind_password: !!(await settings.get('ad_bind_password', '')) },
      mapping: { default_role: (await settings.get('directory_default_role', 'staff')) || 'staff', default_org_unit: (await settings.get('directory_default_org_unit', '')) ? Number(await settings.get('directory_default_org_unit', '')) : null, rules: (await settings.get('directory_role_map', [])) || [] },
    } };
  }
  router.get('/admin/directory-auth', requireAuth, requireSuper, async (req, res) => res.json(await dirPayload()));
  router.put('/admin/directory-auth', requireAuth, requireSuper, async (req, res) => {
    const catalog = {};
    for (const [group, fields] of Object.entries(DIR_FIELDS)) for (const [key, , type] of fields) catalog[key] = type;
    for (const field of (req.body.fields || [])) {
      const type = catalog[field.key]; if (!type) continue;
      const value = type === 'boolean' ? (field.value ? '1' : '0') : String(field.value ?? '');
      await settingSet(field.key, value, type === 'boolean' ? 'boolean' : 'string');
    }
    for (const [provider, key] of [['ldap', 'ldap_bind_password'], ['ad', 'ad_bind_password']]) {
      const input = req.body[`${provider}_bind_password`];
      if (input) await settingSet(key, input, 'string');
    }
    if ('default_role' in req.body) await settingSet('directory_default_role', req.body.default_role || 'staff', 'string');
    if ('default_org_unit' in req.body) await settingSet('directory_default_org_unit', req.body.default_org_unit || '', 'string');
    if ('role_map' in req.body) {
      const rules = (req.body.role_map || []).filter((r) => r && r.group && r.role).map((r) => ({ group: String(r.group).trim(), role: String(r.role), org_unit_id: r.org_unit_id ? Number(r.org_unit_id) : null }));
      await settingSetJson('directory_role_map', rules);
    }
    await audit.from(req, { action: 'directory_auth.updated', description: `${req.session.user.name} updated directory authentication settings` });
    res.json(await dirPayload());
  });
  router.post('/admin/directory-auth/test', requireAuth, requireSuper, async (req, res) => {
    const { provider } = validate(req.body, { provider: { required: true, type: 'string', in: ['ldap', 'ad'] } });
    const result = await directoryAuth.testConnection(provider);
    await audit.from(req, { action: 'directory_auth.tested', description: `${req.session.user.name} tested the ${provider} directory connection — ${result.ok ? 'success' : 'failed'}` });
    res.json({ data: result });
  });

  // ---- Messaging (email / SMS) ------------------------------------------
  async function messagingPayload() {
    const providers = {};
    for (const [key, meta] of Object.entries(SMS_PROVIDERS)) {
      providers[key] = { label: meta.label, fields: [] };
      for (const [fk, fl, secret] of meta.fields) providers[key].fields.push({ key: fk, label: fl, secret, value: secret ? '' : (await settings.get(fk, '')) || '', has_value: !!(await settings.get(fk, '')) });
    }
    return { data: {
      email: { enabled: !!(await settings.get('mail_enabled', false)), host: (await settings.get('mail_host', '')) || '', port: (await settings.get('mail_port', '587')) || '587', username: (await settings.get('mail_username', '')) || '', encryption: (await settings.get('mail_encryption', 'tls')) || 'tls', from_address: (await settings.get('mail_from_address', '')) || '', from_name: (await settings.get('mail_from_name', 'UITS VMTL')) || 'UITS VMTL', has_password: !!(await settings.get('mail_password', '')) },
      sms: { enabled: !!(await settings.get('sms_enabled', false)), provider: (await settings.get('sms_provider', 'hubtel')) || 'hubtel', sender_id: (await settings.get('sms_sender_id', 'UITS')) || 'UITS', providers },
    } };
  }
  router.get('/admin/messaging', requireAuth, requireSuper, async (req, res) => res.json(await messagingPayload()));
  router.put('/admin/messaging', requireAuth, requireSuper, async (req, res) => {
    const em = req.body.email || {};
    await settingSet('mail_enabled', em.enabled ? '1' : '0', 'boolean');
    for (const k of ['host', 'port', 'username', 'encryption', 'from_address', 'from_name']) if (k in em) await settingSet(`mail_${k}`, String(em[k] ?? ''), 'string');
    if (em.password) await settingSet('mail_password', String(em.password), 'string');
    const smsBody = req.body.sms || {};
    await settingSet('sms_enabled', smsBody.enabled ? '1' : '0', 'boolean');
    if ('provider' in smsBody) await settingSet('sms_provider', String(smsBody.provider || 'hubtel'), 'string');
    if ('sender_id' in smsBody) await settingSet('sms_sender_id', String(smsBody.sender_id || ''), 'string');
    const known = {}; for (const meta of Object.values(SMS_PROVIDERS)) for (const [fk, , secret] of meta.fields) known[fk] = secret;
    for (const [k, v] of Object.entries(smsBody.fields || {})) { if (!(k in known)) continue; if (known[k]) { if (v) await settingSet(k, String(v), 'string'); } else await settingSet(k, String(v ?? ''), 'string'); }
    await audit.from(req, { action: 'messaging.updated', description: `${req.session.user.name} updated messaging (email/SMS) settings` });
    res.json(await messagingPayload());
  });
  router.post('/admin/messaging/test-email', requireAuth, requireSuper, async (req, res) => {
    const to = req.body.to || req.session.user.email;
    const result = await email.send(to, 'test email', 'This is a test email from the UITS Vehicle Management system. If you received this, email delivery is working.');
    res.json({ data: result });
  });
  router.post('/admin/messaging/test-sms', requireAuth, requireSuper, async (req, res) => {
    const { to } = validate(req.body, { to: { required: true, type: 'string', maxLength: 20 } });
    res.json({ data: await sms.send(to, 'UITS VMTL test message — your SMS integration is working.') });
  });

  // ---- Database connections (read-only inspection) -----------------------
  router.get('/admin/database', requireAuth, requireSuper, async (req, res) => {
    const tables = ['roles', 'role_capabilities', 'departments', 'org_units', 'users', 'vehicles', 'drivers', 'vehicle_requests', 'request_approvals', 'trips', 'trip_stops', 'maintenance_records', 'odometer_readings', 'fuel_logs', 'audit_logs', 'system_settings', 'notifications', 'push_subscriptions'];
    const counts = [];
    for (const t of tables) { try { counts.push({ table: t, rows: (await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n }); } catch (_) { counts.push({ table: t, rows: null }); } }
    res.json({ data: {
      active: { name: runtime.mode(), driver: runtime.mode(), host: runtime.isPostgres() ? (process.env.DATABASE_URL ? 'postgres' : null) : 'local', database: runtime.isPostgres() ? 'postgres' : (process.env.VMTL_DB || 'data/vmtl.sqlite'), username: null, password: '[redacted]', version: null, size_mb: null },
      profiles: [{ name: runtime.mode(), driver: runtime.mode(), active: true }],
      tables: counts,
      migration_note: 'Schema is created idempotently on boot (SQLite) / via migrations (PostgreSQL).',
    } });
  });

  // ---- Documentation -----------------------------------------------------
  router.get('/admin/documentation', requireAuth, requireSuper, (req, res) => {
    res.json({ data: Object.entries(DOCS).map(([slug, m]) => ({ slug, title: m.title, summary: m.summary })) });
  });
  router.get('/admin/documentation/:slug', requireAuth, requireSuper, (req, res) => {
    const meta = DOCS[req.params.slug];
    if (!meta) throw notFound('Document not found.');
    res.json({ data: { slug: req.params.slug, title: meta.title, content: docContent(req.params.slug) } });
  });

  // Helpers that force the 'directory'/'messaging' group on write.
  async function settingSet(key, value, type) {
    const existing = await db.get('SELECT id, type FROM system_settings WHERE key = ?', [key]);
    const grp = key.startsWith('mail_') || key.startsWith('sms_') || /hubtel|mnotify|arkesel|wigal/.test(key) ? 'messaging' : 'directory';
    if (existing) await db.run(`UPDATE system_settings SET value = ?, type = ?, updated_at = ${db.now()} WHERE key = ?`, [value, type, key]);
    else await db.run(`INSERT INTO system_settings (key, value, type, "group", created_at, updated_at) VALUES (?, ?, ?, ?, ${db.now()}, ${db.now()})`, [key, value, type, grp]);
  }
  async function settingSetJson(key, obj) {
    const existing = await db.get('SELECT id FROM system_settings WHERE key = ?', [key]);
    if (existing) await db.run(`UPDATE system_settings SET value = ?, type = 'json', updated_at = ${db.now()} WHERE key = ?`, [JSON.stringify(obj), key]);
    else await db.run(`INSERT INTO system_settings (key, value, type, "group", created_at, updated_at) VALUES (?, ?, 'json', 'directory', ${db.now()}, ${db.now()})`, [key, JSON.stringify(obj)]);
  }
};
