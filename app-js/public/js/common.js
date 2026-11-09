'use strict';
/* Shared frontend runtime for every page: API client (session cookie), auth +
 * meta bootstrap, the capability-gated shell (sidebar/topbar/bottom-nav),
 * theming, toasts, modals, and KNUST-standard formatting. Pages call
 * `VMTL.boot('<navKey>')`, then render into `VMTL.view`. */
(function () {
  const VMTL = { user: null, meta: null, view: null, caps: [] };
  window.VMTL = VMTL;

  // ---- helpers ----------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  VMTL.esc = esc; VMTL.el = el;

  // ---- formatting (ports lib/format.ts) --------------------------------
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parse = (v) => { if (!v) return null; const d = new Date(String(v).replace(' ', 'T')); return isNaN(d) ? null : d; };
  const pad = (n, w = 2) => String(Math.max(0, n)).padStart(w, '0');
  VMTL.fmtDate = (v) => { const d = parse(v); return d ? `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—'; };
  VMTL.fmtDateTime = (v) => { const d = parse(v); return d ? `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—'; };
  VMTL.fmtTime = (v) => { const d = parse(v); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—'; };
  VMTL.fmtNumber = (v) => (v == null ? '—' : Number(v).toLocaleString());
  VMTL.fmtDecimal = (v, dp = 3) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp }));
  VMTL.fmtKm = (v) => (v == null ? '—' : `${VMTL.fmtDecimal(v)} km`);
  VMTL.fmtCedis = (v) => { if (v == null || v === '') return '—'; const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? `₵${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'; };
  VMTL.fmtDuration = (minutes) => { if (minutes == null) return '—'; let ms = Math.round(minutes * 60000); const h = Math.floor(ms / 3600000); ms -= h * 3600000; const m = Math.floor(ms / 60000); ms -= m * 60000; const s = Math.floor(ms / 1000); ms -= s * 1000; return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ms, 3)}`; };
  VMTL.badge = (label, color) => `<span class="badge ${color || 'grey'}">${esc(label)}</span>`;

  // ---- API client -------------------------------------------------------
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { Accept: 'application/json' }, credentials: 'include' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const res = await fetch(`/api${path}`, init);
    if (res.status === 204) return null;
    let data = null; try { data = await res.json(); } catch (_) { /* non-json */ }
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/login') && location.pathname !== '/login.html') { location.href = '/login.html'; }
      const err = new Error((data && data.error) || `Request failed (${res.status})`); err.status = res.status; err.errors = data && data.errors; throw err;
    }
    return data;
  }
  VMTL.api = api;

  // ---- theme (light / dark / system) -----------------------------------
  function themePref() { try { const t = localStorage.getItem('theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch (_) { return 'system'; } }
  function applyTheme(choice) { const r = document.documentElement; if (choice === 'system') { try { localStorage.removeItem('theme'); } catch (_) {} r.removeAttribute('data-theme'); } else { try { localStorage.setItem('theme', choice); } catch (_) {} r.setAttribute('data-theme', choice); } }
  VMTL.applyTheme = applyTheme; VMTL.themePref = themePref;
  (function initTheme() { const p = themePref(); if (p !== 'system') document.documentElement.setAttribute('data-theme', p); })();

  // ---- toast + modal ----------------------------------------------------
  function toast(message, kind = '') {
    let host = document.getElementById('toasts'); if (!host) { host = el('<div id="toasts"></div>'); document.body.appendChild(host); }
    const t = el(`<div class="toast ${kind}">${esc(message)}</div>`); host.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 5200 : 3200);
  }
  VMTL.toast = toast;

  function openModal(innerHtml, { large = false } = {}) {
    const backdrop = el(`<div class="modal-backdrop"><div class="modal ${large ? 'lg' : ''}">${innerHtml}</div></div>`);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() { document.removeEventListener('keydown', onKey); backdrop.remove(); }
    document.body.appendChild(backdrop);
    return { el: backdrop, modal: backdrop.querySelector('.modal'), close };
  }
  VMTL.openModal = openModal;

  function confirmModal(message, { danger = false, confirmLabel = 'Confirm' } = {}) {
    return new Promise((resolve) => {
      const m = openModal(`<div class="modal-body"><p>${esc(message)}</p></div><div class="modal-foot"><button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmLabel)}</button></div>`);
      m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
      m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    });
  }
  VMTL.confirm = confirmModal;

  // Render a field-errors map (from a 422) as inline messages, or a toast.
  VMTL.showErrors = (err, form) => {
    if (err && err.errors && form) {
      form.querySelectorAll('.field-error').forEach((n) => n.remove());
      for (const [field, msgs] of Object.entries(err.errors)) {
        const input = form.querySelector(`[name="${field}"]`);
        const host = input ? input.closest('.field') || input.parentElement : null;
        if (host) host.appendChild(el(`<div class="field-error">${esc(Array.isArray(msgs) ? msgs[0] : msgs)}</div>`));
      }
    }
    toast((err && err.message) || 'Something went wrong.', 'err');
  };

  // ---- capability helpers ----------------------------------------------
  VMTL.can = (cap) => VMTL.user && (VMTL.user.is_super_admin || VMTL.caps.includes(cap));
  VMTL.isSuper = () => !!(VMTL.user && VMTL.user.is_super_admin);
  VMTL.requesterOnly = () => !!(VMTL.user && VMTL.user.requester_only);
  VMTL.roleSlug = () => (VMTL.user && VMTL.user.role ? VMTL.user.role.slug : null);

  // ---- icons (minimal inline set) --------------------------------------
  const I = {
    dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z',
    requests: 'M8 2h8l4 4v16H4V2zM14 2v6h6', approvals: 'M9 11l3 3 8-8M4 4h10v6M4 20h16', trips: 'M3 7h11l3 4h4v6h-3M3 7v10h3M7 17h7',
    vehicles: 'M5 11l1-4h12l1 4M3 11h18v6H3zM7 17a2 2 0 100 4 2 2 0 000-4zM17 17a2 2 0 100 4 2 2 0 000-4z',
    drivers: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87',
    wrench: 'M14 7a4 4 0 01-5 5L4 17l3 3 5-5a4 4 0 005-5z', fuel: 'M3 22h11V3H3zM14 8h3l3 3v8a2 2 0 01-4 0v-6h-2M7 8h4',
    analytics: 'M3 3v18h18M8 17V9M13 17V5M18 17v-7', reports: 'M8 2h8l4 4v16H4V2zM9 13h6M9 17h6M9 9h2',
    users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87',
    org: 'M12 3v6M5 21v-4a2 2 0 012-2h10a2 2 0 012 2v4M9 3h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.4L3.1 11a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1L9.5 22h5l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z',
    audit: 'M8 2h8l4 4v16H4V2zM9 8h6M9 12h6M9 16h4', gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7a3 3 0 10-3-3M12 7a3 3 0 013-3',
    plane: 'M22 2L11 13M22 2l-7 20-4-9-9-4z', health: 'M22 12h-4l-3 9L9 3l-3 9H2', shield: 'M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', key: 'M14 7a4 4 0 11-5 5l-5 5v3h3l1-1h2v-2h2l2-2a4 4 0 015-5z',
    message: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z', database: 'M12 3c5 0 8 1.3 8 3s-3 3-8 3-8-1.3-8-3 3-3 8-3zM4 6v12c0 1.7 3 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
    book: 'M4 19V5a2 2 0 012-2h12v18H6a2 2 0 01-2-2zM4 19a2 2 0 012-2h12', help: 'M12 18h.01M9.1 9a3 3 0 115.8 1c0 2-3 2-3 4M12 2a10 10 0 100 20 10 10 0 000-20z',
    bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
    menu: 'M3 12h18M3 6h18M3 18h18', sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 009.8 9.8z', monitor: 'M3 4h18v12H3zM8 20h8M12 16v4', plus: 'M12 5v14M5 12h14',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(I[name] || 'M12 12h.01').split('M').filter(Boolean).map((p) => `<path d="M${p}"/>`).join('')}</svg>`;
  VMTL.icon = icon;

  // ---- navigation config (mirrors Layout.tsx) --------------------------
  const OPS = ['staff', 'approver', 'transport_admin', 'supervisor', 'administrator'];
  const NAV = [
    { label: 'Workspace', items: [
      { key: 'dashboard', to: '/dashboard.html', label: 'Dashboard', icon: 'dashboard', mobile: true },
      { key: 'requests', to: '/requests.html', label: 'Requests', icon: 'requests', roles: OPS, mobile: true },
      { key: 'approvals', to: '/approvals.html', label: 'Approvals', icon: 'approvals', roles: ['approver', 'supervisor', 'administrator'], mobile: true },
      { key: 'goodwill', to: '/goodwill.html', label: 'Goodwill', icon: 'gift', cap: 'requests.create_goodwill' },
      { key: 'external', to: '/external-travel.html', label: 'External Travel', icon: 'plane', cap: 'requests.create_external' },
      { key: 'trips', to: '/trips.html', label: 'Trips', icon: 'trips', mobile: true },
    ] },
    { label: 'Fleet', items: [
      { key: 'vehicles', to: '/vehicles.html', label: 'Vehicles', icon: 'vehicles', roles: OPS, mobile: true },
      { key: 'drivers', to: '/drivers.html', label: 'Drivers', icon: 'drivers', roles: OPS },
      { key: 'maintenance', to: '/maintenance.html', label: 'Maintenance', icon: 'wrench', roles: ['transport_admin', 'supervisor', 'administrator'] },
      { key: 'fuel', to: '/fuel.html', label: 'Fuel', icon: 'fuel', cap: 'fuel.log' },
    ] },
    { label: 'Insights', items: [
      { key: 'analytics', to: '/analytics.html', label: 'Analytics', icon: 'analytics', cap: 'analytics.view' },
      { key: 'reports', to: '/reports.html', label: 'Reports', icon: 'reports', cap: 'reports.export' },
    ] },
    { label: 'Administration', items: [
      { key: 'users', to: '/users.html', label: 'Users', icon: 'users', cap: 'users.manage' },
      { key: 'org-units', to: '/org-units.html', label: 'Organisation', icon: 'org', cap: 'departments.manage' },
      { key: 'settings', to: '/settings.html', label: 'Settings', icon: 'settings', cap: 'settings.manage' },
      { key: 'audit', to: '/audit.html', label: 'Audit Logs', icon: 'audit', cap: 'audit.view' },
    ] },
    { label: 'System', items: [
      { key: 'app-health', to: '/app-health.html', label: 'App Health', icon: 'health', superOnly: true },
      { key: 'rbac', to: '/rbac.html', label: 'RBAC', icon: 'shield', superOnly: true },
      { key: 'system-controls', to: '/system-controls.html', label: 'System controls', icon: 'sliders', superOnly: true },
      { key: 'directory-auth', to: '/directory-auth.html', label: 'Directory authentication', icon: 'key', superOnly: true },
      { key: 'messaging', to: '/messaging.html', label: 'Messaging', icon: 'message', superOnly: true },
      { key: 'database', to: '/database-connections.html', label: 'Database connections', icon: 'database', superOnly: true },
      { key: 'documentation', to: '/documentation.html', label: 'Documentation', icon: 'book', superOnly: true },
    ] },
    { label: 'Help', items: [{ key: 'faqs', to: '/faqs.html', label: 'FAQs', icon: 'help' }] },
  ];

  function visible(item) {
    if (VMTL.requesterOnly()) return item.key === 'requests' || item.key === 'faqs';
    if (item.superOnly) return VMTL.isSuper();
    if (item.cap) return VMTL.can(item.cap);
    if (item.roles) return VMTL.roleSlug() && item.roles.includes(VMTL.roleSlug());
    return true;
  }

  // ---- shell ------------------------------------------------------------
  function buildShell(activeKey) {
    const sections = NAV.map((s) => ({ ...s, items: s.items.filter(visible) })).filter((s) => s.items.length);
    const allItems = sections.flatMap((s) => s.items);
    const navHtml = sections.map((s) => `<div class="nav-section"><p>${esc(s.label)}</p>${s.items.map((it) => `<a class="nav-link ${it.key === activeKey ? 'active' : ''}" href="${it.to}">${icon(it.icon)}<span>${esc(it.label)}</span></a>`).join('')}</div>`).join('');
    const home = VMTL.requesterOnly() ? '/requests.html' : '/dashboard.html';
    const brand = `<a class="brand" href="${home}"><img src="/knust-logo.png" alt="KNUST"><div><div class="t1">UITS VMTL</div><div class="t2">Vehicle Management</div></div></a>`;
    const current = allItems.find((it) => it.key === activeKey);
    const title = current ? current.label : 'UITS VMTL';
    const u = VMTL.user;

    const app = document.getElementById('app') || document.body.appendChild(el('<div id="app"></div>'));
    app.className = 'app';
    app.innerHTML = `
      <aside class="sidebar" id="sidebar">${brand}<nav class="nav">${navHtml}</nav></aside>
      <div class="main">
        <header class="topbar">
          <div class="row">
            <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu">${icon('menu')}</button>
            <span class="title">${esc(title)}</span>
          </div>
          <div class="right">
            <button class="icon-btn" id="bellBtn" aria-label="Notifications" style="position:relative">${icon('bell')}<span id="bellCount" class="badge red hidden" style="position:absolute;top:0;right:0;padding:0 5px;font-size:10px"></span></button>
            <button class="icon-btn" id="themeBtn" aria-label="Theme">${icon(VMTL.themePref() === 'dark' ? 'moon' : VMTL.themePref() === 'light' ? 'sun' : 'monitor')}</button>
            <div class="right-user" style="text-align:right;margin:0 4px" ><div style="font-size:13px;font-weight:600">${esc(u.name)}</div><div style="font-size:11px;color:var(--text-3)">${esc(u.role ? u.role.label : '')}</div></div>
            <div class="avatar">${esc((u.name || '?').charAt(0))}</div>
            <button class="icon-btn" id="logoutBtn" aria-label="Log out">${icon('logout')}</button>
          </div>
        </header>
        <main class="content"><div id="view"></div></main>
        <footer class="footer">KNUST · University Information Technology Services — Vehicle Management &amp; Trip Logging</footer>
      </div>
      <nav class="bottom-nav">${allItems.filter((it) => it.mobile).slice(0, 4).map((it) => `<a class="${it.key === activeKey ? 'active' : ''}" href="${it.to}">${icon(it.icon)}<span>${esc(it.label)}</span></a>`).join('')}<button id="menuBtn2">${icon('menu')}<span>Menu</span></button></nav>`;

    VMTL.view = app.querySelector('#view');
    // interactions
    const sidebar = app.querySelector('#sidebar');
    const openDrawer = () => { sidebar.classList.add('open'); const bd = el('<div class="drawer-backdrop"></div>'); bd.onclick = () => { sidebar.classList.remove('open'); bd.remove(); }; document.body.appendChild(bd); };
    app.querySelector('#menuBtn').onclick = openDrawer;
    app.querySelector('#menuBtn2').onclick = openDrawer;
    app.querySelector('#themeBtn').onclick = (e) => { const order = ['light', 'dark', 'system']; const next = order[(order.indexOf(VMTL.themePref()) + 1) % 3]; applyTheme(next); e.currentTarget.innerHTML = icon(next === 'dark' ? 'moon' : next === 'light' ? 'sun' : 'monitor'); toast(`Theme: ${next}`); };
    app.querySelector('#logoutBtn').onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch (_) {} location.href = '/login.html'; };
    app.querySelector('#bellBtn').onclick = showNotifications;
    refreshBell();
  }

  async function refreshBell() {
    try { const r = await api('/notifications?limit=1'); const n = r.unread_count || 0; const b = document.getElementById('bellCount'); if (b) { b.textContent = n; b.classList.toggle('hidden', n === 0); } } catch (_) {}
  }
  async function showNotifications() {
    const m = openModal('<div class="modal-head"><h3>Notifications</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body" id="notifBody"><div class="loading">Loading…</div></div><div class="modal-foot"><button class="btn" id="markAll">Mark all read</button></div>');
    const body = m.el.querySelector('#notifBody');
    try {
      const r = await api('/notifications');
      body.innerHTML = r.data.length ? r.data.map((n) => `<div class="alert-accent ${n.read_at ? '' : 'green'}" style="margin-bottom:8px"><div style="font-weight:600">${esc(describe(n))}</div><div class="dim" style="font-size:12px">${VMTL.fmtDateTime(n.created_at)}</div></div>`).join('') : '<div class="empty">No notifications.</div>';
    } catch (e) { body.innerHTML = '<div class="empty">Could not load notifications.</div>'; }
    m.el.querySelector('#markAll').onclick = async () => { try { await api('/notifications/read-all', { method: 'POST' }); } catch (_) {} m.close(); refreshBell(); };
  }
  function describe(n) {
    const d = n.data || {};
    const map = {
      new_request: `New request ${d.request_number || ''} from ${d.requester || 'a requester'}`,
      request_approved: `Your request ${d.request_number || ''} was approved`,
      request_rejected: `Your request ${d.request_number || ''} was rejected`,
      request_changes_requested: `Changes requested on ${d.request_number || ''}`,
      vehicle_assigned: `${d.vehicle || 'A vehicle'} assigned (trip ${d.trip_number || ''})`,
      trip_completed: `Trip ${d.trip_number || ''} completed (${d.distance || 0} km)`,
      driver_ready: `Driver ready for trip ${d.trip_number || ''}`,
      trip_stop_requested: `Added destination "${d.destination || ''}" on ${d.trip_number || ''}`,
      trip_stop_accepted: `"${d.destination || ''}" accepted on ${d.trip_number || ''}`,
      trip_stop_declined: `"${d.destination || ''}" declined on ${d.trip_number || ''}`,
      trip_delay_warning: `Possible delay to trip ${d.trip_number || ''}`,
    };
    return map[n.type] || n.type;
  }

  // ---- shared UI helpers -----------------------------------------------
  VMTL.statusBadge = (e) => (e ? VMTL.badge(e.status_label || e.status, e.status_color) : '');
  VMTL.pageHead = (title, sub, actions) => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>`;
  // Indented org-unit <option>s from the scoped meta list.
  VMTL.orgUnitOptions = (selected) => (VMTL.meta.org_units || []).map((u) => `<option value="${u.id}" ${String(selected) === String(u.id) ? 'selected' : ''}>${'  '.repeat(u.depth || 0)}${esc(u.name)}</option>`).join('');
  VMTL.enumOptions = (name, selected) => (VMTL.meta.enums[name] || []).map((o) => `<option value="${o.value}" ${String(selected) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

  // ---- trip progress graphic (ports lib/trip.ts + TripProgress.tsx) -----
  const MIN = 60000;
  const toMs = (v) => { if (!v) return null; const t = Date.parse(String(v).replace(' ', 'T')); return Number.isFinite(t) ? t : null; };
  function computeTripProgress(trip, now) {
    now = now || Date.now();
    const ss = toMs(trip.scheduled_start); const se = toMs(trip.scheduled_end);
    const expectedMs = (ss != null && se != null) ? se - ss : null;
    if (!expectedMs || expectedMs <= 0) return { applicable: false };
    const expectedMinutes = expectedMs / MIN;
    if (trip.status === 'in_progress') {
      const start = toMs(trip.actual_start) != null ? toMs(trip.actual_start) : ss;
      const elapsedMs = Math.max(0, now - start); const remainingMs = expectedMs - elapsedMs;
      return { applicable: true, state: 'in_progress', progress: Math.min(1, elapsedMs / expectedMs), expectedMinutes, elapsedMinutes: elapsedMs / MIN, remainingMinutes: remainingMs / MIN, overdue: remainingMs < 0 };
    }
    if (trip.status === 'completed') {
      const start = toMs(trip.actual_start); const end = toMs(trip.actual_end);
      const elapsedMs = (start != null && end != null) ? Math.max(0, end - start) : expectedMs;
      return { applicable: true, state: 'completed', progress: 1, expectedMinutes, elapsedMinutes: elapsedMs / MIN, remainingMinutes: 0, overdue: false };
    }
    return { applicable: false };
  }
  function humanizeMinutes(total) { const m = Math.round(Math.abs(total)); if (m < 1) return '<1m'; const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const mm = m % 60; const p = []; if (d) p.push(`${d}d`); if (h) p.push(`${h}h`); if (mm && !d) p.push(`${mm}m`); return p.length ? p.join(' ') : `${m}m`; }
  function vehicleSvg(motif) {
    const paths = {
      pickup: '<path d="M3 25 L3 20 L30 20 L30 8 L44 8 L50 17 L60 17 L60 25 Z" fill="currentColor"/>',
      suv: '<path d="M4 25 L4 18 Q4 10 14 10 L44 10 Q54 10 58 18 L60 18 L60 25 Z" fill="currentColor"/>',
      bus: '<path d="M3 25 L3 9 Q3 7 6 7 L56 7 Q60 7 60 11 L60 25 Z" fill="currentColor"/><rect x="8" y="11" width="46" height="7" rx="1" fill="rgba(255,255,255,.35)"/>',
      car: '<path d="M3 25 L3 19 L14 19 L20 11 L42 11 L50 19 L60 19 L60 25 Z" fill="currentColor"/>',
    };
    return `<svg viewBox="0 0 64 34" width="50" height="27" style="color:var(--primary)" aria-hidden="true">${paths[motif] || paths.car}<circle cx="16" cy="26" r="5" fill="var(--text)"/><circle cx="48" cy="26" r="5" fill="var(--text)"/></svg>`;
  }
  // Returns {el} and self-ticks for in-progress trips. motif from vehicle.
  VMTL.tripProgress = function (trip, motif) {
    const info = computeTripProgress(trip);
    if (!info.applicable) return null;
    const wrap = el('<div class="card pad" role="progressbar" aria-valuemin="0" aria-valuemax="100"></div>');
    function render() {
      const i = computeTripProgress(trip); if (!i.applicable) return;
      const pct = Math.round(i.progress * 100);
      const summary = i.state === 'completed' ? `Completed in ${humanizeMinutes(i.elapsedMinutes)}` : i.overdue ? `Running ${humanizeMinutes(-i.remainingMinutes)} over the expected duration` : `About ${humanizeMinutes(i.remainingMinutes)} remaining`;
      wrap.setAttribute('aria-valuenow', pct);
      wrap.innerHTML = `
        <div class="between" style="margin-bottom:10px"><div class="row gap-sm"><strong>Trip progress</strong>${i.state === 'in_progress' ? '<span class="badge green" style="font-size:10px">LIVE</span>' : ''}</div><strong style="color:${i.overdue ? 'var(--warning)' : 'var(--primary)'}">${pct}%</strong></div>
        <div style="position:relative;height:40px">
          <div style="position:absolute;left:28px;right:28px;bottom:8px;height:9px;border-radius:999px;background:var(--surface-2);overflow:hidden"><div style="height:100%;width:${pct}%;background:${i.overdue ? 'color-mix(in srgb,var(--warning) 40%,transparent)' : 'color-mix(in srgb,var(--primary) 35%,transparent)'}"></div></div>
          <div style="position:absolute;left:0;bottom:4px;width:24px;height:24px;border-radius:999px;background:var(--primary-tint);color:var(--primary);display:flex;align-items:center;justify-content:center">📍</div>
          <div style="position:absolute;right:0;bottom:4px;width:24px;height:24px;border-radius:999px;background:${pct >= 100 ? 'color-mix(in srgb,var(--success) 18%,transparent)' : 'var(--surface-2)'};display:flex;align-items:center;justify-content:center">🏁</div>
          <div style="position:absolute;left:calc(28px + (100% - 56px) * ${i.progress});bottom:12px;transform:translateX(-50%);transition:left 1s linear">${vehicleSvg(motif || 'car')}</div>
        </div>
        <div class="between dim" style="font-size:12px;margin-top:4px"><span>${humanizeMinutes(i.elapsedMinutes)} elapsed</span><span>~${humanizeMinutes(i.expectedMinutes)} expected</span></div>
        <div style="font-size:12.5px;margin-top:4px;color:${i.overdue ? 'var(--warning)' : 'var(--text-2)'}">${summary}</div>`;
    }
    render();
    if (info.state === 'in_progress') { const t = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(t); return; } render(); }, 1000); }
    return wrap;
  };

  // ---- boot -------------------------------------------------------------
  VMTL.boot = async function boot(activeKey) {
    try {
      const me = await api('/me'); VMTL.user = me.user; VMTL.caps = me.user.capabilities || [];
    } catch (e) { location.href = '/login.html'; throw e; }
    try { const meta = await api('/meta'); VMTL.meta = meta; } catch (_) { VMTL.meta = { enums: {}, org_units: [], roles: [], departments: [] }; }
    buildShell(activeKey);
    registerSW();
    return VMTL;
  };

  function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }

  // Page-head helper pages can call before boot to set the active nav from <body data-nav>.
  document.addEventListener('DOMContentLoaded', () => { const k = document.body.getAttribute('data-nav'); if (k && !window.__VMTL_MANUAL_BOOT) VMTL.boot(k).then(() => { if (window.VMTL_PAGE) window.VMTL_PAGE(); }).catch(() => {}); });
})();
