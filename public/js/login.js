'use strict';
// Login page. Detects an installed PWA (mobile vs desktop) to stamp the session
// mode for the idle policy, posts credentials, and routes to the right home.
(function () {
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('submitBtn');
  const card = form.closest('.login-wrap');
  const error = document.getElementById('loginError');
  let feedbackTimer;
  document.getElementById('copyrightYear').textContent = new Date().getFullYear();

  function deviceName() {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    if (!standalone) return 'web';
    const mobile = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
    return mobile ? 'mobile-pwa' : 'desktop-pwa';
  }

  VMTL.api('/me').then((me) => {
    if (!me?.user || me._stale || btn.disabled) return;
    document.getElementById('signInPanel').hidden = true;
    document.getElementById('welcomePanel').hidden = false;
    document.querySelector('#welcomePanel a').focus();
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearTimeout(feedbackTimer);
    card.classList.remove('login-rejected');
    error.textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await VMTL.api('/login', { method: 'POST', body: { email: document.getElementById('email').value.trim(), password: document.getElementById('password').value, device_name: deviceName() } });
      location.href = '/dashboard.html';
    } catch {
      error.textContent = 'Sign in failed.';
      card.classList.add('login-rejected');
      feedbackTimer = setTimeout(() => card.classList.remove('login-rejected'), 2000);
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
})();
