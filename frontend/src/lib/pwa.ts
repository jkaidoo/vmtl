import { api } from './api'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

/**
 * Register the service worker and invoke `onUpdate` when a new version is
 * waiting (the page then prompts the user to refresh — no silent update).
 */
export function registerServiceWorker(onUpdate: (waiting: ServiceWorker) => void) {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      // A worker already waiting (updated in a previous visit).
      if (reg.waiting && navigator.serviceWorker.controller) onUpdate(reg.waiting)

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdate(installing)
          }
        })
      })
    })
    .catch(() => undefined)

  // Reload once the new worker takes control.
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  })
}

export function applyUpdate(waiting: ServiceWorker) {
  waiting.postMessage('SKIP_WAITING')
}

/** Current Notification permission, or 'unsupported'. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  return Notification.permission
}

/**
 * Ask for permission (if needed), subscribe to push and register the
 * subscription with the backend. Returns true on success.
 */
export async function enablePush(): Promise<boolean> {
  if (pushPermission() === 'unsupported') return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const reg = await navigator.serviceWorker.ready
  const { data } = await api.get<{ public_key: string; configured: boolean }>('/push/vapid-public-key')
  if (!data.configured || !data.public_key) return false

  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.public_key) as BufferSource,
    }))

  const json = sub.toJSON()
  await api.post('/push/subscribe', {
    endpoint: sub.endpoint,
    keys: json.keys,
    contentEncoding: (PushManager as unknown as { supportedContentEncodings?: string[] }).supportedContentEncodings?.[0] ?? 'aesgcm',
  })
  return true
}

/** Re-register an existing subscription silently on load (keeps the server in sync). */
export async function syncExistingSubscription() {
  if (pushPermission() !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const json = sub.toJSON()
    await api.post('/push/subscribe', { endpoint: sub.endpoint, keys: json.keys })
  } catch {
    // ignore
  }
}

/** Update the installed-app icon badge (best effort). */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => void; clearAppBadge?: () => void }
  try {
    if (count > 0) nav.setAppBadge?.(count)
    else nav.clearAppBadge?.()
  } catch {
    // unsupported
  }
}
