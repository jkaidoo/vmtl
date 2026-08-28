import { useEffect, useReducer } from 'react'
import { clsx } from 'clsx'
import { Flag, MapPin } from 'lucide-react'
import { computeTripProgress, humanizeMinutes } from '../lib/trip'
import type { Trip } from '../lib/types'

type TripTiming = Pick<Trip, 'status' | 'scheduled_start' | 'scheduled_end' | 'actual_start' | 'actual_end'>

/**
 * Live "loading" graphic for a trip: a pickup drives from the origin to the
 * destination flag, positioned at how far the trip is through its expected
 * duration. Ticks locally every second while in progress (no server polling),
 * and is purely presentational — shown to every role that can view the trip.
 */
export function TripProgress({ trip, className }: { trip: TripTiming; className?: string }) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const info = computeTripProgress(trip) // recomputed each render via Date.now()
  const live = info.applicable && info.state === 'in_progress'

  useEffect(() => {
    if (!live) return
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [live])

  if (!info.applicable) return null

  const pct = Math.round(info.progress * 100)
  const summary =
    info.state === 'completed'
      ? `Completed in ${humanizeMinutes(info.elapsedMinutes)}`
      : info.overdue
        ? `Running ${humanizeMinutes(-info.remainingMinutes)} over the expected duration`
        : `About ${humanizeMinutes(info.remainingMinutes)} remaining`

  return (
    <div
      className={clsx('rounded-xl border border-border bg-surface p-4 shadow-card', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Trip progress: ${pct}% of expected duration — ${summary}`}
    >
      <style>{TRACK_CSS}</style>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text">Trip progress</span>
          {live && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Live
            </span>
          )}
        </div>
        <span className={clsx('text-sm font-bold', info.overdue ? 'text-warning' : 'text-primary')}>{pct}%</span>
      </div>

      {/* Scene: road + moving pickup between origin and destination markers */}
      <div className="relative h-14 select-none">
        {/* Road with a filled "covered" portion */}
        <div className="absolute inset-x-7 bottom-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={clsx('h-full rounded-full', info.overdue ? 'bg-warning/40' : 'bg-primary/35')}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Origin + destination markers */}
        <div className="absolute bottom-1.5 left-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary-tint text-primary">
          <MapPin className="h-3.5 w-3.5" />
        </div>
        <div
          className={clsx(
            'absolute bottom-1.5 right-0 flex h-6 w-6 items-center justify-center rounded-full',
            pct >= 100 ? 'bg-success/15 text-success' : 'bg-surface-2 text-text-3',
          )}
        >
          <Flag className="h-3.5 w-3.5" />
        </div>

        {/* The pickup rides ON TOP of the road: this box mirrors the road, and
            `bottom-full` pins the truck's base to the road's top edge (the small
            translate-y drops the wheels onto the line). */}
        <div className="pointer-events-none absolute inset-x-7 bottom-2 h-2.5">
          <div
            className="absolute bottom-full -translate-x-1/2 translate-y-[3px] transition-[left] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ left: `${pct}%` }}
          >
            <PickupTruck spinning={live} />
          </div>
        </div>
      </div>

      {/* Figures */}
      <div className="mt-1 flex items-center justify-between text-xs text-text-3">
        <span>{humanizeMinutes(info.elapsedMinutes)} elapsed</span>
        <span>~{humanizeMinutes(info.expectedMinutes)} expected</span>
      </div>
      <p className={clsx('mt-1 text-xs font-medium', info.overdue ? 'text-warning' : 'text-text-2')}>{summary}</p>
    </div>
  )
}

function PickupTruck({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 64 34"
      width={54}
      height={29}
      className={clsx('text-primary drop-shadow-sm', spinning && 'tp-driving')}
      aria-hidden="true"
    >
      {/* Body: open cargo bed on the left, cab + hood on the right */}
      <path
        d="M3 25 L3 20 L30 20 L30 8 L44 8 L50 17 L60 17 L60 25 Z"
        fill="currentColor"
      />
      {/* Windshield / side glass */}
      <path d="M32 10 L42 10 L46.5 16 L32 16 Z" className="fill-surface/85" />
      {/* Bed rail highlight */}
      <path d="M3 20 L30 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      {/* Wheels */}
      <g className="tp-wheel">
        <circle cx="15" cy="26" r="5.4" className="fill-text" />
        <circle cx="15" cy="26" r="2" className="fill-surface" />
        <rect x="14.2" y="21.4" width="1.6" height="9.2" className="fill-surface/70" />
      </g>
      <g className="tp-wheel">
        <circle cx="50" cy="26" r="5.4" className="fill-text" />
        <circle cx="50" cy="26" r="2" className="fill-surface" />
        <rect x="49.2" y="21.4" width="1.6" height="9.2" className="fill-surface/70" />
      </g>
    </svg>
  )
}

// Scoped keyframes for the spinning wheels (fill-box keeps rotation centred on
// each wheel). Reduced-motion users get a still truck.
const TRACK_CSS = `
@keyframes tp-spin { to { transform: rotate(360deg); } }
.tp-wheel { transform-box: fill-box; transform-origin: center; }
.tp-driving .tp-wheel { animation: tp-spin 1.3s linear infinite; }
@media (prefers-reduced-motion: reduce) { .tp-driving .tp-wheel { animation: none; } }
`
