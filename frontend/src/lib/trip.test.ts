import { describe, expect, it } from 'vitest'
import { computeTripProgress, humanizeMinutes } from './trip'

// A fixed "now" and a 2-hour planned window starting at 10:00.
const NOW = Date.parse('2026-08-27T11:00:00Z') // 60 min into the window
const base = {
  scheduled_start: '2026-08-27T10:00:00Z',
  scheduled_end: '2026-08-27T12:00:00Z', // expected 120 min
  actual_start: '2026-08-27T10:00:00Z',
  actual_end: null as string | null,
}

describe('computeTripProgress', () => {
  it('is not applicable for a scheduled (not-yet-started) trip', () => {
    const info = computeTripProgress({ ...base, status: 'scheduled' }, NOW)
    expect(info.applicable).toBe(false)
    expect(info.state).toBe('scheduled')
  })

  it('reports mid-trip progress for an in-progress trip', () => {
    const info = computeTripProgress({ ...base, status: 'in_progress' }, NOW)
    expect(info.applicable).toBe(true)
    expect(info.state).toBe('in_progress')
    expect(info.progress).toBeCloseTo(0.5, 5) // 60 of 120 min
    expect(info.expectedMinutes).toBe(120)
    expect(info.elapsedMinutes).toBeCloseTo(60, 5)
    expect(info.remainingMinutes).toBeCloseTo(60, 5)
    expect(info.overdue).toBe(false)
  })

  it('measures elapsed from actual_start, not scheduled_start', () => {
    // Started 30 min late → only 30 min elapsed at NOW.
    const info = computeTripProgress(
      { ...base, status: 'in_progress', actual_start: '2026-08-27T10:30:00Z' },
      NOW,
    )
    expect(info.elapsedMinutes).toBeCloseTo(30, 5)
    expect(info.progress).toBeCloseTo(0.25, 5)
  })

  it('clamps progress to 1 and flags overdue past the expected duration', () => {
    const later = Date.parse('2026-08-27T12:30:00Z') // 150 min in, 30 over
    const info = computeTripProgress({ ...base, status: 'in_progress' }, later)
    expect(info.progress).toBe(1)
    expect(info.overdue).toBe(true)
    expect(info.remainingMinutes).toBeCloseTo(-30, 5)
  })

  it('shows a completed trip as full', () => {
    const info = computeTripProgress(
      { ...base, status: 'completed', actual_end: '2026-08-27T11:45:00Z' },
      NOW,
    )
    expect(info.applicable).toBe(true)
    expect(info.state).toBe('completed')
    expect(info.progress).toBe(1)
    expect(info.elapsedMinutes).toBeCloseTo(105, 5) // 10:00 → 11:45
  })

  it('is not applicable when the planned window is missing or non-positive', () => {
    expect(computeTripProgress({ ...base, status: 'in_progress', scheduled_end: null }, NOW).applicable).toBe(false)
    expect(
      computeTripProgress(
        { ...base, status: 'in_progress', scheduled_end: base.scheduled_start },
        NOW,
      ).applicable,
    ).toBe(false)
  })
})

describe('humanizeMinutes', () => {
  it('formats sub-minute as <1m', () => {
    expect(humanizeMinutes(0)).toBe('<1m')
    expect(humanizeMinutes(0.4)).toBe('<1m')
  })

  it('formats minutes and hours', () => {
    expect(humanizeMinutes(45)).toBe('45m')
    expect(humanizeMinutes(130)).toBe('2h 10m')
    expect(humanizeMinutes(120)).toBe('2h')
  })

  it('formats days (dropping minutes for brevity)', () => {
    expect(humanizeMinutes(1440)).toBe('1d')
    expect(humanizeMinutes(1500)).toBe('1d 1h')
  })

  it('uses the absolute value', () => {
    expect(humanizeMinutes(-30)).toBe('30m')
  })
})
