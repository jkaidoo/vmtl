'use strict';
// Session lifetime policy, shared by the login handler (which stamps the session
// mode) and the idle-expiry middleware (which enforces it).
//
// VMTL rule (see the idle-logout-policy): log out after 30 minutes of INACTIVITY
// on the web and the installed DESKTOP PWA; the installed MOBILE PWA is EXEMPT
// (treated like a native app). The sliding clock is reset by any API activity.
//   mode: 'web' | 'desktop-pwa'  -> idle enforced
//         'mobile-pwa'           -> idle NOT enforced
const IDLE_MINUTES = Number(process.env.IDLE_TIMEOUT_MINUTES || 30);

module.exports = {
  IDLE_MINUTES,
  WEB_IDLE_MAX_MS: 1000 * 60 * IDLE_MINUTES,      // web + desktop PWA: inactivity cap
  TOUCH_MS: 1000 * 60 * 1,                         // throttle sliding-session writes to every 1m
  PWA_SESSION_MAX_MS: 1000 * 60 * 60 * 24 * 30,    // mobile PWA: absolute 30-day re-auth cap
  // Modes exempt from the idle timeout.
  idleExempt(mode) { return mode === 'mobile-pwa'; },
};
