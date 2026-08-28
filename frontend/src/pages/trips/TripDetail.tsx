import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Square, Gauge, UserX, MapPinPlus } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useInRouteModal } from '../../components/RouteModal'
import { useToast } from '../../components/Toast'
import type { Trip } from '../../lib/types'
import { fmtDateTime, fmtDuration, fmtKm } from '../../lib/format'
import { Button, Card, Field, Input, PageHeader, Spinner, Textarea } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import { TripProgress } from '../../components/TripProgress'
import { Modal } from '../../components/Modal'

export function TripDetail() {
  const { id } = useParams()
  const { managesFleet, hasRole, user } = useAuth()
  const inModal = useInRouteModal()
  const toast = useToast()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'start' | 'end' | 'correct' | 'noshow' | 'addstop' | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ data: Trip }>(`/trips/${id}`).then((res) => setTrip(res.data.data)).finally(() => setLoading(false))
  }, [id])

  useEffect(() => load(), [load])

  const decideStop = async (stopId: number, accept: boolean) => {
    try {
      await api.post(`/trips/${id}/stops/${stopId}/decide`, { accept })
      toast.success(accept ? 'Destination accepted' : 'Destination declined')
      load()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  if (loading) return <Spinner label="Loading trip…" />
  if (!trip) return <p className="text-slate-500">Trip not found.</p>

  const canOperate = managesFleet || trip.driver?.user_id === user?.id
  const canCorrect = hasRole('administrator')
  const isRequester = trip.request?.requester_id === user?.id
  const inProgress = trip.status === 'in_progress'

  return (
    <div className={inModal ? '' : 'mx-auto max-w-4xl'}>
      {!inModal && (
        <Link to="/trips" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to trips
        </Link>
      )}

      <PageHeader
        title={trip.trip_number}
        subtitle={trip.request ? `Request ${trip.request.request_number}` : undefined}
        actions={<StatusBadge label={trip.status_label} color={trip.status_color} className="self-center" />}
      />

      {/* Large action buttons for mobile drivers (spec §35) */}
      {canOperate && (trip.status === 'scheduled' || trip.status === 'in_progress') && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          {trip.status === 'scheduled' && (
            <>
              <Button size="lg" variant="success" className="w-full py-5 text-lg sm:w-auto" icon={<Play className="h-6 w-6" />} onClick={() => setModal('start')}>
                START TRIP
              </Button>
              <Button size="lg" variant="secondary" className="w-full sm:w-auto" icon={<UserX className="h-5 w-5" />} onClick={() => setModal('noshow')}>
                Mark No Show
              </Button>
            </>
          )}
          {trip.status === 'in_progress' && (
            <Button size="lg" variant="danger" className="w-full py-5 text-lg sm:w-auto" icon={<Square className="h-6 w-6" />} onClick={() => setModal('end')}>
              END TRIP
            </Button>
          )}
        </div>
      )}

      {/* Live trip progress — a pickup driving through the expected duration. */}
      <TripProgress trip={trip} className="mb-6" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold text-slate-900">Trip Information</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Vehicle" value={trip.vehicle?.vehicle_number} />
            <Detail label="Driver" value={trip.driver?.name} />
            <Detail label="Destination" value={trip.request?.destination} />
            <Detail label="Requester" value={trip.request?.requester?.name} />
            <Detail label="Scheduled Start" value={fmtDateTime(trip.scheduled_start)} />
            <Detail label="Scheduled End" value={fmtDateTime(trip.scheduled_end)} />
            <Detail label="Actual Start" value={fmtDateTime(trip.actual_start)} />
            <Detail label="Actual End" value={fmtDateTime(trip.actual_end)} />
            <Detail label="Starting Odometer" value={trip.starting_odometer != null ? fmtKm(trip.starting_odometer) : null} />
            <Detail label="Ending Odometer" value={trip.ending_odometer != null ? fmtKm(trip.ending_odometer) : null} />
            <Detail label="Distance" value={trip.distance != null ? fmtKm(trip.distance) : null} />
            <Detail label="Duration" value={trip.duration_minutes != null ? fmtDuration(trip.duration_minutes) : null} />
          </dl>
          {trip.start_notes && <div className="mt-4"><Detail label="Start Notes" value={trip.start_notes} /></div>}
          {trip.end_notes && <div className="mt-3"><Detail label="End Notes" value={trip.end_notes} /></div>}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-slate-900">Log</h2>
            <div className="space-y-2 text-sm">
              <p><span className="text-slate-500">Started by:</span> {trip.started_by?.name ?? '—'}</p>
              <p><span className="text-slate-500">Ended by:</span> {trip.ended_by?.name ?? '—'}</p>
            </div>
          </Card>

          {/* Additional destinations added mid-trip */}
          {(inProgress || (trip.stops && trip.stops.length > 0)) && (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Added Destinations</h2>
                {inProgress && (isRequester || canOperate) && (
                  <Button size="sm" variant="secondary" icon={<MapPinPlus className="h-4 w-4" />} onClick={() => setModal('addstop')}>Add</Button>
                )}
              </div>
              {(!trip.stops || trip.stops.length === 0) ? (
                <p className="text-sm text-text-3">No added destinations. {inProgress && isRequester ? 'You can request one during the trip.' : ''}</p>
              ) : (
                <ul className="space-y-3">
                  {trip.stops.map((s) => (
                    <li key={s.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-text">{s.destination}</p>
                          {s.note && <p className="text-xs text-text-2">{s.note}</p>}
                          <p className="mt-0.5 text-[11px] text-text-3">by {s.requested_by ?? '—'}</p>
                        </div>
                        <StatusBadge label={s.status} color={s.status === 'accepted' ? 'green' : s.status === 'declined' ? 'red' : 'amber'} />
                      </div>
                      {s.status === 'pending' && canOperate && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="success" onClick={() => decideStop(s.id, true)}>Accept</Button>
                          <Button size="sm" variant="secondary" onClick={() => decideStop(s.id, false)}>Decline</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {canCorrect && trip.status === 'completed' && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold text-slate-900">Administration</h2>
              <Button variant="secondary" icon={<Gauge className="h-4 w-4" />} onClick={() => setModal('correct')}>
                Correct Odometer
              </Button>
              <p className="mt-2 text-xs text-slate-400">Corrections are recorded in the audit log.</p>
            </Card>
          )}
        </div>
      </div>

      {modal === 'start' && <StartModal trip={trip} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'end' && <EndModal trip={trip} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'noshow' && <NoShowModal trip={trip} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'correct' && <CorrectModal trip={trip} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'addstop' && <AddStopModal trip={trip} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
    </div>
  )
}

function AddStopModal({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
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
      await api.post(`/trips/${trip.id}/stops`, { destination, note: note || undefined })
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

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value || '—'}</dd>
    </div>
  )
}

function StartModal({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
  const [odo, setOdo] = useState(String(trip.vehicle?.current_odometer ?? ''))
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/trips/${trip.id}/start`, { starting_odometer: odo ? Number(odo) : undefined, notes })
      toast.success('Trip started')
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Start trip" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" loading={loading} onClick={submit}>Start Trip</Button></>}>
      <p className="mb-3 text-sm text-slate-500">The start time is recorded automatically.</p>
      <Field label="Starting Odometer (km)"><Input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
      <div className="mt-3"><Field label="Notes (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
    </Modal>
  )
}

function EndModal({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
  const [odo, setOdo] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    if (!odo) {
      toast.error('Ending odometer is required')
      return
    }
    setLoading(true)
    try {
      await api.post(`/trips/${trip.id}/complete`, { ending_odometer: Number(odo), notes })
      toast.success('Trip completed')
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  const distance = odo && trip.starting_odometer != null ? Number(odo) - trip.starting_odometer : null
  return (
    <Modal open onClose={onClose} title="End trip" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={submit}>End Trip</Button></>}>
      <p className="mb-3 text-sm text-slate-500">The end time and duration are recorded automatically.</p>
      <Field label="Ending Odometer (km)" required hint={`Started at ${fmtKm(trip.starting_odometer)}`}>
        <Input type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
      </Field>
      {distance != null && <p className={`mt-2 text-sm ${distance < 0 ? 'text-red-600' : 'text-slate-600'}`}>Distance: {distance} km</p>}
      <div className="mt-3"><Field label="Completion Remarks (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
    </Modal>
  )
}

function NoShowModal({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/trips/${trip.id}/no-show`, { reason: reason || undefined })
      toast.success('Trip marked as no-show')
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Mark trip as no-show" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={loading} onClick={submit}>Mark No Show</Button></>}>
      <p className="mb-3 text-sm text-slate-500">
        The scheduled trip did not take place. The vehicle will be released and the request closed as a no-show.
      </p>
      <Field label="Reason (optional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Requester did not arrive at pickup" /></Field>
    </Modal>
  )
}

function CorrectModal({ trip, onClose, onDone }: { trip: Trip; onClose: () => void; onDone: () => void }) {
  const [start, setStart] = useState(String(trip.starting_odometer ?? ''))
  const [end, setEnd] = useState(String(trip.ending_odometer ?? ''))
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const submit = async () => {
    if (reason.trim().length < 3) {
      toast.error('A reason is required')
      return
    }
    setLoading(true)
    try {
      await api.post(`/trips/${trip.id}/correct-odometer`, {
        starting_odometer: start ? Number(start) : undefined,
        ending_odometer: end ? Number(end) : undefined,
        reason,
      })
      toast.success('Odometer corrected')
      onDone()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Correct odometer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save Correction</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting Odometer"><Input type="number" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Ending Odometer"><Input type="number" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label="Reason for correction" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
    </Modal>
  )
}
