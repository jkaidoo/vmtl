import { useEffect, useMemo, useState } from 'react'
import { Plus, Fuel as FuelIcon } from 'lucide-react'
import { useList } from '../hooks/useList'
import { api, apiError } from '../lib/api'
import { useToast } from '../components/Toast'
import type { Driver, FuelLog, Vehicle } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { Pagination } from '../components/Pagination'
import { DataTable } from '../components/DataTable'
import { Modal } from '../components/Modal'

export function Fuel() {
  const [vehicleId, setVehicleId] = useState('')
  const [creating, setCreating] = useState(false)
  const { items, page, lastPage, total, loading, setPage, reload } = useList<FuelLog>('/fuel-logs', {
    vehicle_id: vehicleId || undefined,
  })
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  useEffect(() => {
    api.get<{ data: Vehicle[] }>('/vehicles', { params: { all: true } }).then((r) => setVehicles(r.data.data)).catch(() => undefined)
  }, [])

  return (
    <div>
      <PageHeader
        title="Fuel"
        subtitle="Fuel purchase log — odometer, litres, price and economy"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Log Fuel Purchase</Button>}
      />

      <Card>
        <div className="border-b border-slate-100 p-4">
          <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="sm:w-64">
            <option value="">All vehicles</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
          </Select>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No fuel purchases logged" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(f) => f.id}
            columns={[
              { key: 'veh', header: 'Vehicle', primary: true, cell: (f) => <span className="font-medium text-text">{f.vehicle?.vehicle_number}</span> },
              { key: 'date', header: 'Date', cell: (f) => fmtDateTime(f.purchase_date) },
              { key: 'odo', header: 'Odometer', cell: (f) => `${f.odometer.toLocaleString()} km` },
              { key: 'dist', header: 'Since last', cell: (f) => (f.distance_since_last != null ? `${f.distance_since_last.toLocaleString()} km` : '—') },
              { key: 'litres', header: 'Litres', cell: (f) => `${f.litres} L` },
              { key: 'ppl', header: 'Price/L', cell: (f) => `₵${f.price_per_litre}` },
              { key: 'cost', header: 'Total', cell: (f) => `₵${f.total_cost}` },
              { key: 'eco', header: 'Economy', cell: (f) => (f.km_per_litre != null ? `${f.km_per_litre} km/L` : '—') },
            ]}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>

      {creating && <FuelFormModal vehicles={vehicles} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
    </div>
  )
}

function FuelFormModal({ vehicles, onClose, onSaved }: { vehicles: Vehicle[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [form, setForm] = useState({
    vehicle_id: '',
    driver_id: '',
    purchase_date: new Date().toISOString().slice(0, 16),
    odometer: '',
    litres: '',
    price_per_litre: '',
    fuel_type: '',
    station: '',
    notes: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    api.get<{ data: Driver[] }>('/drivers', { params: { all: true } }).then((r) => setDrivers(r.data.data)).catch(() => undefined)
  }, [])

  const total = useMemo(() => {
    const l = parseFloat(form.litres)
    const p = parseFloat(form.price_per_litre)
    return Number.isFinite(l) && Number.isFinite(p) ? (l * p).toFixed(2) : null
  }, [form.litres, form.price_per_litre])

  const submit = async () => {
    if (!form.vehicle_id) {
      toast.error('Select a vehicle')
      return
    }
    setLoading(true)
    try {
      await api.post('/fuel-logs', {
        ...form,
        vehicle_id: Number(form.vehicle_id),
        driver_id: form.driver_id ? Number(form.driver_id) : null,
        odometer: Number(form.odometer),
        litres: Number(form.litres),
        price_per_litre: Number(form.price_per_litre),
        fuel_type: form.fuel_type || null,
        station: form.station || null,
        notes: form.notes || null,
      })
      toast.success('Fuel purchase logged')
      onSaved()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Log Fuel Purchase"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg bg-primary-tint p-3 text-sm text-primary">
        <FuelIcon className="mt-0.5 h-5 w-5 shrink-0" />
        <p>The previous purchase's odometer is captured automatically, so distance-per-tank and fuel economy are derived across consecutive fills.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vehicle" required>
          <Select value={form.vehicle_id} onChange={(e) => set('vehicle_id', e.target.value)}>
            <option value="">— Select —</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
          </Select>
        </Field>
        <Field label="Driver (optional)">
          <Select value={form.driver_id} onChange={(e) => set('driver_id', e.target.value)}>
            <option value="">— None —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Purchase Date" required><Input type="datetime-local" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} /></Field>
        <Field label="Odometer (km)" required><Input type="number" min={0} value={form.odometer} onChange={(e) => set('odometer', e.target.value)} /></Field>
        <Field label="Litres" required><Input type="number" step="0.01" min={0} value={form.litres} onChange={(e) => set('litres', e.target.value)} /></Field>
        <Field label="Price per Litre (₵)" required><Input type="number" step="0.01" min={0} value={form.price_per_litre} onChange={(e) => set('price_per_litre', e.target.value)} /></Field>
        <Field label="Total Cost (₵)" hint="Calculated automatically.">
          <Input value={total ?? ''} readOnly placeholder="—" className="bg-surface-2" />
        </Field>
        <Field label="Fuel Type"><Input value={form.fuel_type} onChange={(e) => set('fuel_type', e.target.value)} placeholder="Petrol / Diesel" /></Field>
        <Field label="Station"><Input value={form.station} onChange={(e) => set('station', e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label="Notes"><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
    </Modal>
  )
}
