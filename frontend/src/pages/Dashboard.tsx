import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Clock, FileClock, Car, Navigation, CheckCircle2, Gauge, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import { fmtKm, fmtTime } from '../lib/format'
import type { Trip, Vehicle, VehicleRequest, AuditLog } from '../lib/types'
import { Card, PageHeader, Spinner, EmptyState } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'

interface DashboardData {
  cards: {
    pending_requests: number
    todays_trips: number
    vehicles_available: number
    vehicles_on_trip: number
    completed_trips_today: number
    total_distance_month: number
  }
  todays_schedule: Trip[]
  vehicle_board: Vehicle[]
  maintenance_alerts: {
    insurance_expiring: { vehicle_number: string; expiry: string; days_left: number }[]
    roadworthy_expiring: { vehicle_number: string; expiry: string; days_left: number }[]
    service_due: { vehicle_number: string; km_since_service: number; interval: number }[]
    licence_expiring: { name: string; expiry: string; days_left: number }[]
    total: number
  }
  pending_approvals?: VehicleRequest[]
  my_recent_requests?: VehicleRequest[]
  my_trips?: Trip[]
  recent_activity?: AuditLog[]
}

const CARD_DEFS = [
  { key: 'pending_requests', label: 'Pending Requests', icon: FileClock, color: 'text-amber-600 bg-amber-50', to: '/requests?status=pending' },
  { key: 'todays_trips', label: "Today's Trips", icon: Clock, color: 'text-primary bg-primary-tint', to: '/trips' },
  { key: 'vehicles_available', label: 'Vehicles Available', icon: Car, color: 'text-green-600 bg-green-50', to: '/vehicles?status=available' },
  { key: 'vehicles_on_trip', label: 'Vehicles On Trip', icon: Navigation, color: 'text-purple-600 bg-purple-50', to: '/vehicles?status=on_trip' },
  { key: 'completed_trips_today', label: 'Completed Today', icon: CheckCircle2, color: 'text-green-600 bg-green-50', to: '/trips?status=completed' },
] as const

