import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, X, Car, Ban, Plane, Calendar, Clock, Users, ChevronRight, Phone, Building2, User, Pencil, MessageSquare } from 'lucide-react'
import { clsx } from 'clsx'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useInRouteModal } from '../../components/RouteModal'
import { useToast } from '../../components/Toast'
import type { Driver, Trip, Vehicle, VehicleRequest } from '../../lib/types'
import { fmtDate, fmtDateTime, fmtTime } from '../../lib/format'
import { Avatar } from '../../components/Avatar'
import { Button, Card, Field, Input, Select, Spinner, Textarea } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import { TripProgress } from '../../components/TripProgress'
import { Modal } from '../../components/Modal'

export function RequestDetail() {
  const { id } = useParams()
  const { hasRole, managesFleet, user } = useAuth()
  const inModal = useInRouteModal()
  const toast = useToast()
  const [req, setReq] = useState<VehicleRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'approve' | 'reject' | 'assign' | 'cancel' | 'addstop' | 'changes' | 'edit' | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ data: VehicleRequest }>(`/vehicle-requests/${id}`).then((res) => setReq(res.data.data)).finally(() => setLoading(false))
  }, [id])

  useEffect(() => load(), [load])

  // Live status updates: silently refresh the request (and its trip) every 20s.
  useEffect(() => {
    const t = setInterval(() => {
      api.get<{ data: VehicleRequest }>(`/vehicle-requests/${id}`).then((res) => setReq(res.data.data)).catch(() => undefined)
    }, 20000)
    return () => clearInterval(t)
  }, [id])

  if (loading) return <Spinner label="Loading request…" />
  if (!req) return <p className="text-slate-500">Request not found.</p>

  const canApprove = hasRole('approver', 'administrator') && req.status === 'pending'
  const canAssign = managesFleet && req.status === 'approved'
  const canCancel = req.is_cancellable && (req.requester_id === user?.id || managesFleet)
  // Approver / transport can send a request back to the requester for changes.
  const canRequestChanges = (hasRole('approver', 'administrator') || managesFleet) && (req.status === 'pending' || req.status === 'approved')
  // The requester may edit while pending or after changes were requested.
  const isOwner = req.requester_id === user?.id
  const canEdit = isOwner && (req.status === 'pending' || req.status === 'changes_requested')
  const changesNote = req.status === 'changes_requested'
    ? req.approvals?.find((a) => a.action === 'changes_requested')?.comment ?? null
    : null

  return (
    <div className={inModal ? '' : 'mx-auto max-w-4xl'}>
      {!inModal && (
        <Link to="/requests" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to requests
        </Link>
      )}

      {/* Overview header */}
      <div className="flex items-start gap-4 pr-10">
        <Avatar name={req.requester?.name} src={req.requester?.avatar} size={56} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
            {req.is_external ? 'External Travel' : req.is_goodwill ? 'Goodwill Request' : 'Vehicle Request'}
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-bold text-text">{req.request_number}</h1>
          <p className="mt-1 text-sm text-text-2">
            {req.destination} · submitted {fmtDateTime(req.created_at)}
          </p>
        </div>
        <StatusBadge label={req.status_label} color={req.status_color} className="mt-1 shrink-0" />
      </div>

      {/* Actions */}
      {(canApprove || canAssign || canCancel || canRequestChanges || canEdit) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canApprove && (
            <>
              <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setModal('approve')}>Approve</Button>
              <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setModal('reject')}>Reject</Button>
            </>
          )}
          {canRequestChanges && <Button variant="secondary" icon={<MessageSquare className="h-4 w-4" />} onClick={() => setModal('changes')}>Request Changes</Button>}
          {canAssign && <Button icon={<Car className="h-4 w-4" />} onClick={() => setModal('assign')}>Assign Vehicle</Button>}
          {canEdit && (
            <Button variant={req.status === 'changes_requested' ? 'primary' : 'secondary'} icon={<Pencil className="h-4 w-4" />} onClick={() => setModal('edit')}>
              {req.status === 'changes_requested' ? 'Edit & Resubmit' : 'Edit'}
            </Button>
          )}
          {canCancel && <Button variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => setModal('cancel')}>Cancel</Button>}
        </div>
      )}

      {/* Changes-requested explanation banner (for the requester) */}
      {req.status === 'changes_requested' && (
        <div className="alert-accent mt-4 rounded-lg border-violet bg-violet/10 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-violet" />
            <div>
              <p className="text-sm font-semibold text-text">Changes requested</p>
              {changesNote && <p className="mt-0.5 text-sm text-text-2">“{changesNote}”</p>}
              {isOwner && <p className="mt-1 text-xs text-text-3">Edit your request to address this, then resubmit for review.</p>}
            </div>
          </div>
        </div>
      )}

      {/* KPI stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<Users className="h-4 w-4" />} accent="bg-primary-tint text-primary" value={String(req.passenger_count)} label="Passengers" />
        <StatTile icon={<Calendar className="h-4 w-4" />} accent="bg-info/10 text-info" value={fmtDate(req.travel_date)} label="Travel Date" />
        <StatTile icon={<Clock className="h-4 w-4" />} accent="bg-violet/10 text-violet" value={fmtTime(req.requested_start_time)} label="Departure" />
        <StatTile icon={<Clock className="h-4 w-4" />} accent="bg-warning/10 text-warning" value={fmtTime(req.expected_end_time)} label="Expected Return" />
      </div>

      {/* Contact */}
      <div className="mt-6">
        <h2 className="mb-2 text-base font-bold text-text">Contact</h2>
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            <Chip icon={<User className="h-4 w-4 text-text-3" />} text={req.requester?.name ?? '—'} />
            {req.contact_number && <Chip icon={<Phone className="h-4 w-4 text-text-3" />} text={req.contact_number} />}
            <Chip icon={<Building2 className="h-4 w-4 text-text-3" />} text={req.department_label ?? '—'} />
          </div>
        </Card>
      </div>

      {/* Trip details + Assignment */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-base font-bold text-text">Trip Details</h2>
          <Card className="p-4">
            {req.is_external && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary-tint px-3 py-2 text-sm font-medium text-primary">
                <Plane className="h-4 w-4 shrink-0" /> External travel{req.external_org ? ` — ${req.external_org}` : ''}
              </div>
            )}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Destination" value={req.destination} />
              <Detail label="Additional Destination" value={req.additional_destination} />
              <Detail label="Expected Return" value={fmtDateTime(req.expected_end_time)} />
              <Detail label="Special Requirements" value={req.special_requirements} />
              {req.is_external && <Detail label="Requesting Arm / Unit" value={req.external_org} />}
              {req.is_external && <Detail label="Expected Duration" value={req.expected_duration_days ? `${req.expected_duration_days} day(s)` : null} />}
              {req.is_external && <Detail label="Odometer Before Trip" value={req.start_odometer != null ? `${req.start_odometer.toLocaleString()} km` : null} />}
            </dl>
            <div className="mt-4"><Detail label="Purpose" value={req.purpose} /></div>
            {req.remarks && <div className="mt-3"><Detail label="Remarks" value={req.remarks} /></div>}
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-text">Assignment</h2>
          {req.trip ? (
            <>
              <Link
                to={`/trips/${req.trip.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-primary"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-text">{req.trip.trip_number}</p>
                  <p className="mt-0.5 truncate text-xs text-text-3">
                    {req.trip.vehicle?.vehicle_number} · {req.trip.driver?.name} · {req.trip.status_label}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />
              </Link>

              {/* Live trip progress — visible to every role that can see the request. */}
              <TripProgress trip={req.trip} className="mt-3" />

              {req.trip.status === 'in_progress' && req.requester_id === user?.id && (
                <Card className="mt-3 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-text">Added destinations</span>
                    <Button size="sm" variant="secondary" onClick={() => setModal('addstop')}>Add</Button>
                  </div>
                  {(!req.trip.stops || req.trip.stops.length === 0) ? (
                    <p className="text-xs text-text-3">You can request an extra stop; the driver must accept it.</p>
                  ) : (
                    <ul className="space-y-2">
                      {req.trip.stops.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-text">{s.destination}</span>
                          <StatusBadge label={s.status} color={s.status === 'accepted' ? 'green' : s.status === 'declined' ? 'red' : 'amber'} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </>
          ) : (
            <Card className="flex items-center gap-3 p-4 text-sm text-text-3">
              <Car className="h-5 w-5 shrink-0" /> Not yet assigned to a vehicle &amp; driver.
            </Card>
          )}
        </div>
      </div>

      {/* Approval history */}
      <div className="mt-6">
        <h2 className="mb-2 text-base font-bold text-text">Approval History</h2>
        <Card className="p-4">
          {req.approvals && req.approvals.length > 0 ? (
            <ul className="space-y-3">
              {req.approvals.map((a) => (
                <li key={a.id} className="border-l-2 border-border pl-3">
                  <StatusBadge label={a.action_label} color={a.action === 'approved' ? 'green' : a.action === 'changes_requested' ? 'purple' : 'red'} />
                  <p className="mt-1 text-sm text-text-2">{a.approver?.name}</p>
                  <p className="text-xs text-text-3">{fmtDateTime(a.approved_at)}</p>
                  {a.comment && <p className="mt-1 text-sm text-text-2">“{a.comment}”</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-text-3">No approval activity yet.</p>
          )}
        </Card>
      </div>

      {modal === 'approve' && <ApproveModal req={req} onClose={() => setModal(null)} onDone={load} />}
      {modal === 'reject' && <RejectModal req={req} onClose={() => setModal(null)} onDone={load} />}
      {modal === 'assign' && <AssignModal req={req} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'addstop' && req.trip && <AddStopModal tripId={req.trip.id} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'changes' && <RequestChangesModal req={req} onClose={() => setModal(null)} onDone={load} />}
      {modal === 'edit' && <EditRequestModal req={req} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'cancel' && (
        <Modal
          open
          onClose={() => setModal(null)}
          title="Cancel request"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                Keep
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await api.post(`/vehicle-requests/${req.id}/cancel`)
                    toast.success('Request cancelled')
                    setModal(null)
                    load()
                  } catch (e) {
                    toast.error(apiError(e))
                  }
                }}
              >
                Cancel Request
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Are you sure you want to cancel {req.request_number}? This cannot be undone.</p>
        </Modal>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-text-3">{label}</dt>
      <dd className="text-sm text-text">{value || '—'}</dd>
    </div>
  )
}

function StatTile({ icon, accent, value, label }: { icon: ReactNode; accent: string; value: string; label: string }) {
  return (
    <Card className="p-4">
      <div className={clsx('mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg', accent)}>{icon}</div>
      <p className="metric truncate text-xl font-bold text-text" title={value}>{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-text-3">{label}</p>
    </Card>
  )
}

function Chip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-text-2">
      {icon}
      {text}
    </span>
  )
}

function AddStopModal({ tripId, onClose, onDone }: { tripId: number; onClose: () => void; onDone: () => void }) {
  const [destination, setDestination] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    if (!destination.trim()) {
      toast.error('Destination is required')
      return
    }
    setLoading(true)
    try {
      await api.post(`/trips/${tripId}/stops`, { destination, note: note || undefined })
      toast.success('Destination requested — awaiting the driver’s acceptance')
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Add a destination" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Request</Button></>}>
      <p className="mb-3 text-sm text-text-2">The driver must accept this before it is recorded.</p>
      <Field label="Destination" required><Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Pharmacy stop" /></Field>
      <div className="mt-3"><Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
    </Modal>
  )
}

function ApproveModal({ req, onClose, onDone }: { req: VehicleRequest; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/vehicle-requests/${req.id}/approve`, { comment })
      toast.success('Request approved')
      onClose()
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Approve request" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" loading={loading} onClick={submit}>Approve</Button></>}>
      <Field label="Comment (optional)">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add an approval note…" />
      </Field>
    </Modal>
  )
}

