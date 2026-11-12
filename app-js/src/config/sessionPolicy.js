'use strict';
// Session lifetime policy, shared by the login handler (which stamps the session
// mode + cookie lifetime) and the idle-expiry middleware (which enforces it).
//
// VMTL rule (see the idle-logout-policy): sliding inactivity timeout that depends
// on how the app is being used —
//   mode 'web'                         -> 30 minutes   (IDLE_TIMEOUT_MINUTES)
//   mode 'desktop-pwa' | 'mobile-pwa'  -> 30 days       (PWA_IDLE_TIMEOUT_DAYS)
// The installed app (desktop AND mobile PWA) stays signed in as long as it is
// used within the window; the browser is held to the short office timeout. The
// clock resets on any API activity.
const IDLE_MINUTES = Number(process.env.IDLE_TIMEOUT_MINUTES || 30);   // web
const PWA_IDLE_DAYS = Number(process.env.PWA_IDLE_TIMEOUT_DAYS || 30); // installed PWA (mobile + desktop)

const WEB_IDLE_MAX_MS = 1000 * 60 * Math.max(1, IDLE_MINUTES);
const PWA_IDLE_MAX_MS = 1000 * 60 * 60 * 24 * Math.max(1, PWA_IDLE_DAYS);

const PWA_MODES = new Set(['desktop-pwa', 'mobile-pwa']);

module.exports = {
  IDLE_MINUTES,
  PWA_IDLE_DAYS,
  WEB_IDLE_MAX_MS,
  PWA_IDLE_MAX_MS,
  // Longest any session may live — used for the cookie ceiling and store TTL.
  MAX_COOKIE_MS: Math.max(WEB_IDLE_MAX_MS, PWA_IDLE_MAX_MS),
  TOUCH_MS: 1000 * 60 * 1, // throttle sliding-session writes to every 1m
  // The sliding inactivity cap for a session mode.
  idleMaxMs(mode) { return PWA_MODES.has(mode) ? PWA_IDLE_MAX_MS : WEB_IDLE_MAX_MS; },
};
