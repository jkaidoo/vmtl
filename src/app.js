'use strict';

// Express application factory. server.js owns the process lifecycle; this module
// builds the request stack (helmet CSP, sessions, idle expiry, rate limits, the
// API, page guards and fingerprinted static assets) so tests exercise exactly
// what production serves. Mirrors the walkin reference architecture.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');

const { asyncSafe } = require('./middleware/asyncSafe');
const errorHandler = require('./middleware/errorHandler');
const rateLimit = require('./middleware/rateLimit');
const idle = require('./middleware/idle');
const requestId = require('./middleware/requestId');
const staticAssets = require('./staticAssets');
const sessionPolicy = require('./config/sessionPolicy');
const runtime = require('./db/runtime');
const roles = require('./services/roles');
const roleRepository = require('./services/roleRepository');
const log = require('./util/log');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Pages a requester-only (Staff) user may open; everything else sends them home.
const REQUESTER_ALLOWED = new Set(['/dashboard.html', '/requests.html', '/request-create.html', '/request-detail.html', '/trips.html', '/goodwill.html', '/availability.html', '/faqs.html', '/how-it-works.html']);
// App-Owner-only pages (is_super_admin).
const APP_OWNER_PAGES = new Set(['/broadcasts.html', '/backup-cleanup.html']);
// System section pages — the App Owner or a System Administrator (system.admin).
const SYSTEM_PAGES = new Set(['/app-health.html', '/rbac.html', '/system-controls.html', '/directory-auth.html', '/maps-config.html', '/messaging.html', '/sms.html', '/email.html', '/unified-api.html', '/report-configuration.html', '/navigation-settings.html', '/database-connections.html', '/documentation.html', '/codebase-guide.html']);
// Public pages (no sign-in).
const PUBLIC_PAGES = new Set(['/login.html', '/404.html', '/500.html', '/offline.html']);

const dbHealth = { ok: true, at: 0, error: null };
async function checkDatabase() {
  try { await runtime.get('SELECT 1 AS ok'); dbHealth.ok = true; dbHealth.error = null; }
  catch (err) { dbHealth.ok = false; dbHealth.error = err.message; }
  dbHealth.at = Date.now();
  return dbHealth.ok;
}

// Hash first-party inline <script> blocks so the CSP can forbid inline scripts
// in general while still allowing ours (line endings normalised like browsers).
function inlineScriptHashes() {
  const set = new Set();
  try {
    for (const f of fs.readdirSync(PUBLIC_DIR)) {
      if (!f.endsWith('.html')) continue;
      const html = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
      const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = re.exec(html))) { if (m[1].trim()) set.add(`'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`); }
    }
  } catch (_) { /* fall back to 'self' */ }
  return [...set];
}

const DEFAULT_SESSION_SECRET = 'dev-secret-change-me';
function sessionSecret(env = process.env) {
  const secret = String(env.SESSION_SECRET || '');
  if (env.NODE_ENV !== 'production') return secret || DEFAULT_SESSION_SECRET;
  if (!secret || secret === DEFAULT_SESSION_SECRET) throw new Error('SESSION_SECRET is not set (or is the default). Set a long random value before starting in production.');
  if (secret.length < 32) log.warn('config_session_secret_short', { hint: 'Use at least 32 random characters for SESSION_SECRET' });
  return secret;
}

function createSessionStore() {
  if (runtime.sessionMode() === 'postgres') {
    const RuntimeStore = require('./middleware/sessionStore');
    return new RuntimeStore({ ttlMs: sessionPolicy.MAX_COOKIE_MS });
  }
  const SqliteStore = require('better-sqlite3-session-store')(session);
  return new SqliteStore({ client: require('./db/sqlite'), expired: { clear: true, intervalMs: 15 * 60 * 1000 } });
}

