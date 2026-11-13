'use strict';
// Break-glass System Administrator tier (ports AppHealth/SystemControl/DirectoryAuth/
// Messaging/DatabaseConnection/Documentation controllers). All require super.
const db = require('../../db/runtime');
const runtime = require('../../db/runtime');
const settings = require('../../services/settings');
const directoryAuth = require('../../services/directoryAuth');
const sms = require('../../services/sms');
const email = require('../../services/email');
const notifications = require('../../services/notifications');
const dbProfiles = require('../../services/dbProfiles');
const audit = require('../../services/audit');
const log = require('../../util/log');
const { requireAuth, requireSuper } = require('../../middleware/auth');
const { validate } = require('../../util/validate');
const { notFound, badRequest } = require('../../middleware/errorHandler');

const SC_GROUPS = ['features', 'notifications', 'retention', 'maintenance'];

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

// Structured tour of the codebase for the System Administrator.
const CODEBASE_GUIDE = [
  { group: 'Overview', blurb: 'A Node.js + Express app in plain JavaScript, serving a static multi-page front-end, backed by PostgreSQL (embedded pglite in dev, managed PostgreSQL in prod). It mirrors the walkin reference architecture.', items: [
    { path: 'server.js', desc: 'Process lifecycle: run migrations, log server start, listen, graceful shutdown.' },
    { path: 'src/app.js', desc: 'Express factory — helmet CSP, sessions, idle policy, rate limits, page guards, static assets.' },
    { path: 'scripts/seed.js', desc: 'Idempotent seeder: roles, capabilities, KNUST org tree, demo fleet, drivers and trips.' },
  ] },
  { group: 'Data layer', blurb: 'One async interface over both engines so services have a single code path.', items: [
    { path: 'src/db/runtime.js', desc: 'get/all/run/transaction bridge; auto-appends RETURNING id for PostgreSQL inserts.' },
    { path: 'src/db/postgres.js', desc: 'PostgreSQL gateway — embedded pglite when no DATABASE_URL, else node-postgres.' },
    { path: 'src/db/postgresSchema.js', desc: 'Migration runner (migrations/postgres/NNN_*.sql), applied once each on boot.' },
    { path: 'src/db/sqlite.js', desc: 'Optional SQLite engine for quick local dev.' },
  ] },
  { group: 'Security & middleware', blurb: 'Capability RBAC enforced server-side on every route; the UI is never the boundary.', items: [
    { path: 'src/middleware/auth.js', desc: 'requireAuth, requireCap, requireAnyCap, requireSuper (break-glass System Administrator).' },
    { path: 'src/middleware/idle.js', desc: 'Sliding idle logout — 30 min on web/desktop PWA, mobile PWA exempt.' },
    { path: 'src/middleware/rateLimit.js', desc: 'Per-user and per-IP request limits.' },
    { path: 'src/services/authz.js · orgScope.js', desc: 'Capability checks and organisational-unit subtree scoping.' },
  ] },
  { group: 'Domain services', blurb: 'Business logic, one module per concern (async, over the runtime bridge).', items: [
    { path: 'src/services/assignment.js · trips.js · availability.js', desc: 'Vehicle/driver assignment with conflict checks; trip lifecycle; availability windows.' },
    { path: 'src/services/analytics.js · reports.js', desc: 'Usage analytics and CSV/XLSX/PDF report rows.' },
    { path: 'src/services/directoryAuth.js', desc: 'LDAP/AD sign-in and directory search (ldapts).' },
    { path: 'src/services/notifications.js · webPush.js · email.js · sms.js', desc: 'In-app, Web Push, email and SMS fan-out.' },
    { path: 'src/services/audit.js', desc: 'Append-only audit ledger — who did what, when, from where.' },
  ] },
  { group: 'API routes', blurb: 'Mounted under /api, one module per domain in src/routes/api/.', items: [
    { path: 'auth · meta · dashboard', desc: 'Sign-in/out, selectors + enums, the role-aware dashboard.' },
    { path: 'vehicle-requests · trips · vehicles · drivers', desc: 'The request-to-trip lifecycle and the fleet.' },
    { path: 'maintenance · fuel · analytics · reports · audit', desc: 'Records, insights, exports and the audit log.' },
    { path: 'users · org-units · rbac · settings · admin', desc: 'Administration and the super-admin tier (app-health, system-controls, directory-auth, messaging, database, documentation, broadcasts, codebase-guide).' },
  ] },
  { group: 'Front-end', blurb: 'Static multi-page app with instant in-place (SPA-style) navigation.', items: [
    { path: 'public/js/common.js', desc: 'Shell (sidebar, top bar, user menu, theme switch), API client, SPA navigation, helpers.' },
    { path: 'public/js/<page>.js', desc: 'One script per page defining window.VMTL_PAGE, rendered into #view.' },
    { path: 'public/css/styles.css', desc: 'KNUST design tokens (light/dark), components, charts — the walkin design language.' },
    { path: 'public/sw.js · manifest.webmanifest', desc: 'PWA service worker (network-first) and install manifest.' },
  ] },
];

