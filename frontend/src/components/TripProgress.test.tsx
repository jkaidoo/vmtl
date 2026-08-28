import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TripProgress } from './TripProgress'
import type { Trip } from '../lib/types'

function tripAt(status: string, extra: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    trip_number: 'TRP-1',
    vehicle_request_id: 1,
    vehicle_id: 1,
    driver_id: 1,
    scheduled_start: '2026-08-27T10:00:00Z',
    scheduled_end: '2026-08-27T12:00:00Z',
    actual_start: '2026-08-27T10:00:00Z',
    actual_end: null,
    starting_odometer: null,
    ending_odometer: null,
    distance: null,
    duration_minutes: null,
    status,
    status_label: status,
    status_color: 'green',
    start_notes: null,
    end_notes: null,
    admin_remarks: null,
    created_at: '2026-08-27T09:00:00Z',
    ...extra,
  }
}

afterEach(() => vi.useRealTimers())

describe('TripProgress', () => {
  it('renders nothing for a scheduled trip', () => {
    const { container } = render(<TripProgress trip={tripAt('scheduled')} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a progressbar at ~50% for a half-elapsed in-progress trip', () => {
    vi.useFakeTimers().setSystemTime(Date.parse('2026-08-27T11:00:00Z'))
    const { getByRole } = render(<TripProgress trip={tripAt('in_progress')} />)
    const bar = getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar.getAttribute('aria-label')).toMatch(/remaining/i)
  })

  it('flags an overdue trip in its label', () => {
    vi.useFakeTimers().setSystemTime(Date.parse('2026-08-27T12:30:00Z'))
    const { getByRole } = render(<TripProgress trip={tripAt('in_progress')} />)
    const bar = getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar.getAttribute('aria-label')).toMatch(/over the expected duration/i)
  })

  it('renders a completed trip at 100%', () => {
    const { getByRole } = render(
      <TripProgress trip={tripAt('completed', { actual_end: '2026-08-27T11:45:00Z' })} />,
    )
    const bar = getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar.getAttribute('aria-label')).toMatch(/completed/i)
  })
})
