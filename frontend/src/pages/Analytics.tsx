import { useEffect, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../lib/api'
import { fmtCedis, fmtDecimal, fmtDuration, fmtKm } from '../lib/format'
import { Card, PageHeader, Spinner, Input, Button } from '../components/ui'

interface Analytics {
  summary: { total_trips: number; completed_trips: number; total_distance: number; avg_distance: number }
  trips_by_vehicle: { label: string; trips: number; distance: number }[]
  trips_by_driver: { label: string; trips: number; distance: number }[]
  trips_by_department: { label: string; trips: number }[]
  trips_by_destination: { label: string; trips: number }[]
  monthly_utilisation: { period: string; trips: number; distance: number }[]
  trip_duration: { average_minutes: number; max_minutes: number; min_minutes: number }
  approval_statistics: { submitted: number; approved: number; rejected: number; cancelled: number; pending: number }
  peak_usage: {
    most_active_days: { label: string; trips: number }[]
    most_active_hours: { label: string; trips: number }[]
  }
  fuel: {
    summary: {
      total_cost: number
      total_litres: number
      fills: number
      avg_price_per_litre: number | null
      km_per_litre: number | null
      cost_per_km: number | null
      measured_distance: number
    }
    by_vehicle: { label: string; litres: number; cost: number; distance: number; km_per_litre: number | null }[]
    by_month: { period: string; cost: number; litres: number }[]
  }
}

const COLORS = ['#2563eb', '#16a34a', '#9333ea', '#f59e0b', '#dc2626', '#0891b2', '#db2777', '#65a30d']

export function Analytics() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = () => {
    setLoading(true)
    api
      .get<{ data: Analytics }>('/analytics', { params: { date_from: from || undefined, date_to: to || undefined } })
      .then((res) => setData(res.data.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Fleet utilisation and trends"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button onClick={load}>Apply</Button>
          </div>
        }
      />

      {loading || !data ? (
        <Spinner label="Loading analytics…" />
      ) : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total Trips" value={String(data.summary.total_trips)} />
            <Stat label="Completed" value={String(data.summary.completed_trips)} />
            <Stat label="Total Distance" value={fmtKm(data.summary.total_distance)} />
            <Stat label="Avg Trip Duration" value={fmtDuration(data.trip_duration.average_minutes)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title="Trips by Vehicle">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.trips_by_vehicle}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="trips" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Monthly Trips">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={data.monthly_utilisation}>
                  <defs>
                    <linearGradient id="grad-trips" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#009540" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#009540" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="trips" stroke="#009540" strokeWidth={2} fill="url(#grad-trips)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Trips by Department">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.trips_by_department} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="trips" fill="#9333ea" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Vehicle Usage Share">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={data.trips_by_vehicle} dataKey="trips" nameKey="label" cx="50%" cy="50%" outerRadius={90} label>
                    {data.trips_by_vehicle.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Distance Travelled Monthly">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={data.monthly_utilisation}>
                  <defs>
                    <linearGradient id="grad-distance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="distance" stroke="#f59e0b" strokeWidth={2} fill="url(#grad-distance)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Peak Usage Hours">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.peak_usage.most_active_hours}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="trips" fill="#0891b2" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Approval statistics + top destinations */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title="Approval Statistics">
              <div className="grid grid-cols-5 gap-2 text-center">
                <MiniStat label="Submitted" value={data.approval_statistics.submitted} color="text-slate-700" />
                <MiniStat label="Approved" value={data.approval_statistics.approved} color="text-green-600" />
                <MiniStat label="Rejected" value={data.approval_statistics.rejected} color="text-red-600" />
                <MiniStat label="Cancelled" value={data.approval_statistics.cancelled} color="text-slate-500" />
                <MiniStat label="Pending" value={data.approval_statistics.pending} color="text-amber-600" />
              </div>
            </ChartCard>

            <ChartCard title="Top Destinations">
              <div className="space-y-2">
                {data.trips_by_destination.slice(0, 8).map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{d.label}</span>
                    <span className="font-medium text-slate-800">{d.trips}</span>
                  </div>
                ))}
                {data.trips_by_destination.length === 0 && <p className="text-sm text-slate-400">No data.</p>}
              </div>
            </ChartCard>
          </div>

          {/* Fuel spend & economy */}
          <div className="pt-2">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Fuel Spend &amp; Economy</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Total Fuel Cost" value={fmtCedis(data.fuel.summary.total_cost)} />
              <Stat label="Litres Purchased" value={`${fmtDecimal(data.fuel.summary.total_litres, 2)} L`} />
              <Stat label="Fleet Economy" value={data.fuel.summary.km_per_litre != null ? `${fmtDecimal(data.fuel.summary.km_per_litre)} km/L` : '—'} />
              <Stat label="Cost per km" value={data.fuel.summary.cost_per_km != null ? fmtCedis(data.fuel.summary.cost_per_km) : '—'} />
            </div>

            {data.fuel.summary.fills === 0 ? (
              <Card className="mt-4 p-8 text-center text-sm text-slate-400">No fuel purchases logged for this period.</Card>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <ChartCard title="Monthly Fuel Spend">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={data.fuel.by_month}>
                      <defs>
                        <linearGradient id="grad-fuel" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#dc2626" stopOpacity={0.30} />
                          <stop offset="100%" stopColor="#dc2626" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => fmtCedis(v as number)} />
                      <Area type="monotone" dataKey="cost" name="Cost" stroke="#dc2626" strokeWidth={2} fill="url(#grad-fuel)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Fuel Cost by Vehicle">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.fuel.by_vehicle}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => fmtCedis(v as number)} />
                      <Bar dataKey="cost" name="Cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Economy by Vehicle (km/L)">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.fuel.by_vehicle.filter((v) => v.km_per_litre != null)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => `${fmtDecimal(v as number)} km/L`} />
                      <Bar dataKey="km_per_litre" name="km/L" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Litres Purchased Monthly">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.fuel.by_month}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => `${fmtDecimal(v as number, 2)} L`} />
                      <Bar dataKey="litres" name="Litres" fill="#0891b2" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
      <p className="metric mt-2 text-3xl font-bold text-text">{value}</p>
    </Card>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold text-slate-900">{title}</h2>
      {children}
    </Card>
  )
}
