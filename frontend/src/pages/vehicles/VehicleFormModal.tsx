import { useState } from 'react'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useMeta } from '../../context/MetaContext'
import { useToast } from '../../components/Toast'
import type { Vehicle } from '../../lib/types'
import { Button, Field, Input, Select, Textarea } from '../../components/ui'
import { OrgUnitSelect } from '../../components/OrgUnitSelect'
import { Modal } from '../../components/Modal'

export function VehicleFormModal({ vehicle, onClose, onSaved }: { vehicle?: Vehicle; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth()
  const meta = useMeta()
  const toast = useToast()
  const isAdmin = can('vehicles.manage')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    vehicle_number: vehicle?.vehicle_number ?? '',
    registration_number: vehicle?.registration_number ?? '',
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year?.toString() ?? '',
    vehicle_type: vehicle?.vehicle_type ?? '',
    colour: vehicle?.colour ?? '',
    capacity: vehicle?.capacity?.toString() ?? '5',
    current_odometer: vehicle?.current_odometer?.toString() ?? '0',
    status: vehicle?.status ?? 'available',
    insurance_expiry: vehicle?.insurance_expiry ?? '',
    roadworthy_expiry: vehicle?.roadworthy_expiry ?? '',
    service_interval_km: vehicle?.service_interval_km?.toString() ?? '',
    last_service_date: vehicle?.last_service_date ?? '',
    last_service_odometer: vehicle?.last_service_odometer?.toString() ?? '',
    org_unit_id: vehicle?.org_unit_id != null ? String(vehicle.org_unit_id) : '',
    notes: vehicle?.notes ?? '',
    active: vehicle?.active ?? true,
  })

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    setLoading(true)
    try {
      const payload = {
        ...form,
        year: form.year ? Number(form.year) : null,
        capacity: Number(form.capacity),
        current_odometer: Number(form.current_odometer),
        service_interval_km: form.service_interval_km ? Number(form.service_interval_km) : null,
        last_service_odometer: form.last_service_odometer ? Number(form.last_service_odometer) : null,
        insurance_expiry: form.insurance_expiry || null,
        roadworthy_expiry: form.roadworthy_expiry || null,
        last_service_date: form.last_service_date || null,
        org_unit_id: form.org_unit_id ? Number(form.org_unit_id) : null,
      }
      if (vehicle) await api.put(`/vehicles/${vehicle.id}`, payload)
      else await api.post('/vehicles', payload)
      toast.success(vehicle ? 'Vehicle updated' : 'Vehicle added')
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
      title={vehicle ? `Edit ${vehicle.vehicle_number}` : 'Add Vehicle'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vehicle Number" required><Input value={form.vehicle_number} onChange={(e) => set('vehicle_number', e.target.value)} disabled={!isAdmin} placeholder="UITS-03" /></Field>
        <Field label="Registration" required><Input value={form.registration_number} onChange={(e) => set('registration_number', e.target.value)} disabled={!isAdmin} /></Field>
        <Field label="Make"><Input value={form.make} onChange={(e) => set('make', e.target.value)} /></Field>
        <Field label="Model"><Input value={form.model} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Year"><Input type="number" value={form.year} onChange={(e) => set('year', e.target.value)} /></Field>
        <Field label="Type"><Input value={form.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value)} placeholder="Pickup" /></Field>
        <Field label="Colour"><Input value={form.colour} onChange={(e) => set('colour', e.target.value)} /></Field>
        <Field label="Capacity" required><Input type="number" min={1} value={form.capacity} onChange={(e) => set('capacity', e.target.value)} /></Field>
        <Field label="Current Odometer"><Input type="number" value={form.current_odometer} onChange={(e) => set('current_odometer', e.target.value)} disabled={!isAdmin} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {meta?.enums.vehicle_status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Insurance Expiry"><Input type="date" value={form.insurance_expiry} onChange={(e) => set('insurance_expiry', e.target.value)} /></Field>
        <Field label="Roadworthy Expiry"><Input type="date" value={form.roadworthy_expiry} onChange={(e) => set('roadworthy_expiry', e.target.value)} /></Field>
        <Field label="Service Interval (km)"><Input type="number" value={form.service_interval_km} onChange={(e) => set('service_interval_km', e.target.value)} /></Field>
        <Field label="Last Service Date"><Input type="date" value={form.last_service_date} onChange={(e) => set('last_service_date', e.target.value)} /></Field>
        <Field label="Last Service Odometer"><Input type="number" value={form.last_service_odometer} onChange={(e) => set('last_service_odometer', e.target.value)} /></Field>
        <Field label="Org Unit" hint="Which unit this vehicle belongs to."><OrgUnitSelect value={form.org_unit_id} onChange={(v) => set('org_unit_id', v)} noneLabel="— Unassigned —" /></Field>
      </div>
      <div className="mt-4"><Field label="Notes"><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      {isAdmin && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Active (available for use)
        </label>
      )}
    </Modal>
  )
}
