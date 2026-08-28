/**
 * Trip progress model for the live loading graphic (a pickup driving from start
 * to destination along the expected trip duration). Pure + time-based so the UI
 * can tick locally without polling the server.
 */

export type TripProgressState = 'scheduled' | 'in_progress' | 'completed' | 'other'

export interface TripProgressInfo {
  /** Whether the graphic should be shown at all. */
  applicable: boolean
  state: TripProgressState
  /** Fraction of the expected duration elapsed, clamped to 0..1. */
  progress: number
  /** Expected (planned) duration, in minutes. */
  expectedMinutes: number
  /** Time since the trip actually started, in minutes. */
  elapsedMinutes: number
  /** Expected minutes left; negative once the trip runs over. */
  remainingMinutes: number
  /** True once elapsed exceeds the expected duration. */
  overdue: boolean
}

interface TripLike {
  status: string
  scheduled_start?: string | null
  scheduled_end?: string | null
  actual_start?: string | null
  actual_end?: string | null
}

const MINUTE = 60_000

function toMs(value?: string | null): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

const NONE: TripProgressInfo = {
  applicable: false,
  state: 'other',
  progress: 0,
  expectedMinutes: 0,
  elapsedMinutes: 0,
  remainingMinutes: 0,
  overdue: false,
}

/**
 * Compute how far a trip is through its expected duration. The expected
 * duration is the planned window (`scheduled_end - scheduled_start`); elapsed is
 * measured from `actual_start`. Only in-progress and completed trips are
 * "applicable" (there is nothing to load before a trip starts).
 */
export function computeTripProgress(trip: TripLike, now: number = Date.now()): TripProgressInfo {
  const schedStart = toMs(trip.scheduled_start)
  const schedEnd = toMs(trip.scheduled_end)
  const expectedMs = schedStart != null && schedEnd != null ? schedEnd - schedStart : null

  if (expectedMs == null || expectedMs <= 0) {
    return { ...NONE, state: trip.status === 'scheduled' ? 'scheduled' : 'other' }
  }
  const expectedMinutes = expectedMs / MINUTE

  if (trip.status === 'in_progress') {
    const start = toMs(trip.actual_start) ?? schedStart
    if (start == null) return NONE
    const elapsedMs = Math.max(0, now - start)
    const remainingMs = expectedMs - elapsedMs
    return {
      applicable: true,
      state: 'in_progress',
      progress: Math.min(1, elapsedMs / expectedMs),
      expectedMinutes,
      elapsedMinutes: elapsedMs / MINUTE,
      remainingMinutes: remainingMs / MINUTE,
      overdue: remainingMs < 0,
    }
  }

  if (trip.status === 'completed') {
    const start = toMs(trip.actual_start)
    const end = toMs(trip.actual_end)
    const elapsedMs = start != null && end != null ? Math.max(0, end - start) : expectedMs
    return {
      applicable: true,
      state: 'completed',
      progress: 1,
      expectedMinutes,
      elapsedMinutes: elapsedMs / MINUTE,
      remainingMinutes: 0,
      overdue: false,
    }
  }

  return { ...NONE, state: trip.status === 'scheduled' ? 'scheduled' : 'other' }
}

/** Compact, human duration: 130 → "2h 10m", 45 → "45m", 1500 → "1d 1h". */
export function humanizeMinutes(totalMinutes: number): string {
  const m = Math.round(Math.abs(totalMinutes))
  if (m < 1) return '<1m'
  const days = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  const mins = m % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (mins && !days) parts.push(`${mins}m`) // drop minutes once we're showing days
  return parts.length ? parts.join(' ') : `${m}m`
}
