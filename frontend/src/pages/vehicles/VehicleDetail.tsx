import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Fuel as FuelIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useInRouteModal } from '../../components/RouteModal'
import type { FuelLog, Trip, Vehicle } from '../../lib/types'
import { fmtCedis, fmtDate, fmtDateTime, fmtDecimal, fmtKm } from '../../lib/format'
import { Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import { VehicleFormModal } from './VehicleFormModal'

interface FuelSummary {
  total_cost: number
  total_litres: number
  fills: number
  avg_price_per_litre: number | null
  km_per_litre: number | null
  cost_per_km: number | null
  measured_distance: number
  last_purchase_date: string | null
}

export function VehicleDetail() {
  const { id } = useParams()
  const { managesFleet } = useAuth()
  const inModal = useInRouteModal()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [trips, setTrips] = useState<Trip[]>([])
  const [fuel, setFuel] = useState<{ summary: FuelSummary; recent: FuelLog[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<{ data: Vehicle }>(`/vehicles/${id}`),
      api.get<{ data: Trip[] }>(`/vehicles/${id}/trips`),
      api.get<{ summary: FuelSummary; recent: FuelLog[] }>(`/vehicles/${id}/fuel`),
    ])
      .then(([v, t, f]) => {
        setVehicle(v.data.data)
        setTrips(t.data.data)
        setFuel(f.data)
      })
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => load(), [load])

  if (loading) return <Spinner label="Loading vehicle…" />
  if (!vehicle) return <p className="text-slate-500">Vehicle not found.</p>

  return (
    <div className={inModal ? '' : 'mx-auto max-w-4xl'}>
      {!inModal && (
        <Link to="/vehicles" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to vehicles
        </Link>
      )}

      <PageHeader
        title={vehicle.vehicle_number}
        subtitle={[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge label={vehicle.status_label} color={vehicle.status_color} />
            {managesFleet && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h2 className="mb-4 font-semibold text-slate-900">Details</h2>
          <dl className="space-y-3">
            <Detail label="Registration" value={vehicle.registration_number} />
            <Detail label="Type" value={vehicle.vehicle_type} />
            <Detail label="Colour" value={vehicle.colour} />
            <Detail label="Capacity" value={`${vehicle.capacity} seats`} />
            <Detail label="Current Odometer" value={fmtKm(vehicle.current_odometer)} />
            <Detail label="Insurance Expiry" value={fmtDate(vehicle.insurance_expiry)} />
            <Detail label="Roadworthy Expiry" value={fmtDate(vehicle.roadworthy_expiry)} />
            <Detail label="Last Service" value={fmtDate(vehicle.last_service_date)} />
            <Detail label="Service Interval" value={vehicle.service_interval_km ? fmtKm(vehicle.service_interval_km) : '—'} />
          </dl>
          {vehicle.notes && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{vehicle.notes}</p>}
        </Card>

        <Card className="lg:col-span-2">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="font-semibold text-slate-900">Trip History</h2>
          </div>
          {trips.length === 0 ? (
            <EmptyState title="No trips recorded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2 font-medium">Trip #</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Driver</th>
                    <th className="px-3 py-2 font-medium">Distance</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {trips.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <Link to={`/trips/${t.id}`} className="font-medium text-primary hover:underline">{t.trip_number}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{fmtDateTime(t.scheduled_start)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{t.driver?.name}</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmtKm(t.distance)}</td>
                      <td className="px-5 py-2.5"><StatusBadge label={t.status_label} color={t.status_color} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Fuel spend & economy */}
      <Card className="mt-6">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
          <FuelIcon className="h-4 w-4 text-text-3" />
          <h2 className="font-semibold text-slate-900">Fuel Spend &amp; Economy</h2>
          {fuel?.summary.last_purchase_date && (
            <span className="ml-auto text-xs text-text-3">Last fill {fmtDate(fuel.summary.last_purchase_date)}</span>
          )}
        </div>

        {!fuel || fuel.summary.fills === 0 ? (
          <EmptyState title="No fuel purchases logged" description="Fuel logged for this vehicle will appear here." />
        ) : (
          <div className="p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <FuelStat label="Total Spend" value={fmtCedis(fuel.summary.total_cost)} />
              <FuelStat label="Litres" value={`${fmtDecimal(fuel.summary.total_litres, 2)} L`} />
              <FuelStat label="Economy" value={fuel.summary.km_per_litre != null ? `${fmtDecimal(fuel.summary.km_per_litre)} km/L` : '—'} />
              <FuelStat label="Cost / km" value={fuel.summary.cost_per_km != null ? fmtCedis(fuel.summary.cost_per_km) : '—'} />
              <FuelStat label="Avg Price / L" value={fuel.summary.avg_price_per_litre != null ? fmtCedis(fuel.summary.avg_price_per_litre) : '—'} />
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Odometer</th>
                    <th className="px-3 py-2 font-medium">Since last</th>
                    <th className="px-3 py-2 font-medium">Litres</th>
                    <th className="px-3 py-2 font-medium">Price/L</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">km/L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {fuel.recent.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3 text-slate-600">{fmtDateTime(f.purchase_date)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{f.odometer.toLocaleString()} km</td>
                      <td className="px-3 py-2.5 text-slate-600">{f.distance_since_last != null ? `${f.distance_since_last.toLocaleString()} km` : '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{f.litres} L</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmtCedis(f.price_per_litre)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{fmtCedis(f.total_cost)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{f.km_per_litre != null ? f.km_per_litre : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {editing && <VehicleFormModal vehicle={vehicle} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} />}
    </div>
  )
}

function FuelStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value || '—'}</dd>
    </div>
  )
}
