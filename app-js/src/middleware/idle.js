'use strict';
// Idle-based session expiry (sliding). Activity keeps a session alive; after a
// stretch of inactivity it is destroyed. The inactivity window depends on the
// session mode (stamped at sign-in): 30 minutes for the browser, 30 days for the
// installed PWA (desktop + mobile). Backstops the client and reclaims sessions
// orphaned by a closed tab.
const sessionPolicy = require('../config/sessionPolicy');

module.exports = function idle(req, res, next) {
  const s = req.session;
  if (!s || !s.user) return next();
  const now = Date.now();
  if (!s.createdAt) s.createdAt = now;
  if (!s.lastSeenAt) s.lastSeenAt = s.createdAt;

  const maxMs = sessionPolicy.idleMaxMs(s.mode);
  if (now - s.lastSeenAt > maxMs) {
    return s.destroy(() => {
      if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Session expired — please sign in again.' });
      return res.redirect('/login.html');
    });
  }
  // Throttle sliding-session writes, and keep the cookie lifetime in step.
  if (now - s.lastSeenAt > sessionPolicy.TOUCH_MS) {
    s.lastSeenAt = now;
    s.cookie.maxAge = maxMs;
  }
  next();
};