export function Dashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const bg = { background: location }
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ data: DashboardData }>('/dashboard').then((res) => setData(res.data.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner label="Loading dashboard…" />
  if (!data) return <EmptyState title="Could not load dashboard" />

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Overview of UITS vehicle operations" />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {CARD_DEFS.map((c) => {
          const Icon = c.icon
          return (
            <Link key={c.key} to={c.to} className="group">
              <Kpi label={c.label} icon={<Icon className="h-4 w-4" />} accent={c.color} value={String(data.cards[c.key])} />
            </Link>
          )
        })}
        <Link to="/analytics" className="group">
          <Kpi label="Distance This Month" icon={<Gauge className="h-4 w-4" />} accent="bg-primary-tint text-primary" value={fmtKm(data.cards.total_distance_month)} />
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Today's schedule */}
        <Card className="lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="font-semibold text-slate-900">Today's Schedule</h2>
          </div>
          <div className="overflow-x-auto">
            {data.todays_schedule.length === 0 ? (
              <EmptyState title="No trips scheduled today" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Vehicle</th>
                    <th className="px-3 py-2 font-medium">Driver</th>
                    <th className="px-3 py-2 font-medium">Destination</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.todays_schedule.map((t) => (
                    <tr
                      key={t.id}
                      className="cursor-pointer hover:bg-surface-2/60"
                      onClick={() => navigate(`/trips/${t.id}`, { state: bg })}
                    >
                      <td className="whitespace-nowrap px-5 py-2.5 font-medium text-slate-700">{fmtTime(t.scheduled_start)}</td>
                      <td className="px-3 py-2.5">{t.vehicle?.vehicle_number}</td>
                      <td className="px-3 py-2.5 text-slate-600">{t.driver?.name}</td>
                      <td className="px-3 py-2.5 text-slate-600">{t.request?.destination ?? '—'}</td>
                      <td className="px-5 py-2.5">
                        <StatusBadge label={t.status_label} color={t.status_color} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Maintenance alerts */}
        <Card>
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold text-slate-900">Alerts</h2>
            {data.maintenance_alerts.total > 0 && (
              <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {data.maintenance_alerts.total}
              </span>
            )}
          </div>
          <div className="space-y-2.5 p-5 text-sm">
            {data.maintenance_alerts.total === 0 && <p className="text-slate-400">Everything up to date.</p>}
            {data.maintenance_alerts.insurance_expiring.map((a, i) => (
              <AlertBox key={`ins${i}`} label={`${a.vehicle_number} insurance`} detail={`${a.days_left}d left`} critical={a.days_left <= 7} />
            ))}
            {data.maintenance_alerts.roadworthy_expiring.map((a, i) => (
              <AlertBox key={`rw${i}`} label={`${a.vehicle_number} roadworthy`} detail={`${a.days_left}d left`} critical={a.days_left <= 7} />
            ))}
            {data.maintenance_alerts.licence_expiring.map((a, i) => (
              <AlertBox key={`lic${i}`} label={`${a.name} licence`} detail={`${a.days_left}d left`} critical={a.days_left <= 7} />
            ))}
            {data.maintenance_alerts.service_due.map((a, i) => (
              <AlertBox key={`sv${i}`} label={`${a.vehicle_number} service due`} detail={`${fmtKm(a.km_since_service)}`} />
            ))}
          </div>
        </Card>
      </div>

      {/* Vehicle status board (spec §17) */}
      <div className="mt-6">
        <h2 className="mb-3 font-semibold text-slate-900">Vehicle Status</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.vehicle_board.map((v) => (
            <Link key={v.id} to={`/vehicles/${v.id}`} state={bg}>
              <Card className="p-4 transition-shadow hover:shadow-md">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-lg font-bold text-slate-900">{v.vehicle_number}</span>
                  <StatusBadge label={v.status_label} color={v.status_color} />
                </div>
                <p className="text-sm text-slate-500">
                  {v.make} {v.model} · {fmtKm(v.current_odometer)}
                </p>
                {v.active_trip ? (
                  <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    <p>Driver: {v.active_trip.driver?.name}</p>
                    <p>To: {v.active_trip.request?.destination}</p>
                    <p>Started: {fmtTime(v.active_trip.actual_start)}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">No active trip</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Driver self-service: my assigned trips */}
      {data.my_trips && (
        <div className="mt-6">
          <Card>
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h2 className="font-semibold text-slate-900">My Assigned Trips</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {data.my_trips.map((t) => (
                <Link key={t.id} to={`/trips/${t.id}`} state={bg} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {t.trip_number} · {t.request?.destination ?? t.vehicle?.vehicle_number}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t.vehicle?.vehicle_number} · {fmtTime(t.scheduled_start)}
                    </p>
                  </div>
                  <StatusBadge label={t.status_label} color={t.status_color} />
                </Link>
              ))}
              {data.my_trips.length === 0 && <EmptyState title="No trips assigned" description="Assigned trips will appear here." />}
            </div>
          </Card>
        </div>
      )}

      {/* Pending approvals / my requests / recent activity */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {(data.pending_approvals || data.my_recent_requests) && (
          <Card>
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h2 className="font-semibold text-slate-900">{data.pending_approvals ? 'Pending Approvals' : 'My Recent Requests'}</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {(data.pending_approvals ?? data.my_recent_requests ?? []).map((r) => (
                <Link key={r.id} to={`/requests/${r.id}`} state={bg} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{r.request_number} · {r.destination}</p>
                    <p className="text-xs text-slate-500">{r.requester?.name ?? r.purpose}</p>
                  </div>
                  <StatusBadge label={r.status_label} color={r.status_color} />
                </Link>
              ))}
              {(data.pending_approvals ?? data.my_recent_requests ?? []).length === 0 && <EmptyState title="Nothing here yet" />}
            </div>
          </Card>
        )}

        {data.recent_activity && (
          <Card>
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h2 className="font-semibold text-slate-900">Recent Activity</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {data.recent_activity.map((a) => (
                <div key={a.id} className="px-5 py-2.5 text-sm">
                  <p className="text-slate-700">{a.description}</p>
                </div>
              ))}
              {data.recent_activity.length === 0 && <EmptyState title="No activity yet" />}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, icon, accent, value }: { label: string; icon: React.ReactNode; accent: string; value: string }) {
  return (
    <Card className="p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-primary group-hover:shadow-elevated group-focus-visible:ring-2 group-focus-visible:ring-primary/30">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
        <div className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-lg', accent)}>{icon}</div>
      </div>
      <p className="metric mt-3 text-3xl font-bold text-text">{value}</p>
    </Card>
  )
}

// WattVision-style alert box: tinted fill + 4px left accent (amber = warning, red = critical).
function AlertBox({ label, detail, critical }: { label: string; detail: string; critical?: boolean }) {
  return (
    <div className={clsx('alert-accent rounded-lg px-3 py-2', critical ? 'border-danger bg-danger/10' : 'border-warning bg-warning/10')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-2">{label}</span>
        <span className={clsx('tnum text-xs font-semibold', critical ? 'text-danger' : 'text-warning')}>{detail}</span>
      </div>
    </div>
  )
}
