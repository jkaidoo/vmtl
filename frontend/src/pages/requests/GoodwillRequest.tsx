import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gift } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, PageHeader, Textarea } from '../../components/ui'

export function GoodwillRequest() {
  const navigate = useNavigate()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    travel_date: '',
    requested_start_time: '',
    expected_end_time: '',
    destination: '',
    passenger_count: '1',
    contact_number: '',
    goodwill_reason: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.goodwill_reason.trim().length < 5) {
      toast.error('A description / explanation is required')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ data: { id: number; request_number: string } }>('/vehicle-requests/goodwill', {
        ...form,
        passenger_count: Number(form.passenger_count),
      })
      toast.success(`Goodwill request ${res.data.data.request_number} submitted for approval`)
      navigate(`/requests/${res.data.data.id}`)
    } catch (err) {
      toast.error(apiError(err, 'Could not submit goodwill request.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Goodwill Request" subtitle="Raise a goodwill trip for approval — an explanation is required" />

      <Card className="p-6">
        <div className="mb-4 flex items-start gap-3 rounded-lg bg-primary-tint p-3 text-sm text-primary">
          <Gift className="mt-0.5 h-5 w-5 shrink-0" />
          <p>Goodwill requests are checked against existing bookings and must be approved before a vehicle is assigned.</p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-2">
            <Gift className="h-4 w-4 shrink-0 text-primary" />
            <span>Goodwill trips are not tied to a department — the department is recorded as <strong>Goodwill</strong>.</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Travel Date" required><Input type="date" value={form.travel_date} onChange={(e) => set('travel_date', e.target.value)} required /></Field>
            <Field label="Start Time" required><Input type="datetime-local" value={form.requested_start_time} onChange={(e) => set('requested_start_time', e.target.value)} required /></Field>
            <Field label="End Time" required><Input type="datetime-local" value={form.expected_end_time} onChange={(e) => set('expected_end_time', e.target.value)} required /></Field>
            <Field label="Destination" required><Input value={form.destination} onChange={(e) => set('destination', e.target.value)} required /></Field>
            <Field label="Passengers" required><Input type="number" min={1} value={form.passenger_count} onChange={(e) => set('passenger_count', e.target.value)} required /></Field>
            <Field label="Contact Number"><Input value={form.contact_number} onChange={(e) => set('contact_number', e.target.value)} /></Field>
          </div>
          <Field label="Description / Explanation" required hint="Explain why this goodwill trip is needed.">
            <Textarea value={form.goodwill_reason} onChange={(e) => set('goodwill_reason', e.target.value)} required />
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
