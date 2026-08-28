/* UITS VMTL service worker — MASTER_DOC §I-12.
 * Network-first same-origin GETs; /api/* never cached; offline app-shell
 * fallback; no silent auto-update (waits for a Refresh prompt); Web Push. */

// The build injects a content hash here (see vite/sw-build-hash.ts). It changes
// only when the app bundle changes, so the SW bytes change too → the browser
// detects an update and fires `updatefound`, and the old cache is purged on
// activate. In dev the literal placeholder is served unchanged (static cache).
const BUILD_HASH = '__BUILD_HASH__'
const CACHE = `uits-vmtl-${BUILD_HASH}`
const PRECACHE = ['/', '/index.html', '/knust-logo.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}))
  // Do NOT skipWaiting automatically — the page prompts the user to refresh.
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // API is always live, never cached

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req)
        if (res && res.ok && (req.mode === 'navigate' || /\.(js|css|png|svg|webmanifest|woff2?)$/.test(url.pathname))) {
          const cache = await caches.open(CACHE)
          cache.put(req, res.clone())
        }
        return res
      } catch (err) {
        const cached = await caches.match(req)
        if (cached) return cached
        if (req.mode === 'navigate') {
          const shell = (await caches.match('/index.html')) || (await caches.match('/'))
          if (shell) return shell
        }
        throw err
      }
    })(),
  )
})

/* ---- Web Push ---- */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'UITS VMTL'
  const options = {
    body: data.body || '',
    icon: '/knust-logo.png',
    badge: '/knust-logo.png',
    tag: data.tag || 'uits-vmtl',
    renotify: true,
    data: { url: data.url || '/dashboard' },
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options)
      try {
        if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge()
      } catch (e) {}
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/dashboard'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if ('focus' in client) {
          try {
            await client.navigate(target)
          } catch (e) {}
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })(),
  )
})

self.addEventListener('pushsubscriptionchange', () => {
  // The page re-subscribes on its next load via ensurePushSubscription().
})
