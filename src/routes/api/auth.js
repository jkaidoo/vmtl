'use strict';
// Authentication: local-first sign-in (directory/LDAP fallback added later),
// session lifecycle, the current-user endpoint and avatar upload.
const db = require('../../db/runtime');
const { verifyPassword } = require('../../util/password');
const { userForClient, sessionSnapshot } = require('../../services/serializers');
const { requireAuth } = require('../../middleware/auth');
const audit = require('../../services/audit');
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
      await audit.record({ actorName: email, action: 'auth.login_failed', description: `Failed sign-in for ${email}`, ip: req.ip, userAgent: req.headers['user-agent'] });
      return res.status(401).json({ error: 'Those credentials do not match our records.' });
    }

    // Two-factor: when enabled for this account, a valid TOTP (or recovery) code
    // is required before a session is created.
    if (user.totp_enabled) {
      const code = String(req.body.otp || req.body.code || '').trim();
      if (!code) return res.json({ mfa_required: true });
      const totp = require('../../services/totp');
      let codeOk = totp.verify(user.totp_secret, code);
      if (!codeOk && code.includes('-')) {
        let recovery = []; try { recovery = JSON.parse(user.totp_recovery || '[]'); } catch (_) { recovery = []; }
        const h = totp.hashCode(code);
        if (recovery.includes(h)) { codeOk = true; await db.run('UPDATE users SET totp_recovery = ? WHERE id = ?', [JSON.stringify(recovery.filter((x) => x !== h)), user.id]); }
      }
      if (!codeOk) {
        await audit.record({ userId: user.id, actorName: user.name, action: 'auth.mfa_failed', description: `Failed 2FA for ${user.name}`, ip: req.ip, userAgent: req.headers['user-agent'] });
        return res.status(401).json({ error: 'That verification code is not valid.' });
      }
    }

    const mode = sessionModeFor(req.body.device_name);
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

  router.post('/me/avatar', requireAuth, async (req, res) => {
    const avatar = req.body.avatar;
    if (avatar != null && (typeof avatar !== 'string' || avatar.length > 2_000_000)) throw badRequest('Invalid avatar.');
    await db.run(`UPDATE users SET avatar = ?, updated_at = ${db.now()} WHERE id = ?`, [avatar || null, req.session.user.id]);
    res.json({ user: await userForClient(req.session.user.id) });
  });

  // ---- Two-factor sign-in (TOTP), self-service -----------------------------
  const totp = require('../../services/totp');
  router.get('/me/2fa', requireAuth, async (req, res) => {
    const u = await db.get('SELECT totp_enabled FROM users WHERE id = ?', [req.session.user.id]);
    res.json({ data: { enabled: !!(u && u.totp_enabled) } });
  });
  router.post('/me/2fa/setup', requireAuth, async (req, res) => {
    const secret = totp.generateSecret();
    await db.run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, req.session.user.id]);
    res.json({ data: { secret, otpauth_url: totp.otpauthUrl(secret, req.session.user.email || `user-${req.session.user.id}`) } });
  });
  router.post('/me/2fa/enable', requireAuth, async (req, res) => {
    const u = await db.get('SELECT totp_secret FROM users WHERE id = ?', [req.session.user.id]);
    if (!u || !u.totp_secret) throw badRequest('Start the 2FA setup first.');
    if (!totp.verify(u.totp_secret, req.body.code)) throw badRequest('That code is not valid — check your authenticator and try again.', { code: ['Invalid code.'] });
    const codes = totp.generateRecoveryCodes();
    await db.run('UPDATE users SET totp_enabled = 1, totp_recovery = ? WHERE id = ?', [JSON.stringify(codes.map(totp.hashCode)), req.session.user.id]);
    await audit.from(req, { action: 'auth.mfa_enabled', description: `${req.session.user.name} turned on two-factor sign-in` });
    res.json({ data: { enabled: true, recovery_codes: codes } });
  });
  router.post('/me/2fa/disable', requireAuth, async (req, res) => {
    const u = await db.get('SELECT password_hash, totp_secret FROM users WHERE id = ?', [req.session.user.id]);
    const code = String(req.body.code || '').trim();
    const pw = String(req.body.password || '');
    const okCode = code && totp.verify(u.totp_secret, code);
    const okPw = pw && u.password_hash && require('../../util/password').verifyPassword(pw, u.password_hash);
    if (!okCode && !okPw) throw badRequest('Enter a current code or your password to turn off 2FA.', { code: ['Required.'] });
    await db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = NULL WHERE id = ?', [req.session.user.id]);
    await audit.from(req, { action: 'auth.mfa_disabled', description: `${req.session.user.name} turned off two-factor sign-in` });
    res.json({ data: { enabled: false } });
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
