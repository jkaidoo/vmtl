import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useList } from '../hooks/useList'
import { api, apiError } from '../lib/api'
import { useMeta } from '../context/MetaContext'
import { useToast } from '../components/Toast'
import type { MaintenanceRecord, Vehicle } from '../lib/types'
import { fmtDate } from '../lib/format'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { Pagination } from '../components/Pagination'
import { DataTable } from '../components/DataTable'
import { Modal } from '../components/Modal'

export function Maintenance() {
  const [vehicleId, setVehicleId] = useState('')
  const [creating, setCreating] = useState(false)
  const { items, page, lastPage, total, loading, setPage, reload } = useList<MaintenanceRecord>('/maintenance-records', {
    vehicle_id: vehicleId || undefined,
  })
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  useEffect(() => {
    api.get<{ data: Vehicle[] }>('/vehicles', { params: { all: true } }).then((r) => setVehicles(r.data.data)).catch(() => undefined)
  }, [])

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Service records and vehicle upkeep"
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Record Maintenance</Button>}
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
          <EmptyState title="No maintenance records" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(m) => m.id}
            columns={[
              { key: 'veh', header: 'Vehicle', primary: true, cell: (m) => <span className="font-medium text-text">{m.vehicle?.vehicle_number}</span> },
              { key: 'date', header: 'Date', cell: (m) => fmtDate(m.service_date) },
              { key: 'type', header: 'Type', cell: (m) => m.maintenance_type_label },
              { key: 'odo', header: 'Odometer', cell: (m) => (m.odometer ? `${m.odometer.toLocaleString()} km` : '—') },
              { key: 'cost', header: 'Cost', cell: (m) => (m.cost ? `₵${m.cost}` : '—') },
              { key: 'prov', header: 'Provider', cell: (m) => m.service_provider ?? '—' },
              { key: 'next', header: 'Next Service', cell: (m) => fmtDate(m.next_service_date) },
            ]}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>

      {creating && <MaintenanceFormModal vehicles={vehicles} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
    </div>
  )
}

function MaintenanceFormModal({ vehicles, onClose, onSaved }: { vehicles: Vehicle[]; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    vehicle_id: '',
    maintenance_type: 'general_service',
    service_date: new Date().toISOString().slice(0, 10),
    odometer: '',
    description: '',
    cost: '',
    service_provider: '',
    next_service_date: '',
    next_service_odometer: '',
    remarks: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.vehicle_id) {
      toast.error('Select a vehicle')
      return
    }
    setLoading(true)
    try {
      await api.post('/maintenance-records', {
        ...form,
        vehicle_id: Number(form.vehicle_id),
        odometer: form.odometer ? Number(form.odometer) : null,
        cost: form.cost ? Number(form.cost) : null,
        next_service_odometer: form.next_service_odometer ? Number(form.next_service_odometer) : null,
        next_service_date: form.next_service_date || null,
      })
      toast.success('Maintenance recorded')
      onSaved()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Record Maintenance" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vehicle" required>
          <Select value={form.vehicle_id} onChange={(e) => set('vehicle_id', e.target.value)}>
            <option value="">— Select —</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
          </Select>
        </Field>
        <Field label="Type" required>
          <Select value={form.maintenance_type} onChange={(e) => set('maintenance_type', e.target.value)}>
            {meta?.enums.maintenance_type.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Service Date" required><Input type="date" value={form.service_date} onChange={(e) => set('service_date', e.target.value)} /></Field>
        <Field label="Odometer (km)"><Input type="number" value={form.odometer} onChange={(e) => set('odometer', e.target.value)} /></Field>
        <Field label="Cost (₵)"><Input type="number" step="0.01" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Service Provider"><Input value={form.service_provider} onChange={(e) => set('service_provider', e.target.value)} /></Field>
        <Field label="Next Service Date"><Input type="date" value={form.next_service_date} onChange={(e) => set('next_service_date', e.target.value)} /></Field>
        <Field label="Next Service Odometer"><Input type="number" value={form.next_service_odometer} onChange={(e) => set('next_service_odometer', e.target.value)} /></Field>
      </div>
      <div className="mt-4"><Field label="Description"><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></Field></div>
      <div className="mt-3"><Field label="Remarks"><Textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field></div>
    </Modal>
  )
}
