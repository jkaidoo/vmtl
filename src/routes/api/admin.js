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
const { requireAuth, requireSuper, requireSystemAdmin } = require('../../middleware/auth');
// System pages: System Administrators always, plus roles/people the App Owner shares them with (Owner page access).
const { requirePage: sharedPage, requireChannelPage: sharedChannel } = require('../../services/ownerAccess');
const { validate } = require('../../util/validate');
const { notFound, badRequest } = require('../../middleware/errorHandler');


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
  if (slug === 'architecture') return `# Technical Overview\n\n## Stack\n- **Backend:** Node.js + Express (plain JavaScript), SQLite (dev) / PostgreSQL (prod), session auth.\n- **Frontend:** Static HTML + vanilla JS + CSS (KNUST UITS design tokens), PWA.\n\n## Layers\n- **Services** hold business logic: availability, assignment, trips, analytics, maintenance alerts, directory auth, web push.\n- **Capability RBAC** (role_capabilities) is enforced server-side on every route; the break-glass System Administrator holds every capability.\n- **Notifications** fan out over in-app, email, SMS and Web Push channels.\n- **Dropdowns** (\`src/services/dropdowns.js\`): business choices are code defaults overlaid with App-Owner edits; every select and server-side validation reads the same effective list. Workflow statuses and vehicle types keep their keys.\n- **Fleet files** (\`src/services/fleetFiles.js\`): vehicle/driver photos, driver licence photos and maintenance receipts, stored in the database or on the configured file server and served only through authenticated, scoped API routes.\n- **University-wide fleet:** the \`fleet.global\` capability lifts organisational-unit scoping for the University and Schedule Transport Officer roles.\n\n## Request lifecycle\nRequest → Approval → Assignment (vehicle + driver, conflict-checked) → Trip start → Trip completion (odometer-validated) → Reporting → Analytics, with an append-only audit trail throughout.\n\n## IDL event scheduling\nEvent → Schedule (a vehicle request + trip numbered \`IDL-REQ-\` / \`IDL-TRIP-\`, conflict-checked like assignment) → Fuel purchases and expenses per schedule → Totals per schedule and per event. Rescheduling and cancelling notify the affected drivers. Fuel recorded on a schedule fixes its vehicle and driver; a cancelled schedule accepts no new costs.`;
  if (slug === 'user-guide') return `# User Guide\n\n- **Staff** submit and track vehicle requests, and cancel eligible ones.\n- **Approvers** review pending requests and approve or reject (a reason is required to reject).\n- **Transport Officers** assign a vehicle + driver, then start, end or mark trips as no-show, record fuel (station and fuel type from a list, or Other with a name) and record maintenance (provider from a list, with an optional image or PDF receipt).\n- **University Transport Officers** see every vehicle and driver across all organisational units on a fleet dashboard, and add or update vehicles and drivers (including photos and licence photos). They do nothing else; accounts and roles are assigned on Users.\n- **Schedule Transport Officers** are Transport Officers with university-wide fleet access and **IDL event scheduling**: create an event, find available fleet for a time window, pair drivers with vehicles, reschedule or cancel, and track fuel and other costs per schedule and per event.\n- **Drivers** operate their own assigned trips from a phone, and are notified when a trip (including IDL travel) is assigned, rescheduled, moved to another driver or cancelled.\n- **Supervisors** manage users and operations within their organisational unit and its sub-units.\n- **Administrators** manage users, departments, settings and the audit log.\n- The **System Administrator** holds the break-glass controls: App Health, RBAC, System Controls, Directory Auth, Database Connections, Documentation.\n- The **App Owner** can share App overview, Dropdowns, File Server and Broadcasts with chosen roles or specific people on **Owner page access**; shared pages appear in those people's menus. Backup & cleanup and Owner page access are never shared.\n- The **App Owner** additionally has the **App overview** (a live, animated tour of how the application works, its features, roles and platform) and manages Broadcasts, Backup & cleanup, **Dropdowns** (business choices; workflow statuses and vehicle types can only be relabelled) and the **File Server** (database, server folder, S3-compatible or Supabase storage, with upload limits).`;
  if (slug === 'security') return `# Security Assessment\n\nSee **Doc/SECURITY.md** for the full control inventory and its stated limits.\n\n- **Authentication:** server-side sessions (httpOnly, SameSite=strict, secure in production); the session ID is regenerated on sign-in. Passwords are hashed with bcrypt and must meet a complexity policy (min 8 chars with upper, lower, digit and symbol); users change their own via current-password-gated self-service. Failed sign-ins are recorded and an identity is locked after repeated failures.\n- **Authorisation:** capability-based RBAC enforced on every route — the UI is never the boundary. One break-glass System Administrator; organisational-unit subtree scoping. The public read API is bearer-token + per-scope gated.\n- **Data integrity:** transactions prevent double-booking; odometer readings are validated and every correction is audited. Soft deletes retain history.\n- **Auditability:** an append-only ledger records who did what, when, with IP.\n- **Owner page access:** the App Owner can share four owner pages with roles or named people; every shared page's API checks the grant on each request. Backup & cleanup and the access settings are never shareable, and changes are audited.\n- **Uploads:** file type comes from the file signature (JPEG/PNG/WebP, plus PDF for receipts), with a size cap and per-user daily allowance. Files are served only through authenticated routes that re-check scope; licence photos need driver-management rights (or the driver themselves) and receipts need maintenance rights. File-server credentials are encrypted at rest; files held outside the database are not part of database backups.\n- **Secrets:** VAPID private key and directory bind passwords are server-side, write-only, and redacted from logs and operational exports. Full database snapshots are not redacted — they retain credentials and personal data, are written owner-only (mode 0600) and require App-Owner password re-authentication to create or download, so they need operational custody.`;
  return `# UITS Vehicle Management & Trip Logging\n\nKNUST UITS system for vehicle requests, approval, assignment, trips, fuel, maintenance, reporting and analytics. See the Technical Overview for architecture and the User Guide for each role.\n\n## Stack\n- Node.js 20–22 + Express, plain JavaScript; static multi-page front-end installed as a PWA.\n- PostgreSQL: embedded (pglite) when \`DATABASE_URL\` is unset, managed PostgreSQL when set. SQLite (\`DB_RUNTIME=sqlite\`) is available for quick local work.\n\n## Setup\n- \`npm install\`, then copy \`.env.example\` to \`.env\` and set at least \`SESSION_SECRET\` (and \`DATABASE_PROFILE_ENCRYPTION_KEY\` before saving any remote file-server or database credentials).\n- \`npm start\` runs migrations, installs the fleet roles and starts the server; \`npm run dev\` restarts on changes; \`npm test\` runs the test suite.\n- In production bind \`HOST=0.0.0.0\` on the port your platform exposes.\n\n## Accounts and credentials\n- \`npm run create-admin\` (with \`ADMIN_EMAIL\`) creates or promotes the App Owner; a strong password is generated if none is given.\n- \`npm run seed\` loads demo roles, org units, fleet and accounts for development only — never seed a production database. Assign real users their roles on Users.\n- Integration secrets (email, SMS, push, directory, file server) are entered on their System pages, are write-only, and are never shown again.\n\n## Features\n- Requests, approvals, goodwill and external travel; conflict-checked assignment; live trips with added stops.\n- Fleet register with vehicle/driver photos and driver licence photos; fuel (station and fuel-type lists) and maintenance (provider list, receipts).\n- IDL event scheduling with per-schedule fuel and expenses, and driver notifications.\n- Analytics and CSV/Excel/PDF reports; in-app, push, email and SMS notifications with editable templates.\n- Capability RBAC with organisational-unit scoping and university-wide fleet roles; append-only audit log.\n- App Owner tools: App overview, Dropdowns, File Server, Broadcasts, Backup & cleanup, and Owner page access to share some of them with roles or people.`;
}

