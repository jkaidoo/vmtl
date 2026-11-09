'use strict';
// Idle-based session expiry (sliding). Activity keeps a session alive; after a
// stretch of inactivity it is destroyed. The installed MOBILE PWA is exempt
// (treated like a native app) — its `mode` is stamped at sign-in. Backstops the
// client-side idle timer and reclaims sessions orphaned by a closed tab.
const sessionPolicy = require('../config/sessionPolicy');

module.exports = function idle(req, res, next) {
  const s = req.session;
  if (!s || !s.user) return next();
  const now = Date.now();
  if (!s.createdAt) s.createdAt = now;
  if (!s.lastSeenAt) s.lastSeenAt = s.createdAt;

  const exempt = sessionPolicy.idleExempt(s.mode);
  const idleTooLong = !exempt && (now - s.lastSeenAt > sessionPolicy.WEB_IDLE_MAX_MS);
  // Mobile PWA: no idle logout, but a 30-day absolute re-auth cap.
  const cappedPwa = exempt && (now - s.createdAt > sessionPolicy.PWA_SESSION_MAX_MS);

  if (idleTooLong || cappedPwa) {
    return s.destroy(() => {
      if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Session expired — please sign in again.' });
      return res.redirect('/login.html');
    });
  }
  // Throttle sliding-session writes.
  if (now - s.lastSeenAt > sessionPolicy.TOUCH_MS) {
    s.lastSeenAt = now;
    if (!exempt) s.cookie.maxAge = sessionPolicy.WEB_IDLE_MAX_MS;
    else s.cookie.maxAge = sessionPolicy.PWA_SESSION_MAX_MS - (now - s.createdAt);
  }
  next();
};
