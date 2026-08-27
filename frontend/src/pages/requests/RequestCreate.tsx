import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useMeta } from '../../context/MetaContext'
import { useToast } from '../../components/Toast'
import type { AvailabilityCheck } from '../../lib/types'
import { fmtDateTime } from '../../lib/format'
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from '../../components/ui'

const schema = z
  .object({
    org_unit_id: z.string().optional(),
    travel_date: z.string().min(1, 'Travel date is required'),
    requested_start_time: z.string().min(1, 'Departure time is required'),
    expected_end_time: z.string().min(1, 'Return time is required'),
    destination: z.string().min(1, 'Destination cannot be empty'),
    additional_destination: z.string().optional(),
    purpose: z.string().min(1, 'Purpose cannot be empty'),
    passenger_count: z.number({ message: 'Enter a number' }).int().min(1, 'Must be at least 1 passenger'),
    contact_number: z.string().optional(),
    special_requirements: z.string().optional(),
    remarks: z.string().optional(),
  })
  .refine((d) => new Date(d.requested_start_time) < new Date(d.expected_end_time), {
    message: 'Departure must be before the expected return time',
    path: ['expected_end_time'],
  })

type FormValues = z.infer<typeof schema>

export function RequestCreate() {
  const meta = useMeta()
  const navigate = useNavigate()
  const toast = useToast()
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { passenger_count: 1 },
  })

  // Live availability for the chosen window: eliminate fully-booked windows so a
  // requester can only submit a window with a free vehicle + driver.
  const [avail, setAvail] = useState<AvailabilityCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const start = watch('requested_start_time')
  const end = watch('expected_end_time')
  const passengers = watch('passenger_count')

  useEffect(() => {
    if (!start || !end || new Date(start) >= new Date(end)) {
      setAvail(null)
      return
    }
    setChecking(true)
    const handle = setTimeout(() => {
      api
        .get<{ data: AvailabilityCheck }>('/availability/check', {
          params: { start, end, passengers: passengers || 1 },
        })
        .then((r) => setAvail(r.data.data))
        .catch(() => setAvail(null))
        .finally(() => setChecking(false))
    }, 450)
    return () => clearTimeout(handle)
  }, [start, end, passengers])

  const blocked = avail != null && !avail.is_bookable

  const onSubmit = async (values: FormValues) => {
    if (blocked) {
      toast.error('This time window is fully booked. Please choose another window.')
      return
    }
    try {
      const payload = { ...values, org_unit_id: values.org_unit_id ? Number(values.org_unit_id) : null }
      const res = await api.post<{ data: { id: number; request_number: string } }>('/vehicle-requests', payload)
      toast.success(`Request ${res.data.data.request_number} submitted`)
      navigate(`/requests/${res.data.data.id}`)
    } catch (err) {
      const message = apiError(err, 'Could not submit request.')
      setError('root', { message })
      toast.error(message)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New Vehicle Request"
        subtitle="Complete the details for your official trip"
        actions={
          <Link to="/requests/availability">
            <Button type="button" variant="secondary" icon={<CalendarClock className="h-4 w-4" />}>Check availability</Button>
          </Link>
        }
      />

      <Card className="p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Org Unit" error={errors.org_unit_id?.message} hint="Defaults to your unit.">
              <Select {...register('org_unit_id')}>
                <option value="">— Your unit (default) —</option>
                {meta?.org_units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {'  '.repeat(u.depth) + u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Travel Date" required error={errors.travel_date?.message}>
              <Input type="date" {...register('travel_date')} />
            </Field>
            <Field label="Requested Departure" required error={errors.requested_start_time?.message}>
              <Input type="datetime-local" {...register('requested_start_time')} />
            </Field>
            <Field label="Expected Return" required error={errors.expected_end_time?.message}>
              <Input type="datetime-local" {...register('expected_end_time')} />
            </Field>
            <Field label="Destination" required error={errors.destination?.message}>
              <Input placeholder="e.g. KNUST Hospital" {...register('destination')} />
            </Field>
            <Field label="Additional Destination" error={errors.additional_destination?.message}>
              <Input placeholder="Optional" {...register('additional_destination')} />
            </Field>
            <Field label="Number of Passengers" required error={errors.passenger_count?.message}>
              <Input type="number" min={1} {...register('passenger_count', { valueAsNumber: true })} />
            </Field>
            <Field label="Contact Number" error={errors.contact_number?.message}>
              <Input placeholder="Optional" {...register('contact_number')} />
            </Field>
          </div>

          <AvailabilityBanner checking={checking} avail={avail} />

          <Field label="Purpose / Reason" required error={errors.purpose?.message}>
            <Textarea placeholder="Describe the purpose of the trip" {...register('purpose')} />
          </Field>
          <Field label="Special Requirements" error={errors.special_requirements?.message}>
            <Input placeholder="Optional" {...register('special_requirements')} />
          </Field>
          <Field label="Additional Remarks" error={errors.remarks?.message}>
            <Textarea placeholder="Optional" {...register('remarks')} />
          </Field>

          {errors.root && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errors.root.message}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate('/requests')}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} disabled={blocked || checking}>
              Submit Request
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function AvailabilityBanner({ checking, avail }: { checking: boolean; avail: AvailabilityCheck | null }) {
  if (checking) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-text-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking availability for this window…
      </div>
    )
  }
  if (!avail) return null

  if (avail.is_bookable) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>{avail.available_vehicles}</strong> vehicle{avail.available_vehicles === 1 ? '' : 's'} and{' '}
          <strong>{avail.available_drivers}</strong> driver{avail.available_drivers === 1 ? '' : 's'} are free for this window.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
      <div className="flex items-start gap-2.5">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          This time window is <strong>fully booked</strong>
          {avail.available_vehicles === 0 ? ' — no vehicle is free' : avail.available_drivers === 0 ? ' — no driver is free' : ''}. Choose another window.
        </span>
      </div>
      {avail.conflicts.length > 0 && (
        <ul className="mt-2 space-y-1 pl-6">
          {avail.conflicts.slice(0, 6).map((c, i) => (
            <li key={i} className="text-xs text-red-700/90 dark:text-red-300/80">
              <span className="font-medium">{c.vehicle ?? c.driver ?? 'Booked'}</span>: {fmtDateTime(c.start)} → {fmtDateTime(c.end)}
              {c.destination ? ` · ${c.destination}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
