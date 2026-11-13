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
  VMTL.esc = esc; VMTL.el = el; VMTL.VERSION = 'v1.0';
  // Capture the PWA install prompt so the account menu can offer "Install app".
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__vmtlInstallPrompt = e; const b = document.getElementById('installBtn'); if (b) b.classList.remove('hidden'); });

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

  // ---- Offline-first data layer (IndexedDB read-cache + write outbox) ----
  // Mirrors walkin's principles: GET responses are cached and served when the
  // network is gone; a whitelist of field operations (trip operation, request
  // creation, fuel log) is queued in a durable outbox and replayed — once each,
  // via X-Op-Id idempotency — when the connection returns.
  const OFFLINE = (() => {
    let dbp;
    const openDB = () => dbp || (dbp = new Promise((res, rej) => {
      let r; try { r = indexedDB.open('vmtl-offline', 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => { const d = r.result; ['cache', 'outbox'].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'key' }); }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const reqP = (q) => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    async function idbGet(store, key) { const d = await openDB(); const row = await reqP(d.transaction(store).objectStore(store).get(key)); return row ? row.value : undefined; }
    async function idbAll(store) { const d = await openDB(); const rows = await reqP(d.transaction(store).objectStore(store).getAll()); return rows.map((x) => x.value); }
    async function idbPut(store, key, value) { const d = await openDB(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put({ key, value }); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
    async function idbDel(store, key) { const d = await openDB(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

    const SAFE = [/^\/trips\/\d+\/.+$/, /^\/vehicle-requests(\/goodwill|\/external)?$/, /^\/fuel-logs$/];
    const isSafeWrite = (path, method) => method === 'POST' && SAFE.some((re) => re.test(path));
    const uuid = () => { try { return crypto.randomUUID(); } catch (_) { return 'op-' + Date.now() + '-' + Math.random().toString(16).slice(2); } };
    let subs = [];
    const onChange = (f) => { subs.push(f); return () => { subs = subs.filter((x) => x !== f); }; };
    const notify = () => subs.forEach((f) => { try { f(); } catch (_) { /* ignore */ } });

    const cacheGet = (p) => idbGet('cache', p).catch(() => undefined);
    const cachePut = (p, data) => idbPut('cache', p, data).catch(() => {});
    const enqueue = (op) => idbPut('outbox', op.op_id, op).then(notify).catch(() => {});
    const queued = () => idbAll('outbox').then((l) => l.sort((a, b) => a.at - b.at)).catch(() => []);
    const pendingCount = () => queued().then((l) => l.length);

    let syncing = false;
    async function sync() {
      if (syncing || navigator.onLine === false) return { synced: 0, failed: 0 };
      syncing = true; let synced = 0; let failed = 0;
      try {
        for (const op of await queued()) {
          try {
            const r = await fetch(`/api${op.path}`, { method: op.method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Op-Id': op.op_id }, credentials: 'include', body: op.body !== undefined ? JSON.stringify(op.body) : undefined });
            if (r.ok) { await idbDel('outbox', op.op_id); synced++; }
            else if (r.status >= 400 && r.status < 500) { await idbDel('outbox', op.op_id); failed++; } // permanent (e.g. validation) → drop
            else { failed++; } // 5xx → keep for next sync
          } catch (_) { break; } // connection dropped again → stop; keep the rest
        }
      } finally { syncing = false; notify(); }
      return { synced, failed };
    }
    return { isSafeWrite, uuid, cacheGet, cachePut, enqueue, queued, pendingCount, sync, onChange };
  })();
  VMTL.offline = OFFLINE;

  // ---- API client (offline-aware) ---------------------------------------
  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const init = { method, headers: { Accept: 'application/json' }, credentials: 'include' };
    const opId = OFFLINE.uuid();
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    if (method !== 'GET') init.headers['X-Op-Id'] = opId; // idempotent retry
    const queueIt = async () => { await OFFLINE.enqueue({ op_id: opId, path, method, body: opts.body, at: Date.now() }); return { data: { _queued: true, op_id: opId }, queued: true }; };
    if (OFFLINE.isSafeWrite(path, method) && navigator.onLine === false) return queueIt();
    let res;
    try { res = await fetch(`/api${path}`, init); }
    catch (netErr) {
      if (OFFLINE.isSafeWrite(path, method)) return queueIt();
      if (method === 'GET') { const cached = await OFFLINE.cacheGet(path); if (cached !== undefined) return Object.assign({}, cached, { _stale: true }); }
      const e = new Error('You are offline — this isn’t available yet.'); e.offline = true; throw e;
    }
    if (res.status === 204) return null;
    let data = null; try { data = await res.json(); } catch (_) { /* non-json */ }
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/login') && location.pathname !== '/login.html') { location.href = '/login.html'; }
      const err = new Error((data && data.error) || `Request failed (${res.status})`); err.status = res.status; err.errors = data && data.errors; throw err;
    }
    if (method === 'GET' && data !== null) OFFLINE.cachePut(path, data); // last-known-good read
    return data;
  }
  VMTL.api = api;

  // ---- On-device push notifications (Web Push / VAPID) ------------------
  function urlB64ToUint8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  async function pushSubscription() { if (!pushSupported()) return null; try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (_) { return null; } }
  async function enablePush() {
    if (!pushSupported()) throw new Error('This device/browser does not support push notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications permission was not granted.');
    const info = await api('/push/vapid-public-key');
    if (!info.configured || !info.public_key) throw new Error('Push is not configured on the server.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(info.public_key) });
    const json = sub.toJSON();
    await api('/push/subscribe', { method: 'POST', body: { endpoint: sub.endpoint, keys: json.keys, contentEncoding: 'aes128gcm' } });
    return true;
  }
  async function disablePush() {
    const sub = await pushSubscription();
    if (sub) { try { await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch (_) { /* ignore */ } try { await sub.unsubscribe(); } catch (_) { /* ignore */ } }
    return true;
  }
  VMTL.pushSupported = pushSupported; VMTL.pushSubscription = pushSubscription; VMTL.enablePush = enablePush; VMTL.disablePush = disablePush;

  // ---- keep awake (Screen Wake Lock) -----------------------------------
  // Holds the display on while a live screen is open — the driver's active trip
  // or the Live map — so the OS doesn't sleep it (which would freeze GPS sharing
  // and map updates). The lock is dropped when the tab is hidden, so it is
  // re-acquired on return. Reference-counted: many callers, one lock.
  const _wake = { sentinel: null, holders: 0 };
  async function _wakeEnsure() {
    if (_wake.holders <= 0 || _wake.sentinel || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    try { _wake.sentinel = await navigator.wakeLock.request('screen'); _wake.sentinel.addEventListener('release', () => { _wake.sentinel = null; }); } catch (_) { /* denied / unsupported */ }
  }
  VMTL.keepAwake = function keepAwake() {
    _wake.holders++; _wakeEnsure();
    let released = false;
    return () => { if (released) return; released = true; _wake.holders = Math.max(0, _wake.holders - 1); if (_wake.holders === 0 && _wake.sentinel) { try { _wake.sentinel.release(); } catch (_) {} _wake.sentinel = null; } };
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _wakeEnsure(); });

  // ---- service-worker message bus --------------------------------------
  // The SW (e.g. a periodic background sync) asks open pages to refresh by
  // posting a message; we re-broadcast it as a DOM event pages can subscribe to.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { try { window.dispatchEvent(new CustomEvent('vmtl:sw', { detail: e.data || {} })); } catch (_) {} });
  }

  // ---- periodic background sync ----------------------------------------
  // Best-effort refresh while backgrounded: Chromium + installed PWA only, with
  // an OS-governed cadence (minutes→hours). No-op everywhere else.
  VMTL.registerPeriodicSync = async function registerPeriodicSync(tag, minIntervalMs) {
    try {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      if (!reg.periodicSync) return false;
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state !== 'granted') return false;
      await reg.periodicSync.register(tag, { minInterval: minIntervalMs });
      return true;
    } catch (_) { return false; }
  };

  // ---- driver location beacon ------------------------------------------
  // A driver's device shares its GPS fix while they operate a trip, so the Live
  // Map can show where each vehicle is. The server only keeps the fix when the
  // driver has an in-progress trip ({tracked:true}); otherwise the beacon backs
  // off. One permission prompt, then quiet reporting while the app is open. The
  // screen is held awake during an active trip; nothing is shared for other
  // roles, and nothing is stored when no trip is active.
  let beaconStarted = false;
  function startDriverBeacon() {
    if (beaconStarted || VMTL.roleSlug() !== 'driver' || !('geolocation' in navigator) || !window.isSecureContext) return;
    beaconStarted = true;
    let timer = null, delay = 20000, stopped = false, lastCoords = null, wakeRelease = null, sending = false;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(beat, delay); };
    const setTracked = (on) => {
      if (on && !wakeRelease) wakeRelease = VMTL.keepAwake();     // keep screen alive on an active trip
      if (!on && wakeRelease) { wakeRelease(); wakeRelease = null; }
    };
    async function send(coords) {
      if (!coords || sending) return;
      sending = true;
      try {
        const r = await api('/tracking/location', { method: 'POST', body: { lat: coords.lat, lng: coords.lng, heading: coords.heading, speed: coords.speed, accuracy: coords.accuracy } });
        if (r && r.tracked) { delay = 15000; setTracked(true); } else { delay = 45000; setTracked(false); }
      } catch (_) { delay = 60000; /* offline: hold lastCoords and resend on reconnect */ }
      finally { sending = false; }
    }
    function beat() {
      if (stopped) return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const c = pos.coords || {};
        lastCoords = { lat: c.latitude, lng: c.longitude, heading: c.heading, speed: c.speed, accuracy: c.accuracy };
        await send(lastCoords);
        schedule();
      }, (err) => { if (err && err.code === 1) { stopped = true; setTracked(false); return; } delay = 45000; schedule(); },
        { enableHighAccuracy: true, maximumAge: 8000, timeout: 12000 });
    }
    timer = setTimeout(beat, 3000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !stopped && beaconStarted) schedule(); });
    // On reconnect, push the latest known fix at once so the map updates without waiting for the next cycle.
    window.addEventListener('online', () => { if (!stopped && lastCoords) send(lastCoords); });
  }
  VMTL.startDriverBeacon = startDriverBeacon;

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
    dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
    requests: 'M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1z M8 5H6a1 1 0 00-1 1v15a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-2 M9 11h6 M9 15h4',
    approvals: 'M9 3h6a1 1 0 011 1v1H8V4a1 1 0 011-1z M8 5H6a1 1 0 00-1 1v15a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-2 M9 14l2 2 4-4',
    trips: 'M6.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z M17.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z M9 17.5h6.5a2.5 2.5 0 002.5-2.5V9',
    vehicles: 'M4 13l1.8-5.4A2 2 0 017.7 6h8.6a2 2 0 011.9 1.6L20 13v4H4z M4 13h16 M8 17a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z M16 17a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z',
    drivers: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 8a4 4 0 100 8 4 4 0 000-8z M12 2v6 M3.5 15.5l5-2 M20.5 15.5l-5-2',
    wrench: 'M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-2.4z',
    fuel: 'M4 21V5a2 2 0 012-2h5a2 2 0 012 2v16 M3 21h11 M4 11h9 M13 7h2l2 2v8a2 2 0 004 0V8l-2.5-2.5',
    analytics: 'M3 3v18h18 M7 16v-5 M12 16V8 M17 16v-9',
    reports: 'M7 2h8l4 4v15a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1z M15 2v4h4 M9 12h7 M9 16h5 M9 8h3',
    users: 'M16 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2 M9.5 11a4 4 0 100-8 4 4 0 000 8z M22 21v-2a4 4 0 00-3-3.9 M17 3.1a4 4 0 010 7.8',
    org: 'M9 3h6v4H9z M4 17h5v4H4z M15 17h5v4h-5z M12 7v4 M6.5 17v-2h11v2',
    settings: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19 12a7 7 0 00-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-5l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.4L3.1 11a7 7 0 000 2l-2 1.6 2 3.4 2.4-1a7 7 0 001.7 1L9.5 22h5l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.4-2-1.6a7 7 0 00.1-1z',
    audit: 'M7 2h8l4 4v15a1 1 0 01-1 1H7a1 1 0 01-1-1V3a1 1 0 011-1z M15 2v4h4 M8.5 12l1.4 1.4L13 10.5 M8.5 17l1.4 1.4L13 15.5',
    gift: 'M20 12v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9 M3 8h18v4H3z M12 22V8 M12 8H8a2 2 0 110-4c3 0 4 4 4 4z M12 8h4a2 2 0 100-4c-3 0-4 4-4 4z',
    plane: 'M22 2L11 13 M22 2l-7 20-4-9-9-4z',
    health: 'M3 12h4l3 8 4-16 3 8h4',
    shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z M9 12l2 2 4-4',
    sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
    key: 'M14.5 7.5a4 4 0 11-5.2 5.2L4 18v2h2l1-1h2v-2h2l2.3-2.3a4 4 0 014.2-4.9z M16.5 7.5h.01',
    message: 'M4 4h16a1 1 0 011 1v10a1 1 0 01-1 1H9l-5 4V5a1 1 0 011-1z',
    database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    book: 'M12 6a4 3 0 00-4-3H3v14h5a4 3 0 014 3 4 3 0 014-3h5V3h-5a4 3 0 00-4 3z M12 6v15',
    help: 'M12 2a10 10 0 100 20 10 10 0 000-20z M9.2 9a3 3 0 015.6 1c0 2-3 2.3-3 4 M12 17h.01',
    bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 01-3.4 0',
    logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
    menu: 'M3 12h18 M3 6h18 M3 18h18',
    sun: 'M12 17a5 5 0 100-10 5 5 0 000 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 009.8 9.8z',
    monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4', plus: 'M12 5v14 M5 12h14',
    mail: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z M3 7l9 6 9-6',
    megaphone: 'M3 11l15-5v12L3 13z M3 11v2a1 1 0 001 1h1v-4H4a1 1 0 00-1 1z M7 14v3a1 1 0 001 1h1a1 1 0 001-1v-2.5',
    code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
    terminal: 'M4 17l6-6-6-6 M12 19h8',
    layout: 'M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z M3 9h18 M9 20V9',
    map: 'M12 21s-7-5.5-7-11a7 7 0 1114 0c0 5.5-7 11-7 11z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
    edit: 'M12 20h9 M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z',
    trash: 'M3 6h18 M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2 M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6 M10 11v6 M14 11v6',
    'user-plus': 'M15 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M8.5 11a4 4 0 100-8 4 4 0 000 8z M19 8v6 M22 11h-6',
    contacts: 'M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z M8 11a2 2 0 100-4 2 2 0 000 4z M5.5 16a2.5 2.5 0 015 0 M14 9h4 M14 13h3',
    calendar: 'M4 5h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z M3 10h18 M8 3v4 M16 3v4',
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
      { key: 'tracking', to: '/tracking.html', label: 'Live map', icon: 'map', roles: ['approver', 'transport_admin', 'supervisor', 'administrator'], mobile: true },
      { key: 'schedule', to: '/schedule.html', label: 'Schedule', icon: 'calendar', roles: ['approver', 'transport_admin', 'supervisor', 'administrator'] },
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
      { key: 'clients', to: '/clients.html', label: 'Clients', icon: 'contacts', cap: 'users.manage' },
      { key: 'org-units', to: '/org-units.html', label: 'Organisation', icon: 'org', cap: 'departments.manage' },
      { key: 'audit', to: '/audit.html', label: 'Audit Logs', icon: 'audit', cap: 'audit.view' },
    ] },
    { label: 'System', items: [
      { key: 'app-health', to: '/app-health.html', label: 'App Health', icon: 'health', systemAdmin: true },
      { key: 'rbac', to: '/rbac.html', label: 'RBAC', icon: 'shield', systemAdmin: true },
      { key: 'system-controls', to: '/system-controls.html', label: 'System controls', icon: 'sliders', systemAdmin: true },
      { key: 'directory-auth', to: '/directory-auth.html', label: 'Directory authentication', icon: 'key', systemAdmin: true },
      { key: 'maps-config', to: '/maps-config.html', label: 'Maps configuration', icon: 'map', systemAdmin: true },
      { key: 'sms', to: '/sms.html', label: 'SMS', icon: 'message', systemAdmin: true },
      { key: 'email', to: '/email.html', label: 'Email', icon: 'mail', systemAdmin: true },
      { key: 'broadcasts', to: '/broadcasts.html', label: 'Broadcasts', icon: 'megaphone', superOnly: true },
      { key: 'database', to: '/database-connections.html', label: 'Database connections', icon: 'database', systemAdmin: true },
      { key: 'unified-api', to: '/unified-api.html', label: 'Unified API', icon: 'code', systemAdmin: true },
      { key: 'report-config', to: '/report-configuration.html', label: 'Report configuration', icon: 'reports', systemAdmin: true },
      { key: 'navigation', to: '/navigation-settings.html', label: 'Navigation menu', icon: 'layout', systemAdmin: true },
      { key: 'documentation', to: '/documentation.html', label: 'Documentation', icon: 'book', systemAdmin: true },
      { key: 'codebase-guide', to: '/codebase-guide.html', label: 'Codebase guide', icon: 'terminal', systemAdmin: true },
    ] },
    { label: 'Help', items: [
      { key: 'how-it-works', to: '/how-it-works.html', label: 'How it works', icon: 'book' },
      { key: 'faqs', to: '/faqs.html', label: 'FAQs', icon: 'help' },
    ] },
  ];

  function visible(item) {
    if (VMTL.requesterOnly()) return item.key === 'requests' || item.key === 'faqs' || item.key === 'how-it-works';
    if (((VMTL.meta && VMTL.meta.nav_hidden) || []).includes(item.key) && item.key !== 'navigation') return false;
    if (item.superOnly) return VMTL.isSuper();
    if (item.systemAdmin) return VMTL.isSuper() || VMTL.can('system.admin');
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
            <div class="theme-switch" role="radiogroup" aria-label="Color theme">
              <button type="button" role="radio" data-theme-set="light" aria-label="Light theme" title="Light" aria-checked="${VMTL.themePref() === 'light'}">${icon('sun')}</button>
              <button type="button" role="radio" data-theme-set="dark" aria-label="Dark theme" title="Dark" aria-checked="${VMTL.themePref() === 'dark'}">${icon('moon')}</button>
              <button type="button" role="radio" data-theme-set="system" aria-label="System theme" title="System" aria-checked="${VMTL.themePref() === 'system'}">${icon('monitor')}</button>
            </div>
            <div class="usermenu">
              <button class="usermenu-trigger" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">
                <div class="who"><b>${esc(u.name)}</b><span>${esc(u.is_super_admin ? 'App Owner' : (u.role ? u.role.label : ''))}</span></div>
                <div class="avatar">${esc((u.name || '?').charAt(0))}</div>
                <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div class="menu hidden" id="userMenu" role="menu">
                <div class="menu-head"><b>${esc(u.name)}</b><span>${esc(u.is_super_admin ? 'App Owner' : (u.role ? u.role.label : ''))}</span></div>
                <a class="menu-item" href="/how-it-works.html" role="menuitem">${icon('book')}<span>How it works</span></a>
                <a class="menu-item" href="/faqs.html" role="menuitem">${icon('help')}<span>Help &amp; FAQs</span></a>
                <button class="menu-item" id="offlineBtn" role="menuitem" type="button">${icon('database')}<span>Offline &amp; sync</span><span class="pill hidden" id="syncCount" style="margin-left:auto;background:var(--warning-tint);color:var(--warning)"></span></button>
                <button class="menu-item hidden" id="pushBtn" role="menuitem" type="button">${icon('bell')}<span id="pushLabel">Turn on device notifications</span></button>
                <button class="menu-item" id="testNotifBtn" role="menuitem" type="button">${icon('bell')}<span>Send test notification</span></button>
                <button class="menu-item hidden" id="installBtn" role="menuitem" type="button">${icon('plus')}<span>Install app</span></button>
                <div class="menu-sep"></div>
                <button class="menu-item danger" id="logoutBtn" role="menuitem" type="button">${icon('logout')}<span>Sign out</span></button>
                <div class="menu-foot" id="menuFoot"></div>
              </div>
            </div>
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
    // Theme segmented switch (light / dark / system), mirroring walkin.
    const syncThemeSwitch = () => { const p = VMTL.themePref(); app.querySelectorAll('.theme-switch [data-theme-set]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeSet === p))); };
    app.querySelectorAll('.theme-switch [data-theme-set]').forEach((b) => { b.onclick = () => { applyTheme(b.dataset.themeSet); syncThemeSwitch(); }; });
    // User menu: combined identity + Sign out in one dropdown.
    const userBtn = app.querySelector('#userMenuBtn');
    const userMenu = app.querySelector('#userMenu');
    const closeUserMenu = () => { userMenu.classList.add('hidden'); userBtn.setAttribute('aria-expanded', 'false'); };
    userBtn.onclick = (e) => { e.stopPropagation(); const open = userMenu.classList.toggle('hidden'); userBtn.setAttribute('aria-expanded', String(!open)); };
    document.addEventListener('click', (e) => { if (!userMenu.contains(e.target) && !userBtn.contains(e.target)) closeUserMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUserMenu(); });
    // Any menu item closes the dropdown after acting.
    userMenu.querySelectorAll('.menu-item').forEach((it) => it.addEventListener('click', () => setTimeout(closeUserMenu, 0)));
    // Send a test notification to myself.
    app.querySelector('#testNotifBtn').onclick = async () => { try { await api('/notifications/test', { method: 'POST' }); toast('Test notification sent.', 'success'); refreshBell(); } catch (e) { toast((e && e.message) || 'Could not send.', 'err'); } };
    // Device (OS) push notifications toggle.
    const pushBtn = app.querySelector('#pushBtn');
    const pushLabel = app.querySelector('#pushLabel');
    const refreshPush = async () => {
      if (!pushSupported()) return; // leave hidden
      pushBtn.classList.remove('hidden');
      if (Notification.permission === 'denied') { pushLabel.textContent = 'Notifications blocked in browser'; pushBtn.disabled = true; return; }
      const sub = await pushSubscription();
      pushBtn.dataset.on = sub ? '1' : '0';
      pushLabel.textContent = sub ? 'Turn off device notifications' : 'Turn on device notifications';
    };
    pushBtn.onclick = async () => {
      pushBtn.disabled = true;
      try {
        if (pushBtn.dataset.on === '1') { await disablePush(); toast('Device notifications turned off.', 'success'); }
        else { await enablePush(); toast('Device notifications are on.', 'success'); }
      } catch (e) { toast((e && e.message) || 'Could not change notifications.', 'err'); }
      finally { pushBtn.disabled = false; refreshPush(); }
    };
    refreshPush();
    // Install app (PWA) — shown only when the browser offers it.
    const installBtn = app.querySelector('#installBtn');
    if (window.__vmtlInstallPrompt) installBtn.classList.remove('hidden');
    installBtn.onclick = async () => { const p = window.__vmtlInstallPrompt; if (!p) return; p.prompt(); try { await p.userChoice; } catch (_) { /* ignore */ } window.__vmtlInstallPrompt = null; installBtn.classList.add('hidden'); };
    // Footer: version + device line (walkin-style).
    const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
    const foot = app.querySelector('#menuFoot');
    if (foot) foot.textContent = `Version ${VMTL.VERSION || 'v1.0'} · ${standalone ? 'App' : 'Web'} · ${screen.width}×${screen.height}`;
    app.querySelector('#logoutBtn').onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch (_) {} location.href = '/login.html'; };
    app.querySelector('#bellBtn').onclick = showNotifications;
    refreshBell();

    // ---- Offline indicator + sync ----------------------------------------
    const banner = el('<div class="offline-banner hidden" id="offlineBanner"></div>');
    app.appendChild(banner);
    const syncCountEl = app.querySelector('#syncCount');
    const refreshSyncBadge = async () => { const n = await OFFLINE.pendingCount(); if (syncCountEl) { syncCountEl.textContent = n; syncCountEl.classList.toggle('hidden', n === 0); } };
    const opLabel = (op) => {
      const p = op.path;
      if (/\/start$/.test(p)) return 'Start trip'; if (/\/complete$/.test(p)) return 'Complete trip';
      if (/\/notify-ready$/.test(p)) return 'Signal ready'; if (/\/no-show$/.test(p)) return 'Mark no-show';
      if (/\/correct-odometer$/.test(p)) return 'Correct odometer'; if (/\/stops/.test(p)) return 'Add trip stop';
      if (/\/vehicle-requests/.test(p)) return 'New request'; if (/\/fuel-logs$/.test(p)) return 'Fuel log';
      return `${op.method} ${p}`;
    };
    async function offlineSyncModal() {
      const ops = await OFFLINE.queued();
      const intro = navigator.onLine === false
        ? '<div class="alert-accent amber mb">You are offline. Pending changes stay on this device and sync automatically when you reconnect.</div>'
        : (ops.length ? '<div class="dim mb" style="font-size:13px">These changes were made offline and are waiting to sync.</div>' : '<div class="dim">Nothing is waiting to sync.</div>');
      const list = ops.length ? `<div class="log-list">${ops.map((o) => `<div class="log-item"><span>${esc(opLabel(o))}</span><span class="when">${new Date(o.at).toLocaleString()}</span></div>`).join('')}</div>` : '';
      const m = openModal(`<div class="modal-head"><h3>Offline &amp; sync</h3><button class="icon-btn" data-close>✕</button></div><div class="modal-body">${intro}${list}</div><div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn btn-primary" id="syncNow" ${ops.length && navigator.onLine ? '' : 'disabled'}>Sync now</button></div>`);
      const btn = m.el.querySelector('#syncNow');
      if (btn) btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Syncing…'; const r = await OFFLINE.sync(); m.close(); if (r.synced) toast(`${r.synced} change${r.synced === 1 ? '' : 's'} synced.`, 'success'); else if (r.failed) toast('Some changes could not sync yet.', 'err'); refreshSyncBadge(); };
    }
    const updateOnline = async () => {
      const off = navigator.onLine === false;
      banner.textContent = off ? 'You are offline — changes are saved on this device and will sync when you reconnect.' : '';
      banner.classList.toggle('hidden', !off);
      if (!off) { const r = await OFFLINE.sync(); if (r.synced) toast(`${r.synced} offline change${r.synced === 1 ? '' : 's'} synced.`, 'success'); }
      refreshSyncBadge();
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    OFFLINE.onChange(refreshSyncBadge);
    app.querySelector('#offlineBtn').onclick = offlineSyncModal;
    updateOnline();
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
      ou_change_pending: `${d.name || 'A staff member'}'s unit changed: ${d.from || '—'} → ${d.to || '—'} — review in Clients`,
      ou_auto_moved: `${d.name || 'A staff member'} was automatically moved to ${d.to || 'a new unit'}`,
      compliance_digest: `Fleet compliance: ${d.total || 0} item(s) need attention${d.summary ? ` — ${d.summary}` : ''}`,
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
    startDriverBeacon();
    return VMTL;
  };

  function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }

  // ---- In-place page navigation (SPA-style, mirrors walkin) --------------
  // Clicking an internal link swaps only the main content and runs that page's
  // own VMTL_PAGE renderer, leaving the shell (top bar + side nav) mounted — so
  // navigation is instant with no white flash. Every failure path falls back to
  // a normal full navigation, so behaviour never regresses below a plain load.
  //
  // Each page script is loaded at most once per session (its VMTL_PAGE is cached
  // by path); revisiting a page just re-runs the cached renderer. This avoids
  // re-executing a script's top-level declarations (which would throw on `const`).
  const pageCache = new Map();
  let spaBusy = false;
  window.__vmtlLeave = window.__vmtlLeave || [];
  VMTL.onLeave = (fn) => { if (typeof fn === 'function') window.__vmtlLeave.push(fn); };
  const runLeave = () => { window.__vmtlLeave.splice(0).forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } }); };
  const flatNav = () => NAV.reduce((acc, s) => acc.concat(s.items), []);

  function spaEligible(a) {
    if (!a || !a.getAttribute('href')) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    let url; try { url = new URL(a.href, location.href); } catch (_) { return false; }
    if (url.origin !== location.origin) return false;
    return /\.html$/.test(url.pathname);
  }
  function setActiveNav(key) {
    const item = flatNav().find((it) => it.key === key);
    const href = item ? item.to : null;
    document.querySelectorAll('#sidebar .nav-link, .bottom-nav a').forEach((a) => {
      let p = null; try { p = new URL(a.href, location.href).pathname; } catch (_) { /* ignore */ }
      a.classList.toggle('active', !!href && p === href);
    });
    const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
    const bd = document.querySelector('.drawer-backdrop'); if (bd) bd.remove();
  }
  function setTitle(key, docTitle) {
    const item = flatNav().find((it) => it.key === key);
    const t = document.querySelector('.topbar .title');
    if (t) t.textContent = item ? item.label : String(docTitle || document.title || '').replace(/\s*·.*$/, '');
  }
  function loadPageScript(src) {
    return new Promise((resolve, reject) => {
      document.querySelectorAll('script[data-spa-page]').forEach((s) => s.remove());
      const s = document.createElement('script');
      s.src = src; s.setAttribute('data-spa-page', '1');
      s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load ' + src));
      document.body.appendChild(s);
    });
  }
  async function spaNavigate(href, { push = true } = {}) {
    if (spaBusy) return; spaBusy = true;
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok || /\/login\.html(\?|$)/.test(res.url)) { location.href = href; return; }
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const key = doc.body.getAttribute('data-nav');
      const path = new URL(href, location.href).pathname;
      const scriptSrc = [...doc.querySelectorAll('script[src]')]
        .map((s) => s.getAttribute('src'))
        .find((src) => src && !/\/js\/common\.js(\?|$)/.test(src));
      runLeave();
      if (push) history.pushState({ spa: true }, '', href);
      if (doc.title) document.title = doc.title;
      setActiveNav(key); setTitle(key, doc.title);
      if (VMTL.view) { VMTL.view.innerHTML = '<div class="loading"><span class="spinner"></span></div>'; VMTL.view.classList.remove('spa-in'); void VMTL.view.offsetWidth; VMTL.view.classList.add('spa-in'); }
      window.scrollTo(0, 0);
      let fn = pageCache.get(path);
      if (!fn) {
        if (scriptSrc) { await loadPageScript(scriptSrc); fn = window.VMTL_PAGE; pageCache.set(path, fn); }
      } else { window.VMTL_PAGE = fn; }
      if (typeof fn === 'function') await fn();
    } catch (err) {
      console.error('Page navigation failed', err);
      location.href = href; // graceful fallback
    } finally { spaBusy = false; }
  }
  document.addEventListener('click', (e) => {
    if (!document.getElementById('view')) return; // only inside a mounted shell
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!spaEligible(a)) return;
    const url = new URL(a.href, location.href);
    if (url.pathname === location.pathname && url.search === location.search && !url.hash) { e.preventDefault(); setActiveNav(document.body.getAttribute('data-nav')); return; }
    e.preventDefault();
    spaNavigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', () => { if (!document.getElementById('view')) return; spaNavigate(location.pathname + location.search, { push: false }); });

  // Page-head helper pages can call before boot to set the active nav from <body data-nav>.
  document.addEventListener('DOMContentLoaded', () => {
    const k = document.body.getAttribute('data-nav');
    if (k && !window.__VMTL_MANUAL_BOOT) VMTL.boot(k).then(() => {
      if (window.VMTL_PAGE) { const fn = window.VMTL_PAGE; pageCache.set(location.pathname, fn); return fn(); }
    }).catch(() => {});
  });
})();
