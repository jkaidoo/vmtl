'use strict';
// Authentication: local-first sign-in (directory/LDAP fallback added later),
// session lifecycle, the current-user endpoint and avatar upload.
const db = require('../../db/runtime');
const { verifyPassword, hashPassword, passwordProblems } = require('../../util/password');
const { userForClient, sessionSnapshot } = require('../../services/serializers');
const { requireAuth } = require('../../middleware/auth');
const audit = require('../../services/audit');
const securityAlerts = require('../../services/securityAlerts');
const sessionPolicy = require('../../config/sessionPolicy');
const { badRequest } = require('../../middleware/errorHandler');

// Map the client-declared device to a session mode (drives the idle policy).
function sessionModeFor(deviceName) {
  const d = String(deviceName || '').toLowerCase();
  if (d === 'mobile-pwa') return 'mobile-pwa';
  if (d === 'desktop-pwa') return 'desktop-pwa';
  return 'web';
}

module.exports = function register(router) {
  router.post('/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) throw badRequest('Email and password are required.', { email: !email ? ['Required'] : undefined, password: !password ? ['Required'] : undefined });

    // Brute-force guard: too many recent failures for this identity → make them wait.
    const LOCK_THRESHOLD = Number(process.env.LOGIN_LOCK_THRESHOLD || 8);
    const LOCK_WINDOW_MIN = Number(process.env.LOGIN_LOCK_WINDOW_MIN || 15);
    const windowStart = new Date(Date.now() - LOCK_WINDOW_MIN * 60000).toISOString().slice(0, 19).replace('T', ' ');
    const recentFails = (await db.get("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.login_failed' AND lower(actor_name) = ? AND created_at >= ?", [email, windowStart])).n;
    if (recentFails >= LOCK_THRESHOLD) {
      securityAlerts.loginFailure(email, req.ip);
      const locked = await db.get('SELECT id, role_id, is_super_admin FROM users WHERE lower(email)=? AND deleted_at IS NULL', [email]);
      if (locked && (locked.is_super_admin || (await require('../../services/roleRepository').capsForUser(locked.id)).includes('system.admin'))) securityAlerts.background(securityAlerts.alert('administrator_locked', 'An administrator account was temporarily locked after failed sign-ins.', { user_id: locked.id, ip: req.ip }, `locked:${locked.id}`));
      return res.status(429).json({ error: `Too many failed sign-in attempts. Please wait ${LOCK_WINDOW_MIN} minutes and try again.` });
    }

    // Local-first: match a local account by email (or bare username via email local-part).
    let user = await db.get('SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL', [email]);
    let ok = user && user.active && verifyPassword(password, user.password_hash);

    // Directory (LDAP/AD) fallback when local auth fails and directory auth is enabled.
    // Never overrides the break-glass super admin, who always authenticates locally.
    if (!ok && (!user || !user.is_super_admin)) {
      try {
        const directoryAuth = require('../../services/directoryAuth');
        if (await directoryAuth.isEnabled()) {
          const provisionedId = await directoryAuth.authenticate(req.body.email || email, password);
          if (provisionedId) {
            // Enrich the staff from the Unified API (OU + attributes); best-effort.
            try { await require('../../services/staffSync').syncUser(provisionedId, req.body.email || email); } catch (_) { /* never blocks sign-in */ }
            user = await db.get('SELECT * FROM users WHERE id = ?', [provisionedId]); ok = user && user.active;
          }
        }
      } catch (_) { /* directory optional */ }
    }

    if (!ok) {
      securityAlerts.loginFailure(email, req.ip);
      await audit.record({ actorName: email, action: 'auth.login_failed', description: `Failed sign-in for ${email}`, ip: req.ip, userAgent: req.headers['user-agent'] });
      if (recentFails + 1 >= LOCK_THRESHOLD && user && (user.is_super_admin || (await require('../../services/roleRepository').capsForUser(user.id)).includes('system.admin'))) securityAlerts.background(securityAlerts.alert('administrator_locked', 'An administrator account was temporarily locked after failed sign-ins.', { user_id: user.id, ip: req.ip }, `locked:${user.id}`));
      return res.status(401).json({ error: 'Those credentials do not match our records.' });
    }

    const mode = sessionModeFor(req.body.device_name);
    securityAlerts.loginSuccess(email, req.ip);
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.user = sessionSnapshot(user);
    req.session.mode = mode;
    req.session.createdAt = Date.now();
    req.session.lastSeenAt = Date.now();
    req.session.cookie.maxAge = sessionPolicy.idleMaxMs(mode); // 30 min web, 30 days installed PWA
    await db.run(`UPDATE users SET last_login_at = ${db.now()} WHERE id = ?`, [user.id]);
    await audit.record({ userId: user.id, actorName: user.name, action: 'auth.login', description: `${user.name} signed in (${mode})`, ip: req.ip, userAgent: req.headers['user-agent'] });

    const dto = await userForClient(user.id);
    return res.json({ user: dto });
  });

  router.post('/logout', requireAuth, async (req, res) => {
    const user = req.session.user;
    await audit.record({ userId: user.id, actorName: user.name, action: 'auth.logout', description: `${user.name} signed out`, ip: req.ip, userAgent: req.headers['user-agent'] });
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get('/me', requireAuth, async (req, res) => {
    const dto = await userForClient(req.session.user.id);
    if (!dto) { return req.session.destroy(() => res.status(401).json({ error: 'Not authenticated' })); }
    res.json({ user: dto });
  });

  // Self-service password change. Requires the current password, an active local
  // account and a new password that meets the complexity policy and differs from
  // the current one. Directory accounts manage their password in the directory.
  router.post('/me/password', requireAuth, async (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const user = await db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.session.user.id]);
    if (!user || !user.active) return req.session.destroy(() => res.status(401).json({ error: 'Not authenticated' }));
    if (!user.password_hash) throw badRequest('Your password is managed by your directory sign-in. Change it there.');
    if (!verifyPassword(current, user.password_hash)) throw badRequest('The given data was invalid.', { current_password: ['That does not match your current password.'] });
    const problems = passwordProblems(next);
    if (problems.length) throw badRequest('The given data was invalid.', { new_password: problems });
    if (verifyPassword(next, user.password_hash)) throw badRequest('The given data was invalid.', { new_password: ['Choose a password different from your current one.'] });
    await db.run(`UPDATE users SET password_hash = ?, updated_at = ${db.now()} WHERE id = ?`, [hashPassword(next), user.id]);
    await audit.record({ userId: user.id, actorName: user.name, action: 'auth.password_changed', description: `${user.name} changed their password`, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.json({ ok: true });
  });

  router.post('/me/avatar', requireAuth, async (req, res) => {
    const avatar = req.body.avatar;
    if (avatar != null && (typeof avatar !== 'string' || avatar.length > 2_000_000)) throw badRequest('Invalid avatar.');
    await db.run(`UPDATE users SET avatar = ?, updated_at = ${db.now()} WHERE id = ?`, [avatar || null, req.session.user.id]);
    res.json({ user: await userForClient(req.session.user.id) });
  });

  // ---- Active sessions (your signed-in devices) ----------------------------
  const sessionAdmin = require('../../services/sessionAdmin');
  router.get('/me/sessions', requireAuth, async (req, res) => {
    const list = await sessionAdmin.forUser(req.session.user.id);
    res.json({ data: list.map((s) => ({ sid: s.sid, mode: s.mode, created_at: s.created_at, last_seen_at: s.last_seen_at, current: s.sid === req.sessionID })) });
  });
  router.delete('/me/sessions/:sid', requireAuth, async (req, res) => {
    if (req.params.sid === req.sessionID) return res.status(400).json({ error: 'Use Sign out to end the session you are on.' });
    await sessionAdmin.revoke(req.params.sid, req.session.user.id);
    await audit.from(req, { action: 'auth.session_revoked', description: `${req.session.user.name} signed out another device` });
    res.json({ ok: true });
  });
};
