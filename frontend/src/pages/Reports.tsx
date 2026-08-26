import { useEffect, useState } from 'react'
import { Download, FileText, FileSpreadsheet, FileType } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useMeta } from '../context/MetaContext'
import { useToast } from '../components/Toast'
import type { Vehicle } from '../lib/types'
import { fmtCedis, fmtDecimal, fmtKm } from '../lib/format'
import { Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from '../components/ui'
import { DataTable } from '../components/DataTable'

type ReportType = 'trips' | 'fuel'

interface TripRow {
  trip_number: string
  date: string
  vehicle: string
  driver: string
  requester: string
  department: string
  destination: string
  purpose: string
  start: string
  end: string
  distance: number | null
  status: string
}

interface FuelRow {
  date: string
  vehicle: string
  driver: string
  odometer: number
  distance_since_last: number | string
  litres: string
  price_per_litre: string
  total_cost: string
  km_per_litre: number | string
  fuel_type: string
  station: string
  recorded_by: string
}

interface TripTotals { trips: number; completed: number; distance: number }
interface FuelTotals { fills: number; litres: number; cost: number; distance: number; km_per_litre: number | null }

export function Reports() {
  const meta = useMeta()
  const toast = useToast()
  const [type, setType] = useState<ReportType>('trips')
  const [loadedType, setLoadedType] = useState<ReportType>('trips')
  const [filters, setFilters] = useState({ date_from: '', date_to: '', vehicle_id: '', status: '', destination: '' })
  const [rows, setRows] = useState<(TripRow | FuelRow)[]>([])
  const [tripTotals, setTripTotals] = useState<TripTotals>({ trips: 0, completed: 0, distance: 0 })
  const [fuelTotals, setFuelTotals] = useState<FuelTotals>({ fills: 0, litres: 0, cost: 0, distance: 0, km_per_litre: null })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState('')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])

  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const params = () => ({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), type })

  const load = () => {
    setLoading(true)
    api
      .get<{ data: { type: ReportType; rows: (TripRow | FuelRow)[]; totals: TripTotals | FuelTotals } }>('/reports', { params: params() })
      .then((res) => {
        const d = res.data.data
        setRows(d.rows)
        setLoadedType(d.type)
        if (d.type === 'fuel') setFuelTotals(d.totals as FuelTotals)
        else setTripTotals(d.totals as TripTotals)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    api.get<{ data: Vehicle[] }>('/vehicles', { params: { all: true } }).then((r) => setVehicles(r.data.data)).catch(() => undefined)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format)
    try {
      const res = await api.get('/reports/export', { params: { ...params(), format }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type === 'fuel' ? 'fuel-report' : 'vehicle-usage-report'}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(apiError(e, 'Export failed'))
    } finally {
      setExporting('')
    }
  }

  const isFuel = loadedType === 'fuel'

  return (
    <div>
      <PageHeader title="Reports" subtitle="Vehicle usage & fuel reports — exports respect the active filters" />

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Report</label>
            <Select value={type} onChange={(e) => setType(e.target.value as ReportType)}>
              <option value="trips">Vehicle Usage</option>
              <option value="fuel">Fuel Log</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">From</label>
            <Input type="date" value={filters.date_from} onChange={(e) => set('date_from', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">To</label>
            <Input type="date" value={filters.date_to} onChange={(e) => set('date_to', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Vehicle</label>
            <Select value={filters.vehicle_id} onChange={(e) => set('vehicle_id', e.target.value)}>
              <option value="">All</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
            </Select>
          </div>
          {type === 'trips' ? (
            <div>
              <label className="mb-1 block text-xs text-slate-500">Status</label>
              <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">All</option>
                {meta?.enums.trip_status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </div>
          ) : (
            <div className="hidden lg:block" />
          )}
          {type === 'trips' && (
            <div>
              <label className="mb-1 block text-xs text-slate-500">Destination</label>
              <Input placeholder="Contains…" value={filters.destination} onChange={(e) => set('destination', e.target.value)} />
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={load}>Run Report</Button>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />} loading={exporting === 'csv'} onClick={() => doExport('csv')}>CSV</Button>
            <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting === 'xlsx'} onClick={() => doExport('xlsx')}>Excel</Button>
            <Button variant="secondary" icon={<FileType className="h-4 w-4" />} loading={exporting === 'pdf'} onClick={() => doExport('pdf')}>PDF</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-6 border-b border-slate-100 px-5 py-3 text-sm">
          {isFuel ? (
            <>
              <span><span className="text-slate-500">Fills:</span> <strong>{fuelTotals.fills}</strong></span>
              <span><span className="text-slate-500">Litres:</span> <strong>{fmtDecimal(fuelTotals.litres, 2)} L</strong></span>
              <span><span className="text-slate-500">Total cost:</span> <strong>{fmtCedis(fuelTotals.cost)}</strong></span>
              <span><span className="text-slate-500">Distance:</span> <strong>{fmtKm(fuelTotals.distance)}</strong></span>
              <span><span className="text-slate-500">Economy:</span> <strong>{fuelTotals.km_per_litre != null ? `${fmtDecimal(fuelTotals.km_per_litre)} km/L` : '—'}</strong></span>
            </>
          ) : (
            <>
              <span><span className="text-slate-500">Trips:</span> <strong>{tripTotals.trips}</strong></span>
              <span><span className="text-slate-500">Completed:</span> <strong>{tripTotals.completed}</strong></span>
              <span><span className="text-slate-500">Distance:</span> <strong>{fmtKm(tripTotals.distance)}</strong></span>
            </>
          )}
        </div>
        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No records" description="Adjust the filters and run the report." icon={<Download className="h-8 w-8" />} />
        ) : isFuel ? (
          <DataTable
            rows={rows as FuelRow[]}
            rowKey={(r) => `${r.date}-${r.vehicle}-${r.odometer}`}
            columns={[
              { key: 'date', header: 'Date', primary: true, cell: (r) => <span className="font-medium text-text">{r.date}</span> },
              { key: 'veh', header: 'Vehicle', cell: (r) => r.vehicle },
              { key: 'driver', header: 'Driver', cell: (r) => r.driver },
              { key: 'odo', header: 'Odometer', cell: (r) => `${r.odometer.toLocaleString()} km` },
              { key: 'since', header: 'Since last', cell: (r) => (typeof r.distance_since_last === 'number' ? `${r.distance_since_last.toLocaleString()} km` : '—') },
              { key: 'litres', header: 'Litres', cell: (r) => `${r.litres} L` },
              { key: 'ppl', header: 'Price/L', cell: (r) => fmtCedis(r.price_per_litre) },
              { key: 'total', header: 'Total', cell: (r) => fmtCedis(r.total_cost) },
              { key: 'eco', header: 'km/L', cell: (r) => (typeof r.km_per_litre === 'number' ? r.km_per_litre : '—') },
              { key: 'station', header: 'Station', cell: (r) => r.station },
            ]}
          />
        ) : (
          <DataTable
            rows={rows as TripRow[]}
            rowKey={(r) => r.trip_number}
            columns={[
              { key: 'trip', header: 'Trip #', primary: true, cell: (r) => <span className="font-medium text-text">{r.trip_number}</span> },
              { key: 'date', header: 'Date', cell: (r) => r.date },
              { key: 'veh', header: 'Vehicle', cell: (r) => r.vehicle },
              { key: 'driver', header: 'Driver', cell: (r) => r.driver },
              { key: 'req', header: 'Requester', cell: (r) => r.requester },
              { key: 'dest', header: 'Destination', cell: (r) => r.destination },
              { key: 'dist', header: 'Distance', cell: (r) => (r.distance != null ? `${r.distance} km` : '—') },
              { key: 'status', header: 'Status', badge: true, cell: (r) => r.status },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
