'use strict';
/* Service worker: offline app-shell with a network-first strategy. The API is
 * never cached (always fresh, offline-detectable). Bump CACHE on each deploy. */
const CACHE = 'vmtl-v2';
const SHELL = ['/css/styles.css', '/js/common.js', '/knust-logo.png', '/offline.html'];

self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api') || url.pathname === '/health') return; // never cache the API
  e.respondWith(
    fetch(request).then((res) => {
      if (res && res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(request).then((hit) => hit || (request.mode === 'navigate' ? caches.match('/offline.html') : undefined)))
  );
});

// Web Push → notification.
self.addEventListener('push', (e) => {
  let payload = {}; try { payload = e.data ? e.data.json() : {}; } catch (_) {}
  const title = payload.title || 'UITS VMTL';
  e.waitUntil(self.registration.showNotification(title, { body: payload.body || '', icon: '/knust-logo.png', badge: '/knust-logo.png', data: payload.data || {} }));
});
self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(self.clients.openWindow('/dashboard.html')); });

// Periodic background sync (Chromium + installed PWA): nudge any open Live map to
// refresh on an OS-governed cadence. There is no DOM here, so we message clients;
// a closed app does nothing (the web has no background location tracking).
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'vmtl-tracking') return;
  e.waitUntil((async () => {
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) c.postMessage({ type: 'tracking-refresh' });
    } catch (_) {}
  })());
});
