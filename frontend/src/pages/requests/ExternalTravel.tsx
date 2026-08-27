import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plane } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { OrgUnitSelect } from '../../components/OrgUnitSelect'
import { Button, Card, Field, Input, PageHeader, Textarea } from '../../components/ui'

export function ExternalTravel() {
  const navigate = useNavigate()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    external_org: '',
    org_unit_id: '',
    travel_date: '',
    requested_start_time: '',
    expected_end_time: '',
    expected_duration_days: '',
    destination: '',
    passenger_count: '1',
    contact_number: '',
    start_odometer: '',
    purpose: '',
    remarks: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.external_org.trim().length < 2) {
      toast.error('State the requesting arm / unit')
      return
    }
    if (form.purpose.trim().length < 5) {
      toast.error('A reason for the trip is required')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ data: { id: number; request_number: string } }>('/vehicle-requests/external', {
        ...form,
        org_unit_id: form.org_unit_id ? Number(form.org_unit_id) : null,
        passenger_count: Number(form.passenger_count),
        expected_duration_days: Number(form.expected_duration_days),
        start_odometer: Number(form.start_odometer),
      })
      toast.success(`External travel request ${res.data.data.request_number} submitted for approval`)
      navigate(`/requests/${res.data.data.id}`)
    } catch (err) {
      toast.error(apiError(err, 'Could not submit external travel request.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="External Travel" subtitle="Log a vehicle request from another arm of the university" />

      <Card className="p-6">
        <div className="mb-4 flex items-start gap-3 rounded-lg bg-primary-tint p-3 text-sm text-primary">
          <Plane className="mt-0.5 h-5 w-5 shrink-0" />
          <p>For extended trips (often over weekends) requested by other university units. Record the reason, expected duration, and the odometer reading before the trip begins.</p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Requesting Arm / Unit" required hint="Which university arm is requesting the vehicle.">
              <Input value={form.external_org} onChange={(e) => set('external_org', e.target.value)} placeholder="e.g. College of Health Sciences" required />
            </Field>
            <Field label="Internal Org Unit" hint="Which unit's fleet serves this.">
              <OrgUnitSelect value={form.org_unit_id} onChange={(v) => set('org_unit_id', v)} noneLabel="— Your unit (default) —" />
            </Field>
            <Field label="Travel Date" required><Input type="date" value={form.travel_date} onChange={(e) => set('travel_date', e.target.value)} required /></Field>
            <Field label="Expected Duration (days)" required><Input type="number" min={1} value={form.expected_duration_days} onChange={(e) => set('expected_duration_days', e.target.value)} required /></Field>
            <Field label="Departure" required><Input type="datetime-local" value={form.requested_start_time} onChange={(e) => set('requested_start_time', e.target.value)} required /></Field>
            <Field label="Expected Return" required><Input type="datetime-local" value={form.expected_end_time} onChange={(e) => set('expected_end_time', e.target.value)} required /></Field>
            <Field label="Destination" required><Input value={form.destination} onChange={(e) => set('destination', e.target.value)} required /></Field>
            <Field label="Passengers" required><Input type="number" min={1} value={form.passenger_count} onChange={(e) => set('passenger_count', e.target.value)} required /></Field>
            <Field label="Odometer Before Trip (km)" required hint="Reading at hand-over.">
              <Input type="number" min={0} value={form.start_odometer} onChange={(e) => set('start_odometer', e.target.value)} required />
            </Field>
            <Field label="Contact Number"><Input value={form.contact_number} onChange={(e) => set('contact_number', e.target.value)} /></Field>
          </div>
          <Field label="Reason for Travel" required hint="Purpose of the external trip.">
            <Textarea value={form.purpose} onChange={(e) => set('purpose', e.target.value)} required />
          </Field>
          <Field label="Additional Remarks">
            <Textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" loading={loading}>Submit for Approval</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
