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
          if (provisionedId) { user = await db.get('SELECT * FROM users WHERE id = ?', [provisionedId]); ok = user && user.active; }
        }
      } catch (_) { /* directory optional */ }
    }

    if (!ok) {
      await audit.record({ actorName: email, action: 'auth.login_failed', description: `Failed sign-in for ${email}`, ip: req.ip, userAgent: req.headers['user-agent'] });
      return res.status(401).json({ error: 'Those credentials do not match our records.' });
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
};
