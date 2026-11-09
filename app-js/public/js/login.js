'use strict';
// Login page. Detects an installed PWA (mobile vs desktop) to stamp the session
// mode for the idle policy, posts credentials, and routes to the right home.
(function () {
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('submitBtn');

  function deviceName() {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (!standalone) return 'web';
    const mobile = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
    return mobile ? 'mobile-pwa' : 'desktop-pwa';
  }

  // If already signed in, skip the form.
  VMTL.api('/me').then((me) => { if (me && me.user) location.href = me.user.requester_only ? '/requests.html' : '/dashboard.html'; }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await VMTL.api('/login', { method: 'POST', body: { email: document.getElementById('email').value.trim(), password: document.getElementById('password').value, device_name: deviceName() } });
      location.href = res.user.requester_only ? '/requests.html' : '/dashboard.html';
    } catch (err) {
      VMTL.toast(err.message || 'Those credentials do not match our records.', 'err');
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
})();
