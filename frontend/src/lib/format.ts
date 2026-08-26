import { format, parseISO } from 'date-fns'

export function fmtDate(value?: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'dd MMM yyyy')
  } catch {
    return value
  }
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'dd MMM yyyy, HH:mm')
  } catch {
    return value
  }
}

export function fmtTime(value?: string | null): string {
  if (!value) return '—'
  try {
    return format(parseISO(value), 'HH:mm')
  } catch {
    return value
  }
}

export function fmtNumber(value?: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

/** Round a figure to at most `dp` decimal places (default 3). */
export function fmtDecimal(value?: number | null, dp = 3): string {
  if (value == null) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: dp })
}

export function fmtKm(value?: number | null): string {
  if (value == null) return '—'
  return `${fmtDecimal(value)} km`
}

/** Ghana Cedi amount, e.g. ₵1,234.50. */
export function fmtCedis(value?: number | string | null): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (!Number.isFinite(n)) return '—'
  return `₵${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const pad = (n: number, width = 2) => String(Math.max(0, n)).padStart(width, '0')

/**
 * Format a minute value (may be fractional) as HH:MM:SS:mmm — used for every
 * duration, including averages. Minutes/seconds/milliseconds stay in range.
 */
export function fmtDuration(minutes?: number | null): string {
  if (minutes == null) return '—'
  let ms = Math.round(minutes * 60000)
  const h = Math.floor(ms / 3_600_000); ms -= h * 3_600_000
  const m = Math.floor(ms / 60_000); ms -= m * 60_000
  const s = Math.floor(ms / 1000); ms -= s * 1000
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ms, 3)}`
}
