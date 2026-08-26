import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Car, RefreshCw, User as UserIcon } from 'lucide-react'
import { api } from '../../lib/api'
import type { AvailabilityOverview, AvailabilityUnit } from '../../lib/types'
import { fmtDateTime } from '../../lib/format'
import { Button, Card, PageHeader, Spinner } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'

export function RequestAvailability() {
  const [data, setData] = useState<AvailabilityOverview | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ data: AvailabilityOverview }>('/availability/overview').then((r) => setData(r.data.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => load(), [load])

  // Live: refresh the snapshot every 30s so on-trip status stays current.
  useEffect(() => {
    const t = setInterval(() => {
      api.get<{ data: AvailabilityOverview }>('/availability/overview').then((r) => setData(r.data.data)).catch(() => undefined)
    }, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/requests" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </Link>

      <PageHeader
        title="Vehicle & Driver Availability"
        subtitle={data ? `Live snapshot — updated ${fmtDateTime(data.generated_at)}` : 'Live fleet availability'}
        actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={load}>Refresh</Button>}
      />

      {loading && !data ? (
        <Spinner label="Loading availability…" />
      ) : !data ? (
        <p className="text-slate-500">Could not load availability.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title="Vehicles" icon={<Car className="h-4 w-4" />} units={data.vehicles} kind="vehicle" />
          <Section title="Drivers" icon={<UserIcon className="h-4 w-4" />} units={data.drivers} kind="driver" />
        </div>
      )}
    </div>
  )
}

function Section({ title, icon, units, kind }: { title: string; icon: React.ReactNode; units: AvailabilityUnit[]; kind: 'vehicle' | 'driver' }) {
  const freeCount = units.filter((u) => u.free_now && !u.on_trip_now).length
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        {icon}
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <span className="ml-auto text-xs text-text-3">{freeCount} of {units.length} free now</span>
      </div>
      {units.length === 0 ? (
        <p className="p-5 text-sm text-slate-400">No active {kind}s.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {units.map((u) => (
            <li key={u.id} className="px-5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {u.label}
                    {kind === 'vehicle' && u.capacity ? <span className="ml-1 text-xs text-text-3">· {u.capacity} seats</span> : null}
                  </p>
                  {u.detail && <p className="truncate text-xs text-text-3">{u.detail}</p>}
                </div>
                {u.on_trip_now ? (
                  <StatusBadge label="On trip now" color="blue" />
                ) : u.free_now ? (
                  <StatusBadge label="Free now" color="green" />
                ) : (
                  <StatusBadge label={u.status_label} color={u.status_color} />
                )}
              </div>

              {u.on_trip_now && u.current_trip && (
                <p className="mt-1.5 text-xs text-text-2">
                  On {u.current_trip.trip_number}
                  {u.current_trip.destination ? ` to ${u.current_trip.destination}` : ''} · back by {fmtDateTime(u.current_trip.until)}
                </p>
              )}

              {u.bookings.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-3">
                    {u.on_trip_now ? 'Then booked' : 'Upcoming bookings'}
                  </p>
                  <ul className="space-y-1">
                    {u.bookings
                      .filter((b) => !(u.current_trip && b.trip_number === u.current_trip.trip_number))
                      .map((b, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-text-2">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                          <span className="tnum">{fmtDateTime(b.start)} → {fmtDateTime(b.end)}</span>
                          {b.destination && <span className="truncate text-text-3">· {b.destination}</span>}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
