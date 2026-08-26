import { useEffect, useState } from 'react'
import { LogIn, ShieldAlert, Activity, Bug } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import type { AuditLog } from '../../lib/types'
import { Card, EmptyState, PageHeader, Spinner } from '../../components/ui'

interface HealthData {
  stats: { successful_signins: number; failed_signins: number; events_7d: number; errors_recent: number }
  successful_signins: AuditLog[]
  failed_signins: AuditLog[]
  recent_events: AuditLog[]
  error_log: { level: string; timestamp: string; message: string }[]
}

export function AppHealth() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ data: HealthData }>('/admin/app-health').then((r) => setData(r.data.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner label="Loading app health…" />
  if (!data) return <EmptyState title="Could not load app health" />

  const stats = [
    { label: 'Successful sign-ins (7d)', value: data.stats.successful_signins, icon: LogIn, color: 'text-green-600 bg-green-50' },
    { label: 'Failed sign-ins (7d)', value: data.stats.failed_signins, icon: ShieldAlert, color: 'text-red-600 bg-red-50' },
    { label: 'Events (7d)', value: data.stats.events_7d, icon: Activity, color: 'text-primary bg-primary-tint' },
    { label: 'Recent errors', value: data.stats.errors_recent, icon: Bug, color: 'text-amber-600 bg-amber-50' },
  ]

  return (
    <div>
      <PageHeader title="App Health" subtitle="Sign-in activity, operational events and errors" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label} className="p-4">
              <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${s.color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-2xl font-bold text-text tnum">{s.value}</p>
              <p className="text-xs text-text-2">{s.label}</p>
            </Card>
          )
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EventList title="Successful sign-ins" items={data.successful_signins} empty="No sign-ins yet" />
        <EventList title="Failed sign-ins" items={data.failed_signins} empty="No failed sign-ins" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EventList title="Recent operational events" items={data.recent_events} empty="No events" />
        <Card>
          <div className="border-b border-border px-5 py-3.5"><h2 className="font-semibold text-text">Error log</h2></div>
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {data.error_log.length === 0 ? (
              <EmptyState title="No recent errors" />
            ) : (
              data.error_log.map((e, i) => (
                <div key={i} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">{e.level}</span>
                    <span className="text-[11px] text-text-3">{e.timestamp}</span>
                  </div>
                  <p className="mt-1 break-words font-mono text-xs text-text-2">{e.message}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function EventList({ title, items, empty }: { title: string; items: AuditLog[]; empty: string }) {
  return (
    <Card>
      <div className="border-b border-border px-5 py-3.5"><h2 className="font-semibold text-text">{title}</h2></div>
      <div className="max-h-96 divide-y divide-border overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState title={empty} />
        ) : (
          items.map((a) => (
            <div key={a.id} className="px-5 py-2.5">
              <p className="text-sm text-text">{a.description}</p>
              <p className="text-[11px] text-text-3">{fmtDateTime(a.created_at)} · {a.ip_address ?? '—'}</p>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
