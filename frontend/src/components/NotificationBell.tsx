import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing } from 'lucide-react'
import { api } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import type { AppNotification } from '../lib/types'
import { enablePush, pushPermission, setAppBadge } from '../lib/pwa'
import { useToast } from './Toast'

export function NotificationBell() {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [perm, setPerm] = useState(pushPermission())
  const ref = useRef<HTMLDivElement>(null)

  const load = () => {
    api
      .get<{ data: AppNotification[]; unread_count: number }>('/notifications')
      .then((res) => {
        setItems(res.data.data)
        setUnread(res.data.unread_count)
        setAppBadge(res.data.unread_count) // keep the installed-app icon badge in sync
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30000) // ~30s foreground poll
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const markAll = async () => {
    await api.post('/notifications/read-all').catch(() => undefined)
    load()
  }

  const handleEnable = async () => {
    const ok = await enablePush()
    setPerm(pushPermission())
    toast[ok ? 'success' : 'error'](ok ? 'Device notifications enabled' : 'Could not enable notifications')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-text-2 hover:bg-surface-2"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-text">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          {perm !== 'granted' && perm !== 'unsupported' && (
            <button
              onClick={handleEnable}
              className="flex w-full items-center gap-2 border-b border-border px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-primary-tint"
            >
              <BellRing className="h-4 w-4" /> Enable device notifications
            </button>
          )}

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-text-3">No notifications</p>
            ) : (
              items.map((n) => (
                <div key={n.id} className={`border-b border-border px-4 py-3 ${n.read_at ? '' : 'bg-primary-tint/40'}`}>
                  <p className="text-sm font-medium text-text">{n.data.title}</p>
                  <p className="text-xs text-text-2">{n.data.message}</p>
                  <p className="mt-1 text-[11px] text-text-3">{fmtDateTime(n.created_at)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