function RejectModal({ req, onClose, onDone }: { req: VehicleRequest; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    if (reason.trim().length < 3) {
      toast.error('A rejection reason is required')
      return
    }
    setLoading(true)
    try {
      await api.post(`/vehicle-requests/${req.id}/reject`, { reason })
      toast.success('Request rejected')
      onClose()
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Reject request" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={submit}>Reject</Button></>}>
      <Field label="Reason for rejection" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this request is rejected…" />
      </Field>
    </Modal>
  )
}

function RequestChangesModal({ req, onClose, onDone }: { req: VehicleRequest; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    if (reason.trim().length < 5) {
      toast.error('Explain what needs to change (at least 5 characters)')
      return
    }
    setLoading(true)
    try {
      await api.post(`/vehicle-requests/${req.id}/request-changes`, { reason })
      toast.success('Sent back to the requester for changes')
      onClose()
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Request changes" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Send back</Button></>}>
      <p className="mb-3 text-sm text-text-2">Explain what the requester should change (e.g. the booking time). They’ll edit their request and resubmit it for review.</p>
      <Field label="Explanation" required>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Please move the departure to after 2pm — the vehicle is booked that morning." />
      </Field>
    </Modal>
  )
}

function EditRequestModal({ req, onClose, onDone }: { req: VehicleRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const resubmit = req.status === 'changes_requested'
  const [form, setForm] = useState({
    travel_date: req.travel_date?.slice(0, 10) ?? '',
    requested_start_time: req.requested_start_time?.slice(0, 16) ?? '',
    expected_end_time: req.expected_end_time?.slice(0, 16) ?? '',
    destination: req.destination ?? '',
    additional_destination: req.additional_destination ?? '',
    passenger_count: String(req.passenger_count ?? 1),
    contact_number: req.contact_number ?? '',
    special_requirements: req.special_requirements ?? '',
    purpose: req.purpose ?? '',
    remarks: req.remarks ?? '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.destination.trim() || form.purpose.trim().length < 1) {
      toast.error('Destination and purpose are required')
      return
    }
    if (new Date(form.requested_start_time) >= new Date(form.expected_end_time)) {
      toast.error('Departure must be before the expected return')
      return
    }
    setLoading(true)
    try {
      await api.put(`/vehicle-requests/${req.id}`, {
        travel_date: form.travel_date,
        requested_start_time: form.requested_start_time,
        expected_end_time: form.expected_end_time,
        destination: form.destination,
        additional_destination: form.additional_destination || null,
        passenger_count: Number(form.passenger_count),
        contact_number: form.contact_number || null,
        special_requirements: form.special_requirements || null,
        purpose: form.purpose,
        remarks: form.remarks || null,
      })
      toast.success(resubmit ? 'Request updated and resubmitted for review' : 'Request updated')
      onDone()
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
      title={resubmit ? 'Edit & resubmit request' : 'Edit request'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>{resubmit ? 'Save & Resubmit' : 'Save'}</Button></>}
    >
      {resubmit && (
        <div className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text-2">
          Saving will resubmit this request for review.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Travel Date" required><Input type="date" value={form.travel_date} onChange={(e) => set('travel_date', e.target.value)} /></Field>
        <Field label="Passengers" required><Input type="number" min={1} value={form.passenger_count} onChange={(e) => set('passenger_count', e.target.value)} /></Field>
        <Field label="Departure" required><Input type="datetime-local" value={form.requested_start_time} onChange={(e) => set('requested_start_time', e.target.value)} /></Field>
        <Field label="Expected Return" required><Input type="datetime-local" value={form.expected_end_time} onChange={(e) => set('expected_end_time', e.target.value)} /></Field>
        <Field label="Destination" required><Input value={form.destination} onChange={(e) => set('destination', e.target.value)} /></Field>
        <Field label="Additional Destination"><Input value={form.additional_destination} onChange={(e) => set('additional_destination', e.target.value)} /></Field>
        <Field label="Contact Number"><Input value={form.contact_number} onChange={(e) => set('contact_number', e.target.value)} /></Field>
        <Field label="Special Requirements"><Input value={form.special_requirements} onChange={(e) => set('special_requirements', e.target.value)} /></Field>
      </div>
      <div className="mt-4"><Field label="Purpose / Reason" required><Textarea value={form.purpose} onChange={(e) => set('purpose', e.target.value)} /></Field></div>
      <div className="mt-3"><Field label="Remarks"><Textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field></div>
    </Modal>
  )
}

function AssignModal({ req, onClose, onDone }: { req: VehicleRequest; onClose: () => void; onDone: () => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [vehicleId, setVehicleId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const toast = useToast()

  useEffect(() => {
    api
      .get<{ vehicles: Vehicle[]; drivers: Driver[] }>(`/vehicle-requests/${req.id}/assignment-options`)
      .then((res) => {
        setVehicles(res.data.vehicles)
        setDrivers(res.data.drivers)
      })
      .finally(() => setFetching(false))
  }, [req.id])

  const submit = async () => {
    if (!vehicleId || !driverId) {
      toast.error('Select both a vehicle and a driver')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ data: Trip }>(`/vehicle-requests/${req.id}/assign`, {
        vehicle_id: Number(vehicleId),
        driver_id: Number(driverId),
      })
      toast.success(`Assigned — ${res.data.data.trip_number} created`)
      onDone()
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
      title="Assign vehicle & driver"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Assign</Button></>}
    >
      {fetching ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Only vehicles and drivers free for this request's time window are shown (conflicts are prevented).</p>
          <Field label="Vehicle" required>
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">— Select vehicle —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_number} — {v.make} {v.model} (cap {v.capacity})
                </option>
              ))}
            </Select>
          </Field>
          {vehicles.length === 0 && <p className="text-sm text-amber-600">No vehicles available for this window.</p>}
          <Field label="Driver" required>
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">— Select driver —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {drivers.length === 0 && <p className="text-sm text-amber-600">No drivers available for this window.</p>}
        </div>
      )}
    </Modal>
  )
}
