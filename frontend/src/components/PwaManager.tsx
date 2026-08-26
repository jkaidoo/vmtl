import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { applyUpdate, registerServiceWorker, syncExistingSubscription } from '../lib/pwa'

/**
 * Registers the service worker, keeps the push subscription in sync, and shows
 * a "new version — Refresh" prompt when an update is waiting (MASTER_DOC §I-12).
 */
export function PwaManager() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    registerServiceWorker((w) => setWaiting(w))
    syncExistingSubscription()
  }, [])

  if (!waiting) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] flex items-center justify-center gap-3 border-t border-border bg-surface px-4 py-3 shadow-lg sm:bottom-4 sm:left-auto sm:right-4 sm:rounded-xl sm:border">
      <RefreshCw className="h-4 w-4 text-primary" />
      <span className="text-sm text-text">A new version is available.</span>
      <button
        onClick={() => applyUpdate(waiting)}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600"
      >
        Refresh
      </button>
    </div>
  )
}