module.exports = function register(router) {
  // ---- App Health --------------------------------------------------------
  const FAILED_LOGIN = "('auth.login_failed','auth.login_blocked')";
  function dayBuckets(days) {
    const out = []; const d = new Date(); d.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) { const x = new Date(d); x.setDate(x.getDate() - i); out.push(x.toISOString().slice(0, 10)); }
    return out;
  }
  async function dailySeries(sql, params, days) {
    const rows = await db.all(sql, params);
    const map = {}; rows.forEach((r) => { map[r.day] = Number(r.n); });
    return dayBuckets(days).map((date) => ({ date, count: map[date] || 0 }));
  }
  async function healthData(windowDays) {
    const since = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const count = async (sql, p) => Number((await db.get(sql, p)).n);
    const stats = {
      successful_signins: await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.login' AND created_at >= ?", [since]),
      failed_signins: await count(`SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ${FAILED_LOGIN} AND created_at >= ?`, [since]),
      requests: await count('SELECT COUNT(*) AS n FROM vehicle_requests WHERE created_at >= ?', [since]),
      events: await count('SELECT COUNT(*) AS n FROM audit_logs WHERE created_at >= ?', [since]),
      server_starts: await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'system.server_start' AND created_at >= ?", [since]),
      errors_recent: log.recent(100).filter((e) => e.level === 'error').length,
    };
    const series = {
      successful_signins: await dailySeries("SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM audit_logs WHERE action = 'auth.login' AND created_at >= ? GROUP BY substr(created_at,1,10)", [since], windowDays),
      failed_signins: await dailySeries(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM audit_logs WHERE action IN ${FAILED_LOGIN} AND created_at >= ? GROUP BY substr(created_at,1,10)`, [since], windowDays),
      requests: await dailySeries('SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM vehicle_requests WHERE created_at >= ? GROUP BY substr(created_at,1,10)', [since], windowDays),
    };
    // Setup checks (infrastructure readiness).
    let dbOk = true; try { await db.get('SELECT 1 AS ok'); } catch (_) { dbOk = false; }
    let tablesOk = true; try { await db.get('SELECT COUNT(*) AS n FROM users'); } catch (_) { tablesOk = false; }
    let auditOk = true; try { await db.get('SELECT COUNT(*) AS n FROM audit_logs'); } catch (_) { auditOk = false; }
    const checks = [
      { name: 'Database connection', ok: dbOk },
      { name: `Data store (${runtime.mode()})`, ok: dbOk },
      { name: 'Core tables present', ok: tablesOk },
      { name: 'Audit ledger writable', ok: auditOk },
      { name: 'Session store ready', ok: !!runtime.sessionMode() },
    ];
    const mapAudit = (a) => ({ id: a.id, action: a.action, description: a.description, user: a.user_name, ip_address: a.ip_address, created_at: a.created_at });
    const rows = (sql, p) => db.all(sql, p);
    return {
      generated_at: new Date().toISOString(),
      window_days: windowDays,
      uptime_ms: Math.round(process.uptime() * 1000),
      stats, series,
      setup_checks: { items: checks, success: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length },
      successful_signins: (await rows("SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action = 'auth.login' AND a.created_at >= ? ORDER BY a.created_at DESC LIMIT 20", [since])).map(mapAudit),
      failed_signins: (await rows(`SELECT * FROM audit_logs WHERE action IN ${FAILED_LOGIN} AND created_at >= ? ORDER BY created_at DESC LIMIT 20`, [since])).map(mapAudit),
      recent_events: (await rows('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 40', [])).map(mapAudit),
      error_log: log.recent(100).filter((e) => e.level === 'error').map((e) => ({ level: 'ERROR', timestamp: e.at, message: e.message || e.event })),
    };
  }
  const windowFrom = (q) => { const n = Number(q.window); return [7, 30, 90].includes(n) ? n : 30; };

  router.get('/admin/app-health', requireAuth, requireSuper, async (req, res) => {
    res.json({ data: await healthData(windowFrom(req.query)) });
  });

  router.get('/admin/app-health/export', requireAuth, requireSuper, async (req, res) => {
    const d = await healthData(windowFrom(req.query));
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '').slice(0, 15);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="app-health_${stamp}.pdf"`);
    doc.pipe(res);
    doc.fontSize(20).fillColor('#111820').text('App Health', { continued: false });
    doc.moveDown(0.2).fontSize(10).fillColor('#566171').text(`UITS VMTL · last ${d.window_days} days · generated ${new Date(d.generated_at).toLocaleString()}`);
    doc.moveDown(0.8);
    const h = Math.floor(d.uptime_ms / 3600000); const m = Math.floor((d.uptime_ms % 3600000) / 60000);
    const kpis = [
      ['Current uptime', h ? `${h}h ${m}m` : `${m}m`], ['Server starts', String(d.stats.server_starts)],
      ['Successful sign-ins', String(d.stats.successful_signins)], ['Failed sign-ins', String(d.stats.failed_signins)],
      ['Requests', String(d.stats.requests)], ['Operational events', String(d.stats.events)],
    ];
    doc.fontSize(13).fillColor('#111820').text('Summary'); doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#222b35');
    kpis.forEach(([k, v]) => doc.text(`${k}: `, { continued: true }).fillColor('#009540').text(v).fillColor('#222b35'));
    doc.moveDown(0.8).fontSize(13).fillColor('#111820').text('Recent operational events'); doc.moveDown(0.3).fontSize(9).fillColor('#222b35');
    d.recent_events.slice(0, 30).forEach((e) => doc.text(`${e.created_at}  ·  ${e.action}  ·  ${e.description || e.user || '—'}`));
    doc.end();
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

  // ---- Directory Auth (a list of LDAP/AD directories, tried in order) -----
  const sendDirErr = (res, e) => res.status(e && e.status ? e.status : 500).json({ error: e && e.status ? e.message : 'The directory settings could not be saved.' });
  router.get('/admin/directory-auth', requireAuth, requireSuper, async (req, res) => res.json({ data: {
    directories: await directoryAuth.list(), offline_days: await directoryAuth.offlineDays(), offline_days_max: directoryAuth.OFFLINE_DAYS_MAX,
  } }));
  router.get('/admin/directory-auth/activity', requireAuth, requireSuper, async (req, res) => res.json({ data: await directoryAuth.activity(req.query.days) }));
  router.post('/admin/directory-auth', requireAuth, requireSuper, async (req, res) => {
    try {
      const entry = await directoryAuth.create(req.body || {});
      await audit.from(req, { action: 'directory_auth.added', description: `${req.session.user.name} added directory "${entry.name}" (${entry.provider}, ${entry.url || 'no URL'})` });
      res.status(201).json({ data: { directory: entry } });
    } catch (e) { sendDirErr(res, e); }
  });
  router.put('/admin/directory-auth/order', requireAuth, requireSuper, async (req, res) => {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const directories = await directoryAuth.reorder(ids);
    await audit.from(req, { action: 'directory_auth.reordered', description: `${req.session.user.name} reordered directory sign-in: ${directories.map((d) => d.name).join(', ')}` });
    res.json({ data: { directories } });
  });
  router.put('/admin/directory-auth/offline', requireAuth, requireSuper, async (req, res) => {
    try {
      const days = await directoryAuth.setOfflineDays((req.body || {}).days);
      await audit.from(req, { action: 'directory_auth.updated', description: `${req.session.user.name} set directory saved sign-in to ${days ? `${days} day(s)` : 'off'}` });
      res.json({ data: { offline_days: days } });
    } catch (e) { sendDirErr(res, e); }
  });
  router.patch('/admin/directory-auth/:id', requireAuth, requireSuper, async (req, res) => {
    try {
      const entry = await directoryAuth.update(req.params.id, req.body || {});
      if (!entry) return res.status(404).json({ error: 'Directory not found.' });
      await audit.from(req, { action: 'directory_auth.updated', description: `${req.session.user.name} updated directory "${entry.name}" (${entry.enabled ? 'enabled' : 'disabled'})` });
      res.json({ data: { directory: entry } });
    } catch (e) { sendDirErr(res, e); }
  });
  router.delete('/admin/directory-auth/:id', requireAuth, requireSuper, async (req, res) => {
    const entry = await directoryAuth.remove(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Directory not found.' });
    await audit.from(req, { action: 'directory_auth.removed', description: `${req.session.user.name} removed directory "${entry.name}". Reason: ${String((req.body || {}).deletion_reason || '').trim().slice(0, 500)}` });
    res.json({ data: { ok: true } });
  });
  router.post('/admin/directory-auth/:id/test', requireAuth, requireSuper, async (req, res) => {
    const { username, password } = req.body || {};
    const out = await directoryAuth.test(req.params.id, { username, password });
    if (!out) return res.status(404).json({ error: 'Directory not found.' });
    await audit.from(req, { action: 'directory_auth.tested', description: `${req.session.user.name} tested a directory connection — ${out.ok ? 'passed' : 'failed'}` });
    res.json({ data: out });
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
    if (req.body.email) {
      const em = req.body.email;
      await settingSet('mail_enabled', em.enabled ? '1' : '0', 'boolean');
      for (const k of ['host', 'port', 'username', 'encryption', 'from_address', 'from_name']) if (k in em) await settingSet(`mail_${k}`, String(em[k] ?? ''), 'string');
      if (em.password) await settingSet('mail_password', String(em.password), 'string');
    }
    if (req.body.sms) {
      const smsBody = req.body.sms;
      await settingSet('sms_enabled', smsBody.enabled ? '1' : '0', 'boolean');
      if ('provider' in smsBody) await settingSet('sms_provider', String(smsBody.provider || 'hubtel'), 'string');
      if ('sender_id' in smsBody) await settingSet('sms_sender_id', String(smsBody.sender_id || ''), 'string');
      const known = {}; for (const meta of Object.values(SMS_PROVIDERS)) for (const [fk, , secret] of meta.fields) known[fk] = secret;
      for (const [k, v] of Object.entries(smsBody.fields || {})) { if (!(k in known)) continue; if (known[k]) { if (v) await settingSet(k, String(v), 'string'); } else await settingSet(k, String(v ?? ''), 'string'); }
    }
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

  // ---- Database connections ----------------------------------------------
  router.get('/admin/database', requireAuth, requireSuper, async (req, res) => {
    const counts = [];
    for (const t of dbProfiles.TABLES) { try { counts.push({ table: t, rows: Number((await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n) }); } catch (_) { counts.push({ table: t, rows: null }); } }
    res.json({ data: {
      encryption_configured: dbProfiles.encryptionConfigured(),
      active: await dbProfiles.activeStore(),
      providers: dbProfiles.PROVIDERS,
      profiles: await dbProfiles.list(),
      tables: counts,
    } });
  });
  router.post('/admin/database/profiles', requireAuth, requireSuper, async (req, res) => {
    const data = validate(req.body, { name: { required: true, type: 'string', maxLength: 120 }, provider: { type: 'string' }, host: { type: 'string' }, port: { type: 'string' }, database: { type: 'string' }, username: { type: 'string' }, ssl_mode: { type: 'string' }, password: { type: 'string' }, connection: { type: 'string' } });
    const p = await dbProfiles.create(data);
    await audit.from(req, { action: 'database.profile_saved', description: `${req.session.user.name} saved database profile ${data.name}` });
    res.status(201).json({ data: p });
  });
  router.put('/admin/database/profiles/:id', requireAuth, requireSuper, async (req, res) => {
    const p = await dbProfiles.update(req.params.id, req.body || {}); if (!p) throw notFound('Profile not found.');
    await audit.from(req, { action: 'database.profile_saved', description: `${req.session.user.name} updated database profile ${p.name}` });
    res.json({ data: p });
  });
  router.delete('/admin/database/profiles/:id', requireAuth, requireSuper, async (req, res) => {
    if (!(await dbProfiles.remove(req.params.id))) throw notFound('Profile not found.');
    await audit.from(req, { action: 'database.profile_removed', description: `${req.session.user.name} removed a database profile` });
    res.json({ ok: true });
  });
  router.post('/admin/database/profiles/:id/test', requireAuth, requireSuper, async (req, res) => {
    const result = await dbProfiles.test(req.params.id);
    await audit.from(req, { action: 'database.profile_tested', description: `${req.session.user.name} tested a database profile — ${result.ok ? 'connected' : 'failed'}` });
    res.json({ data: result });
  });
  router.post('/admin/database/profiles/:id/select', requireAuth, requireSuper, async (req, res) => { await dbProfiles.select(req.params.id); res.json({ ok: true }); });
  router.post('/admin/database/migrate', requireAuth, requireSuper, async (req, res) => {
    const id = req.body.profile_id; if (!id) throw badRequest('Select a migration target first.');
    if (String(req.body.confirmation || '').toUpperCase() !== 'MIGRATE') throw badRequest('Type MIGRATE to confirm.');
    const out = await dbProfiles.migrate(id);
    await audit.from(req, { action: 'database.migrated', description: `${req.session.user.name} copied the data store into a PostgreSQL target` });
    res.json({ data: out });
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

  // ---- Broadcasts --------------------------------------------------------
  router.get('/admin/broadcasts', requireAuth, requireSuper, async (req, res) => {
    const rows = await db.all("SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action = 'broadcast.sent' ORDER BY a.created_at DESC, a.id DESC LIMIT 40", []);
    res.json({ data: rows.map((a) => ({ id: a.id, description: a.description, by: a.user_name, created_at: a.created_at, meta: a.new_values ? JSON.parse(a.new_values) : null })) });
  });
  router.post('/admin/broadcasts', requireAuth, requireSuper, async (req, res) => {
    const data = validate(req.body, { title: { required: true, type: 'string', maxLength: 160 }, message: { required: true, type: 'string', maxLength: 2000 }, audience: { type: 'string', maxLength: 40 } });
    const audience = String(req.body.audience || 'all');
    const ch = req.body.channels || {};
    const recips = audience === 'all'
      ? await db.all('SELECT id, email, phone, name FROM users WHERE active = 1 AND deleted_at IS NULL')
      : await db.all('SELECT u.id, u.email, u.phone, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = ? AND u.active = 1 AND u.deleted_at IS NULL', [audience]);
    let inApp = 0; let emailed = 0; let texted = 0;
    for (const u of recips) {
      if (ch.in_app !== false) { try { await notifications.toUser(u.id, 'broadcast', { title: data.title, message: data.message }); inApp++; } catch (_) { /* skip */ } }
      if (ch.email && u.email) { try { const r = await email.send(u.email, data.title, data.message); if (r && r.ok) emailed++; } catch (_) { /* skip */ } }
      if (ch.sms && u.phone) { try { const r = await sms.send(u.phone, `${data.title}: ${data.message}`); if (r && r.ok) texted++; } catch (_) { /* skip */ } }
    }
    await audit.record({ userId: req.session.user.id, actorName: req.session.user.name, action: 'broadcast.sent', description: `${req.session.user.name} broadcast “${data.title}” to ${recips.length} ${audience === 'all' ? 'recipients' : audience}`, newValues: { title: data.title, audience, recipients: recips.length, in_app: inApp, emailed, texted }, ip: req.ip });
    res.json({ data: { recipients: recips.length, in_app: inApp, emailed, texted } });
  });

  // ---- Codebase guide ----------------------------------------------------
  router.get('/admin/codebase-guide', requireAuth, requireSuper, (req, res) => res.json({ data: CODEBASE_GUIDE }));

  // ---- Application logs (server runtime log — app owner only) -------------
  router.get('/admin/application-logs', requireAuth, requireSuper, (req, res) => {
    const level = String(req.query.level || 'all');
    let rows = log.recent(400);
    if (level !== 'all') rows = rows.filter((e) => e.level === level);
    res.json({ data: rows.map((e) => ({ level: e.level, timestamp: e.at, event: e.event, message: e.message || e.event, data: e.data != null ? JSON.stringify(e.data) : null })) });
  });

  // ---- Navigation settings ----------------------------------------------
  router.get('/admin/navigation', requireAuth, requireSuper, async (req, res) => {
    res.json({ data: { hidden: (await settings.get('nav_hidden', [])) || [] } });
  });
  router.put('/admin/navigation', requireAuth, requireSuper, async (req, res) => {
    const hidden = Array.isArray(req.body.hidden) ? req.body.hidden.map(String) : [];
    await settingSetJson('nav_hidden', hidden);
    await audit.from(req, { action: 'navigation.updated', description: `${req.session.user.name} updated navigation visibility (${hidden.length} hidden)` });
    res.json({ data: { hidden } });
  });

  // ---- Report configuration ---------------------------------------------
  async function reportConfig() {
    return {
      org_name: (await settings.get('report_org_name', 'University Information Technology Services')),
      title_prefix: (await settings.get('report_title_prefix', 'UITS VMTL')),
      footer: (await settings.get('report_footer', 'KNUST · University Information Technology Services')),
      default_range_days: Number(await settings.get('report_default_range_days', 30)) || 30,
      include_logo: (await settings.get('report_include_logo', '1')) !== '0',
      paper: (await settings.get('report_paper', 'A4')) || 'A4',
    };
  }
  router.get('/admin/report-config', requireAuth, requireSuper, async (req, res) => res.json({ data: await reportConfig() }));
  router.put('/admin/report-config', requireAuth, requireSuper, async (req, res) => {
    const b = req.body || {};
    await settings.set('report_org_name', String(b.org_name ?? ''));
    await settings.set('report_title_prefix', String(b.title_prefix ?? ''));
    await settings.set('report_footer', String(b.footer ?? ''));
    await settings.set('report_default_range_days', String(Number(b.default_range_days) || 30));
    await settings.set('report_include_logo', b.include_logo ? '1' : '0');
    await settings.set('report_paper', String(b.paper || 'A4'));
    await audit.from(req, { action: 'report_config.updated', description: `${req.session.user.name} updated report configuration` });
    res.json({ data: await reportConfig() });
  });

  // ---- Unified API (tokens) ---------------------------------------------
  const crypto = require('crypto');
  const API_SCOPES = ['vehicles.read', 'trips.read', 'requests.read', 'analytics.read'];
  async function apiTokens() { return (await settings.get('api_tokens', [])) || []; }
  router.get('/admin/api-tokens', requireAuth, requireSuper, async (req, res) => {
    res.json({ data: { scopes: API_SCOPES, base_url: `${req.protocol}://${req.get('host')}/api/v1`, tokens: (await apiTokens()).map((t) => ({ id: t.id, label: t.label, prefix: t.prefix, scopes: t.scopes, created_at: t.created_at, last_used_at: t.last_used_at || null })) } });
  });
  // ---- Unified API (inbound): pull live staff data for OU enrichment -------
  const unifiedApi = require('../../services/unifiedApi');
  router.get('/admin/unified-api-client', requireAuth, requireSuper, async (req, res) => res.json({ data: await unifiedApi.publicConfig() }));
  router.put('/admin/unified-api-client', requireAuth, requireSuper, async (req, res) => {
    const out = await unifiedApi.saveConfig({ url: req.body.url, key: req.body.key, enabled: req.body.enabled });
    await audit.from(req, { action: 'unified_api.configured', description: `${req.session.user.name} updated the Unified API staff connection` });
    res.json({ data: out });
  });
  router.post('/admin/unified-api-client/test', requireAuth, requireSuper, async (req, res) => {
    res.json({ data: await unifiedApi.status(req.body && req.body.sample) });
  });

  router.post('/admin/api-tokens', requireAuth, requireSuper, async (req, res) => {
    const data = validate(req.body, { label: { required: true, type: 'string', maxLength: 80 } });
    const scopes = Array.isArray(req.body.scopes) ? req.body.scopes.filter((s) => API_SCOPES.includes(s)) : API_SCOPES.slice();
    const secret = 'vmtl_' + crypto.randomBytes(24).toString('hex');
    const token = { id: crypto.randomUUID(), label: data.label, prefix: secret.slice(0, 11), hash: crypto.createHash('sha256').update(secret).digest('hex'), scopes, created_at: new Date().toISOString(), last_used_at: null };
    const tokens = await apiTokens(); tokens.push(token); await settingSetJson('api_tokens', tokens);
    await audit.from(req, { action: 'api_token.created', description: `${req.session.user.name} created API token ${data.label}` });
    res.status(201).json({ data: { id: token.id, label: token.label, token: secret, scopes } });
  });
  router.delete('/admin/api-tokens/:id', requireAuth, requireSuper, async (req, res) => {
    const tokens = await apiTokens(); const next = tokens.filter((t) => t.id !== req.params.id);
    if (next.length === tokens.length) throw notFound('Token not found.');
    await settingSetJson('api_tokens', next);
    await audit.from(req, { action: 'api_token.revoked', description: `${req.session.user.name} revoked an API token` });
    res.json({ ok: true });
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
