import { describe, expect, it } from 'vitest'
import { fmtCedis, fmtDate, fmtDecimal, fmtDuration, fmtKm, fmtNumber } from './format'

describe('fmtDuration (HH:MM:SS:mmm)', () => {
  it('renders null as an em dash', () => {
    expect(fmtDuration(null)).toBe('—')
    expect(fmtDuration(undefined)).toBe('—')
  })

  it('renders whole minutes', () => {
    expect(fmtDuration(0)).toBe('00:00:00:000')
    expect(fmtDuration(1)).toBe('00:01:00:000')
    expect(fmtDuration(90)).toBe('01:30:00:000')
  })

  it('carries hours beyond 24 (does not wrap like a clock)', () => {
    expect(fmtDuration(25 * 60)).toBe('25:00:00:000')
  })

  it('renders fractional minutes down to milliseconds', () => {
    // 1.5 min = 1 min 30 s
    expect(fmtDuration(1.5)).toBe('00:01:30:000')
    // 0.001 min = 60 ms
    expect(fmtDuration(0.001)).toBe('00:00:00:060')
  })

  it('rounds sub-millisecond values', () => {
    // 0.0001 min = 6 ms
    expect(fmtDuration(0.0001)).toBe('00:00:00:006')
  })
})

describe('fmtDecimal (max 3 dp)', () => {
  it('renders null as an em dash', () => {
    expect(fmtDecimal(null)).toBe('—')
  })

  it('caps at three decimal places by default', () => {
    expect(fmtDecimal(1.23456)).toBe('1.235')
  })

  it('drops trailing zeros', () => {
    expect(fmtDecimal(2)).toBe('2')
    expect(fmtDecimal(2.5)).toBe('2.5')
  })

  it('honours an explicit precision', () => {
    expect(fmtDecimal(1.23456, 1)).toBe('1.2')
  })
})

describe('fmtKm', () => {
  it('appends the km unit', () => {
    expect(fmtKm(12.3456)).toBe('12.346 km')
  })

  it('renders null as an em dash', () => {
    expect(fmtKm(null)).toBe('—')
  })
})

describe('fmtCedis', () => {
  it('renders null / empty as an em dash', () => {
    expect(fmtCedis(null)).toBe('—')
    expect(fmtCedis('')).toBe('—')
  })

  it('formats numbers with the cedi sign and two decimals', () => {
    expect(fmtCedis(1234.5)).toBe('₵1,234.50')
  })

  it('parses numeric strings', () => {
    expect(fmtCedis('99.9')).toBe('₵99.90')
  })

  it('rejects non-numeric strings', () => {
    expect(fmtCedis('abc')).toBe('—')
  })
})

describe('fmtNumber', () => {
  it('renders null as an em dash', () => {
    expect(fmtNumber(null)).toBe('—')
  })

  it('groups thousands', () => {
    expect(fmtNumber(1000)).toBe('1,000')
  })
})

describe('fmtDate', () => {
  it('renders null as an em dash', () => {
    expect(fmtDate(null)).toBe('—')
  })

  it('formats an ISO date as dd MMM yyyy', () => {
    expect(fmtDate('2026-08-27')).toBe('27 Aug 2026')
  })

  it('returns the raw value when unparseable', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date')
  })
})