// Structured tour of the codebase for the System Administrator.
const CODEBASE_GUIDE = [
  { group: 'Overview', blurb: 'A Node.js + Express app in plain JavaScript, serving a static multi-page front-end, backed by PostgreSQL (embedded pglite in dev, managed PostgreSQL in prod). It mirrors the walkin reference architecture.', items: [
    { path: 'server.js', desc: 'Process lifecycle: run migrations, install the fleet roles, load dropdown labels, log server start, listen, graceful shutdown.' },
    { path: 'src/app.js', desc: 'Express factory — helmet CSP, sessions, idle policy, rate limits, page guards, static assets.' },
    { path: 'scripts/seed.js', desc: 'Idempotent seeder: roles, capabilities, KNUST org tree, demo fleet, drivers and trips.' },
  ] },
  { group: 'Data layer', blurb: 'One async interface over both engines so services have a single code path.', items: [
    { path: 'src/db/runtime.js', desc: 'get/all/run/transaction bridge; auto-appends RETURNING id for PostgreSQL inserts.' },
    { path: 'src/db/postgres.js', desc: 'PostgreSQL gateway — embedded pglite when no DATABASE_URL, else node-postgres.' },
    { path: 'src/db/postgresSchema.js', desc: 'Migration runner (migrations/postgres/NNN_*.sql), applied once each on boot.' },
    { path: 'src/db/migrations/postgres/008_fleet_operations.sql', desc: 'fleet_files, transport_events, event_schedules and schedule_expenses (SQLite creates the same tables on start).' },
    { path: 'src/db/sqlite.js', desc: 'Optional SQLite engine for quick local dev.' },
  ] },
  { group: 'Security & middleware', blurb: 'Capability RBAC enforced server-side on every route; the UI is never the boundary.', items: [
    { path: 'src/middleware/auth.js', desc: 'requireAuth, requireCap, requireAnyCap, requireSystemAdmin (break-glass System Administrator).' },
    { path: 'src/middleware/idle.js', desc: 'Sliding idle logout — 30 min in the browser, 30 days for the installed PWA (desktop + mobile).' },
    { path: 'src/middleware/rateLimit.js', desc: 'Per-user and per-IP request limits.' },
    { path: 'src/middleware/requestLog.js · src/util/redact.js', desc: 'API request log (method, path, status, duration — never bodies or query strings) with credential redaction for log viewers.' },
    { path: 'src/services/authz.js · orgScope.js', desc: 'Capability checks and organisational-unit subtree scoping; fleet.global lifts scoping for university-wide fleet roles.' },
    { path: 'src/services/securityAlerts.js', desc: 'Bounded alerts for suspicious sign-in patterns (e.g. success after failures, administrator lockout), emailed to configured recipients.' },
  ] },
  { group: 'Domain services', blurb: 'Business logic, one module per concern (async, over the runtime bridge).', items: [
    { path: 'src/services/assignment.js · trips.js · availability.js', desc: 'Vehicle/driver assignment with conflict checks; trip lifecycle; availability windows.' },
    { path: 'src/services/analytics.js · reports.js', desc: 'Usage analytics and CSV/XLSX/PDF report rows.' },
    { path: 'src/services/directoryAuth.js', desc: 'LDAP/AD sign-in and directory search (ldapts).' },
    { path: 'src/services/notifications.js · transports.js · webPush.js · email.js · sms.js', desc: 'In-app, Web Push, email and SMS fan-out.' },
    { path: 'src/services/messageTemplates.js · messagingConnection.js', desc: 'Editable email/SMS templates per notification type, and the saved Tekmail/mNotify connections.' },
    { path: 'src/services/dropdowns.js', desc: 'Effective dropdown choices (code defaults + App-Owner edits), shared by forms, labels and validation; "Other" resolves to a typed name.' },
    { path: 'src/services/fleetFiles.js · fileStorageConfig.js · fileStorageAdapters.js', desc: 'Photo, licence and receipt uploads: signature checks, limits, scoped access; storage in the database, a folder, S3 or Supabase with encrypted credentials.' },
    { path: 'src/services/ownerAccess.js', desc: 'Owner page access: which roles and people may open the shareable App-Owner pages; requirePage() guards their APIs.' },
    { path: 'src/services/capabilities.js · roleManagement.js · fleetSetup.js', desc: 'Capability catalogue and default roles, custom role editing, and boot-time install of the University and Schedule Transport Officer roles.' },
    { path: 'src/services/audit.js', desc: 'Append-only audit ledger — who did what, when, from where.' },
  ] },
  { group: 'API routes', blurb: 'Mounted under /api, one module per domain in src/routes/api/.', items: [
    { path: 'auth · meta · dashboard', desc: 'Sign-in/out, selectors + enums, the role-aware dashboard.' },
    { path: 'vehicle-requests · trips · vehicles · drivers', desc: 'The request-to-trip lifecycle and the fleet.' },
    { path: 'maintenance · fuel · analytics · reports · audit', desc: 'Records, insights, exports and the audit log.' },
    { path: 'event-schedules', desc: 'IDL events: availability, driver + vehicle pairing, reschedule/cancel with driver notifications, and per-schedule expenses.' },
    { path: 'fleet-operations', desc: 'File upload/serving, the App-Owner Dropdowns editor and the File Server settings, test and move.' },
    { path: 'app-overview', desc: 'Read-only live figures (usage, roles, catalogue sizes, platform) for the App Owner\'s App overview page.' },
    { path: 'owner-access', desc: 'App Owner only: read and change which roles and people may open shared owner pages (audited).' },
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
  const connections = require('../../services/messagingConnection');
  router.get('/admin/messaging/:channel/connection', requireAuth, sharedChannel, async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await connections.status(req.params.channel) });
  });
  router.put('/admin/messaging/:channel/connection', requireAuth, sharedChannel, async (req, res) => {
    const data = await connections.save(req.params.channel, req.body);
    await audit.from(req, { action: 'messaging.connection_saved', description: `Updated ${req.params.channel} connection` }); res.json({ data });
  });
  router.post('/admin/messaging/:channel/activate', requireAuth, sharedChannel, async (req, res) => {
    const data = await connections.activate(req.params.channel, req.body.enabled);
    await audit.from(req, { action: 'messaging.activation_updated', description: `${req.params.channel}: ${data.status.enabled ? 'on' : 'off'}` }); res.json({ data });
  });
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

  router.get('/admin/app-health', requireAuth, sharedPage('app-health'), async (req, res) => {
    res.json({ data: await healthData(windowFrom(req.query)) });
  });

  router.get('/admin/app-health/export', requireAuth, sharedPage('app-health'), async (req, res) => {
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
  const systemControls = require('../../services/systemControls');
  router.get('/admin/system-controls/config', requireAuth, sharedPage('system-controls'), async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await systemControls.config() });
  });
  router.put('/admin/system-controls/:section', requireAuth, sharedPage('system-controls'), async (req, res) => {
    const data = await systemControls.save(req.params.section, req.body);
    await audit.from(req, { action: 'system_controls.updated', description: `${req.session.user.name} updated ${req.params.section} controls` });
    res.json({ data });
  });
  router.get('/admin/system-controls', requireAuth, sharedPage('system-controls'), async (req, res) => res.json({ data: await systemControls.list() }));
  router.put('/admin/system-controls', requireAuth, sharedPage('system-controls'), async (req, res) => {
    const data = await systemControls.saveLegacy(req.body.settings);
    await audit.from(req, { action: 'system_controls.updated', description: `${req.session.user.name} updated system controls` });
    res.json({ data });
  });

  // ---- Directory Auth (a list of LDAP/AD directories, tried in order) -----
  const sendDirErr = (res, e) => res.status(e && e.status ? e.status : 500).json({ error: e && e.status ? e.message : 'The directory settings could not be saved.' });
  router.get('/admin/directory-auth', requireAuth, sharedPage('directory-auth'), async (req, res) => res.json({ data: {
    directories: await directoryAuth.list(), offline_days: await directoryAuth.offlineDays(), offline_days_max: directoryAuth.OFFLINE_DAYS_MAX,
  } }));
  router.get('/admin/directory-auth/activity', requireAuth, sharedPage('directory-auth'), async (req, res) => res.json({ data: await directoryAuth.activity(req.query.days, req.query) }));
  router.post('/admin/directory-auth', requireAuth, sharedPage('directory-auth'), async (req, res) => {
    try {
      const entry = await directoryAuth.create(req.body || {});
      await audit.from(req, { action: 'directory_auth.added', description: `${req.session.user.name} added directory "${entry.name}" (${entry.provider}, ${entry.url || 'no URL'})` });
      res.status(201).json({ data: { directory: entry } });
    } catch (e) { sendDirErr(res, e); }
  });
  router.put('/admin/directory-auth/order', requireAuth, sharedPage('directory-auth'), async (req, res) => {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const directories = await directoryAuth.reorder(ids);
    await audit.from(req, { action: 'directory_auth.reordered', description: `${req.session.user.name} reordered directory sign-in: ${directories.map((d) => d.name).join(', ')}` });
    res.json({ data: { directories } });
  });
  router.put('/admin/directory-auth/offline', requireAuth, sharedPage('directory-auth'), async (req, res) => {
    try {
      const days = await directoryAuth.setOfflineDays((req.body || {}).days);
      await audit.from(req, { action: 'directory_auth.updated', description: `${req.session.user.name} set directory saved sign-in to ${days ? `${days} day(s)` : 'off'}` });
      res.json({ data: { offline_days: days } });
    } catch (e) { sendDirErr(res, e); }
  });
  router.patch('/admin/directory-auth/:id', requireAuth, sharedPage('directory-auth'), async (req, res) => {
    try {
      const entry = await directoryAuth.update(req.params.id, req.body || {});
      if (!entry) return res.status(404).json({ error: 'Directory not found.' });
      await audit.from(req, { action: 'directory_auth.updated', description: `${req.session.user.name} updated directory "${entry.name}" (${entry.enabled ? 'enabled' : 'disabled'})` });
      res.json({ data: { directory: entry } });
    } catch (e) { sendDirErr(res, e); }
  });
  router.delete('/admin/directory-auth/:id', requireAuth, sharedPage('directory-auth'), async (req, res) => {
    const entry = await directoryAuth.remove(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Directory not found.' });
    await audit.from(req, { action: 'directory_auth.removed', description: `${req.session.user.name} removed directory "${entry.name}". Reason: ${String((req.body || {}).deletion_reason || '').trim().slice(0, 500)}` });
    res.json({ data: { ok: true } });
  });
  router.post('/admin/directory-auth/:id/test', requireAuth, sharedPage('directory-auth'), async (req, res) => {
    const { username, password } = req.body || {};
    const out = await directoryAuth.test(req.params.id, { username, password });
    if (!out) return res.status(404).json({ error: 'Directory not found.' });
    await audit.from(req, { action: 'directory_auth.tested', description: `${req.session.user.name} tested a directory connection — ${out.ok ? 'passed' : 'failed'}` });
    res.json({ data: out });
  });

  // ---- Messaging (email / SMS) ------------------------------------------
  const messageTemplates = require('../../services/messageTemplates');
  router.get('/admin/messaging/:channel/templates', requireAuth, sharedChannel, async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await messageTemplates.catalogue(req.params.channel) });
  });
  router.put('/admin/messaging/:channel/templates', requireAuth, sharedChannel, async (req, res) => {
    const data = await messageTemplates.save(req.params.channel, req.body.templates);
    await audit.from(req, { action: 'messaging.templates_updated', description: `${req.session.user.name} updated ${req.params.channel} message templates` });
    res.json({ data });
  });
  router.post('/admin/messaging/:channel/preview', requireAuth, sharedChannel, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await messageTemplates.render(req.params.channel, req.body.template, messageTemplates.SAMPLE, req.body.draft || {}, { preview: true }) });
  });
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
  router.post('/admin/messaging/test-email', requireAuth, sharedPage('email'), async (req, res) => {
    const to = req.body.to || req.session.user.email;
    const message = await messageTemplates.render('email', req.body.template || 'test', messageTemplates.SAMPLE, req.body.draft || {});
    const cfg = await connections.config('email');
    const result = await email.send(to, message.subject, message.text, { html: message.html, force: true, hub: true });
    await connections.recordTest('email', cfg, to, result);
    res.json({ data: result });
  });
  router.post('/admin/messaging/test-sms', requireAuth, sharedPage('sms'), async (req, res) => {
    const { to } = validate(req.body, { to: { required: true, type: 'string', maxLength: 20 } });
    const message = await messageTemplates.render('sms', req.body.template || 'test', messageTemplates.SAMPLE, req.body.draft || {});
    const cfg = await connections.config('sms');
    const result = await sms.send(to, message.text, { force: true });
    await connections.recordTest('sms', cfg, to, result);
    res.json({ data: result });
  });

  // ---- Database connections ----------------------------------------------
  router.get('/admin/database', requireAuth, sharedPage('database'), async (req, res) => {
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
  router.post('/admin/database/profiles', requireAuth, sharedPage('database'), async (req, res) => {
    const data = validate(req.body, { name: { required: true, type: 'string', maxLength: 120 }, provider: { type: 'string' }, host: { type: 'string' }, port: { type: 'string' }, database: { type: 'string' }, username: { type: 'string' }, ssl_mode: { type: 'string' }, password: { type: 'string' }, connection: { type: 'string' } });
    const p = await dbProfiles.create(data);
    await audit.from(req, { action: 'database.profile_saved', description: `${req.session.user.name} saved database profile ${data.name}` });
    res.status(201).json({ data: p });
  });
  router.put('/admin/database/profiles/:id', requireAuth, sharedPage('database'), async (req, res) => {
    const p = await dbProfiles.update(req.params.id, req.body || {}); if (!p) throw notFound('Profile not found.');
    await audit.from(req, { action: 'database.profile_saved', description: `${req.session.user.name} updated database profile ${p.name}` });
    res.json({ data: p });
  });
  router.delete('/admin/database/profiles/:id', requireAuth, sharedPage('database'), async (req, res) => {
    if (!(await dbProfiles.remove(req.params.id))) throw notFound('Profile not found.');
    await audit.from(req, { action: 'database.profile_removed', description: `${req.session.user.name} removed a database profile` });
    res.json({ ok: true });
  });
  router.post('/admin/database/profiles/:id/test', requireAuth, sharedPage('database'), async (req, res) => {
    const result = await dbProfiles.test(req.params.id);
    await audit.from(req, { action: 'database.profile_tested', description: `${req.session.user.name} tested a database profile — ${result.ok ? 'connected' : 'failed'}` });
    res.json({ data: result });
  });
  router.post('/admin/database/profiles/:id/select', requireAuth, sharedPage('database'), async (req, res) => { await dbProfiles.select(req.params.id); res.json({ ok: true }); });
  router.post('/admin/database/migrate', requireAuth, sharedPage('database'), async (req, res) => {
    const id = req.body.profile_id; if (!id) throw badRequest('Select a migration target first.');
    if (String(req.body.confirmation || '').toUpperCase() !== 'MIGRATE') throw badRequest('Type MIGRATE to confirm.');
    const out = await dbProfiles.migrate(id);
    await audit.from(req, { action: 'database.migrated', description: `${req.session.user.name} copied the data store into a PostgreSQL target` });
    res.json({ data: out });
  });

  // ---- Documentation -----------------------------------------------------
  router.get('/admin/documentation', requireAuth, sharedPage('documentation'), (req, res) => {
    res.json({ data: Object.entries(DOCS).map(([slug, m]) => ({ slug, title: m.title, summary: m.summary })) });
  });
  router.get('/admin/documentation/:slug', requireAuth, sharedPage('documentation'), (req, res) => {
    const meta = DOCS[req.params.slug];
    if (!meta) throw notFound('Document not found.');
    res.json({ data: { slug: req.params.slug, title: meta.title, content: docContent(req.params.slug) } });
  });

  // ---- Broadcasts --------------------------------------------------------
  // Broadcasts: App Owner, or roles/people the owner shares the page with.
  const broadcastsPage = require('../../services/ownerAccess').requirePage('broadcasts');
  router.get('/admin/broadcasts', requireAuth, broadcastsPage, async (req, res) => {
    const rows = await db.all("SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action = 'broadcast.sent' ORDER BY a.created_at DESC, a.id DESC LIMIT 40", []);
    res.json({ data: rows.map((a) => ({ id: a.id, description: a.description, by: a.user_name, created_at: a.created_at, meta: a.new_values ? JSON.parse(a.new_values) : null })) });
  });
  router.post('/admin/broadcasts', requireAuth, broadcastsPage, async (req, res) => {
    const data = validate(req.body, { title: { required: true, type: 'string', maxLength: 160 }, message: { required: true, type: 'string', maxLength: 2000 }, audience: { type: 'string', maxLength: 40 } });
    const audience = String(req.body.audience || 'all');
    const ch = req.body.channels || {};
    const recips = audience === 'all'
      ? await db.all('SELECT id, email, phone, name FROM users WHERE active = 1 AND deleted_at IS NULL')
      : await db.all('SELECT u.id, u.email, u.phone, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = ? AND u.active = 1 AND u.deleted_at IS NULL', [audience]);
    let inApp = 0; let emailed = 0; let texted = 0;
    for (const u of recips) {
      if (ch.in_app !== false) { try { await notifications.toUser(u.id, 'broadcast', { title: data.title, message: data.message }); inApp++; } catch (_) { /* skip */ } }
      if (ch.email && u.email) { try { const message = await messageTemplates.render('email', 'broadcast', { recipient_name: u.name, title: data.title, message: data.message }); const r = await email.send(u.email, message.subject, message.text, { html: message.html }); if (r && r.ok) emailed++; } catch (_) { /* skip */ } }
      if (ch.sms && u.phone) { try { const message = await messageTemplates.render('sms', 'broadcast', { recipient_name: u.name, title: data.title, message: data.message }); const r = await sms.send(u.phone, message.text); if (r && r.ok) texted++; } catch (_) { /* skip */ } }
    }
    await audit.record({ userId: req.session.user.id, actorName: req.session.user.name, action: 'broadcast.sent', description: `${req.session.user.name} broadcast “${data.title}” to ${recips.length} ${audience === 'all' ? 'recipients' : audience}`, newValues: { title: data.title, audience, recipients: recips.length, in_app: inApp, emailed, texted }, ip: req.ip });
    res.json({ data: { recipients: recips.length, in_app: inApp, emailed, texted } });
  });

  // ---- Codebase guide ----------------------------------------------------
  router.get('/admin/codebase-guide', requireAuth, sharedPage('codebase-guide'), (req, res) => res.json({ data: CODEBASE_GUIDE }));

  // ---- Application logs (server runtime log — app owner only) -------------
  router.get('/admin/application-logs', requireAuth, sharedPage('app-health'), (req, res) => {
    const level = String(req.query.level || 'all');
    const all = log.recent(500);
    let rows = all;
    if (level !== 'all') rows = rows.filter(e => e.level === level);
    if (req.query.category) rows = rows.filter(e => e.category === req.query.category);
    if (req.query.search) { const term = String(req.query.search).toLowerCase(); rows = rows.filter(e => JSON.stringify(e).toLowerCase().includes(term)); }
    if (req.query.date_from) rows = rows.filter(e => e.at.slice(0,10) >= String(req.query.date_from).slice(0,10));
    if (req.query.date_to) rows = rows.filter(e => e.at.slice(0,10) <= String(req.query.date_to).slice(0,10));
    const total = rows.length, size = Math.min(100, Math.max(1, parseInt(req.query.per_page,10) || 10));
    const last = Math.max(1, Math.ceil(total / size)), page = Math.min(last, Math.max(1, parseInt(req.query.page,10) || 1));
    res.set('Cache-Control', 'no-store');
    res.json({ data: rows.slice((page - 1) * size, page * size).map(e => {
      const { id, category, level, at, event, message, ...context } = e;
      return { id, category, level, timestamp: at, event, message: message || event, fields: context, data: Object.keys(context).length ? JSON.stringify(context) : null };
    }), meta: { current_page: page, per_page: size, total, last_page: last }, counts: all.reduce((out, e) => { out[e.level] = (out[e.level] || 0) + 1; return out; }, {}), store: log.infoAboutStore(), retention: 'Latest 500 events from the current server process' });
  });
  router.get('/admin/application-logs/:id', requireAuth, sharedPage('app-health'), (req, res) => {
    const entry = log.find(req.params.id);
    if (!entry) throw notFound('This log entry is no longer available. It may have expired or the server restarted.');
    res.set('Cache-Control', 'no-store'); res.json({ data: entry });
  });
  const securityAlerts = require('../../services/securityAlerts');
  router.get('/admin/security-alerts', requireAuth, sharedPage('system-controls'), async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await securityAlerts.status() });
  });
  router.put('/admin/security-alerts', requireAuth, sharedPage('system-controls'), async (req, res) => {
    const data = await securityAlerts.save(req.body);
    await audit.from(req, { action: 'security.alert_settings_updated', description: data.enabled ? 'Enabled suspicious activity emails' : 'Disabled suspicious activity emails' });
    res.json({ data });
  });

  // ---- Navigation settings ----------------------------------------------
  const navigation = require('../../services/navigation');
  router.get('/admin/navigation', requireAuth, sharedPage('navigation'), async (req, res) => {
    res.json({ data: { hidden: (await settings.get('nav_hidden', [])) || [], roles: await navigation.contexts(), pages: navigation.pages.map(({ key, label, section }) => ({ key, label, section })) } });
  });
  router.get('/admin/navigation/:role', requireAuth, sharedPage('navigation'), async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.json({ data: await navigation.editor(req.params.role) });
  });
  router.put('/admin/navigation/:role', requireAuth, sharedPage('navigation'), async (req, res) => {
    const data = await navigation.save(req.params.role, req.body);
    await audit.from(req, { action: 'navigation.updated', description: `${req.session.user.name} updated navigation layout for ${req.params.role}` });
    res.json({ data });
  });
  router.put('/admin/navigation', requireAuth, sharedPage('navigation'), async (req, res) => {
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
  router.get('/admin/report-config', requireAuth, sharedPage('report-config'), async (req, res) => res.json({ data: await reportConfig() }));
  router.put('/admin/report-config', requireAuth, sharedPage('report-config'), async (req, res) => {
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
  router.get('/admin/api-tokens', requireAuth, sharedPage('unified-api'), async (req, res) => {
    res.json({ data: { scopes: API_SCOPES, base_url: `${req.protocol}://${req.get('host')}/api/v1`, tokens: (await apiTokens()).map((t) => ({ id: t.id, label: t.label, prefix: t.prefix, scopes: t.scopes, created_at: t.created_at, last_used_at: t.last_used_at || null })) } });
  });
  // ---- Unified API (inbound): pull live staff data for OU enrichment -------
  const unifiedApi = require('../../services/unifiedApi');
  router.get('/admin/unified-api-client/photo/:id', requireAuth, sharedPage('unified-api'), async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const photo = await unifiedApi.staffPhoto(req.params.id);
    if (!photo) return res.status(404).end();
    const [, type, data] = photo.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(data, 'base64'));
  });
  const unifiedConsole = require('../../services/unifiedApiConsole');
  const consoleGet = (path, fn) => router.get(`/admin/unified-api-console/${path}`, requireAuth, sharedPage('unified-api'), async (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ data: await fn(req) }); });
  const consoleWrite = (method, path, fn) => router[method](`/admin/unified-api-console/${path}`, requireAuth, sharedPage('unified-api'), async (req, res) => {
    const data = await fn(req);
    if (method === 'put') await audit.from(req, { action: 'unified_api.configured', description: `${req.session.user.name} updated Unified API ${path}` });
    res.set('Cache-Control', 'no-store'); res.json({ data });
  });
  consoleGet('settings', async () => ({ settings: await unifiedConsole.publicSettings(), fields: await unifiedConsole.fieldSettings() }));
  consoleGet('status', () => unifiedConsole.status());
  consoleWrite('put', 'settings', (req) => unifiedConsole.saveSettings(req.body));
  consoleWrite('put', 'fields', (req) => unifiedConsole.saveFieldSettings(req.body));
  consoleWrite('put', 'field-label', (req) => unifiedConsole.saveFieldLabel(req.body));
  consoleWrite('put', 'field-order', (req) => unifiedConsole.saveFieldOrder(req.body));
  consoleWrite('post', 'test-staff-search', (req) => unifiedConsole.testStaffSearch(req.body.q));
  consoleWrite('post', 'test-lookup', (req) => unifiedConsole.testLookup(req.body.id, { source: req.body.source }));
  router.put('/admin/unified-api-client/fields', requireAuth, sharedPage('unified-api'), async (req, res) => {
    const fields = await unifiedApi.saveFields(req.body.fields);
    await audit.from(req, { action: 'unified_api.fields_configured', description: `${req.session.user.name} updated Unified API staff data fields` });
    res.json({ data: { fields } });
  });
  router.get('/admin/unified-api-client/search', requireAuth, sharedPage('unified-api'), async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2 || q.length > 100) return res.status(400).json({ error: 'Enter a name, staff ID or email between 2 and 100 characters.' });
    res.json({ data: await unifiedApi.manualSearch(q) });
  });
  router.get('/admin/unified-api-client/profile/:id', requireAuth, sharedPage('unified-api'), async (req, res) => {
    res.json({ data: await unifiedApi.manualProfile(req.params.id) });
  });
  router.get('/admin/unified-api-client', requireAuth, sharedPage('unified-api'), async (req, res) => res.json({ data: await unifiedApi.publicConfig() }));
  router.put('/admin/unified-api-client', requireAuth, sharedPage('unified-api'), async (req, res) => {
    const out = await unifiedApi.saveConfig({ url: req.body.url, key: req.body.key, enabled: req.body.enabled });
    await audit.from(req, { action: 'unified_api.configured', description: `${req.session.user.name} updated the Unified API staff connection` });
    res.json({ data: out });
  });
  router.post('/admin/unified-api-client/test', requireAuth, sharedPage('unified-api'), async (req, res) => {
    res.json({ data: await unifiedApi.status(req.body && req.body.sample) });
  });

  router.post('/admin/api-tokens', requireAuth, sharedPage('unified-api'), async (req, res) => {
    const data = validate(req.body, { label: { required: true, type: 'string', maxLength: 80 } });
    const scopes = Array.isArray(req.body.scopes) ? req.body.scopes.filter((s) => API_SCOPES.includes(s)) : API_SCOPES.slice();
    const secret = 'vmtl_' + crypto.randomBytes(24).toString('hex');
    const token = { id: crypto.randomUUID(), label: data.label, prefix: secret.slice(0, 11), hash: crypto.createHash('sha256').update(secret).digest('hex'), scopes, created_at: new Date().toISOString(), last_used_at: null };
    const tokens = await apiTokens(); tokens.push(token); await settingSetJson('api_tokens', tokens);
    await audit.from(req, { action: 'api_token.created', description: `${req.session.user.name} created API token ${data.label}` });
    res.status(201).json({ data: { id: token.id, label: token.label, token: secret, scopes } });
  });
  router.delete('/admin/api-tokens/:id', requireAuth, sharedPage('unified-api'), async (req, res) => {
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