function createApp({ sessionStore, apiRouter = require('./routes/api') } = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const secret = sessionSecret();
  const app = asyncSafe(express());
  const assets = staticAssets.build(PUBLIC_DIR);
  app.locals.assets = assets;
  app.locals.dbHealth = dbHealth;

  if (isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestId);
  // Google Maps JavaScript API endpoints (Live Map). The Maps JS key is a
  // referrer-restricted client key, so the script, its tiles/markers and its
  // XHRs must be allow-listed here while the rest of the CSP stays locked down.
  const GMAPS = ['https://maps.googleapis.com', 'https://maps.gstatic.com'];
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScriptHashes(), 'https://maps.googleapis.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', ...GMAPS, 'https://*.googleapis.com', 'https://*.ggpht.com', 'https://*.google.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", ...GMAPS, 'https://*.googleapis.com'],
      workerSrc: ["'self'", 'blob:'],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    } },
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  }));

  app.get('/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ok = await checkDatabase();
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'error', time: new Date().toISOString(), data_store: runtime.mode() });
  });
  app.get('/api/ping', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const fresh = Date.now() - dbHealth.at < 30_000;
    res.status(dbHealth.ok && fresh ? 200 : 503).json({ status: dbHealth.ok && fresh ? 'ok' : 'error' });
  });

  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(session({
    store: sessionStore || createSessionStore(),
    secret,
    resave: false, rolling: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: isProd, maxAge: sessionPolicy.MAX_COOKIE_MS },
  }));
  app.use(idle);

  // Rate limits: per-user when signed in, per-IP otherwise, plus an IP backstop.
  const perUser = Number(process.env.RATE_LIMIT_USER_PER_MIN || 1200);
  const perIp = Number(process.env.RATE_LIMIT_IP_PER_MIN || 2000);
  app.use('/api', rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_IP_BACKSTOP_PER_MIN || 12000), key: rateLimit.ip, message: 'Too many requests from this network. Please try again shortly.' }));
  app.use('/api', rateLimit({ windowMs: 60_000, max: (req) => (req.session && req.session.user ? perUser : perIp), key: rateLimit.userOrIp }));

  app.use('/api', require('./middleware/idempotency'));
  app.use('/api', apiRouter);

  // ---- Page guards --------------------------------------------------------
  const caps = async (req) => (req.session.user.is_super_admin ? ['*'] : roleRepository.capsForUser(req.session.user.id));
  const page = (name) => (req, res) => assets.sendPage(res, name);

  app.get(['/', '/index.html'], async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/login.html');
    return res.redirect(roles.homePage(req.session.user.is_super_admin ? ['*'] : await caps(req)));
  });

  // Guard every .html page (except public ones) after the session is available.
  app.get('*.html', async (req, res, next) => {
    const name = req.path.replace(/^\//, '');
    if (PUBLIC_PAGES.has(req.path)) return next();
    if (!req.session || !req.session.user) return res.redirect('/login.html');
    const user = req.session.user;
    if (APP_OWNER_PAGES.has(req.path) && !user.is_super_admin) return res.redirect(roles.homePage(await caps(req)));
    if (SYSTEM_PAGES.has(req.path) && !user.is_super_admin) {
      const held = await roleRepository.capsForUser(user.id);
      if (!held.includes('system.admin')) return res.redirect(roles.homePage(held));
    }
    if (!user.is_super_admin) {
      const held = await roleRepository.capsForUser(user.id);
      if (roles.isRequesterOnly(held) && !REQUESTER_ALLOWED.has(req.path)) return res.redirect(roles.homePage(held));
    }
    if (assets.pages.has(name)) return assets.sendPage(res, name);
    return next();
  });

  // Static assets: versioned => immutable; else revalidate. Then public files.
  app.use(assets.cacheHeaders);
  app.use(assets.htmlPages);
  app.use(express.static(PUBLIC_DIR, { cacheControl: false, index: false }));

  // Not found: JSON for the API, the branded 404 page otherwise.
  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    return assets.sendPage(res, '404.html', 404);
  });
  app.use(errorHandler);
  return app;
}

module.exports = { createApp, checkDatabase, dbHealth, sessionSecret, createSessionStore, PUBLIC_DIR };
