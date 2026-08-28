import { afterEach, describe, expect, it } from 'vitest'
import {
  IDLE_TIMEOUT_MS,
  LAST_ACTIVITY_KEY,
  MOBILE_PWA_DEVICE,
  WEB_DEVICE,
  clearActivity,
  deviceLabel,
  getLastActivity,
  idleLogoutEnabled,
  isIdleExpired,
  markActivity,
} from './idle'

afterEach(() => {
  localStorage.clear()
})

describe('idleLogoutEnabled — platform matrix', () => {
  it('web browser (not standalone, desktop): enabled', () => {
    expect(idleLogoutEnabled({ standalone: false, mobile: false })).toBe(true)
  })

  it('mobile web browser (not standalone, mobile): enabled', () => {
    expect(idleLogoutEnabled({ standalone: false, mobile: true })).toBe(true)
  })

  it('desktop PWA (standalone, desktop): enabled', () => {
    expect(idleLogoutEnabled({ standalone: true, mobile: false })).toBe(true)
  })

  it('mobile PWA (standalone, mobile): DISABLED', () => {
    expect(idleLogoutEnabled({ standalone: true, mobile: true })).toBe(false)
  })
})

describe('deviceLabel — token name sent at login', () => {
  it('labels the mobile PWA so the server exempts it', () => {
    expect(deviceLabel({ standalone: true, mobile: true })).toBe(MOBILE_PWA_DEVICE)
  })

  it('labels everything else as web (idle enforced)', () => {
    expect(deviceLabel({ standalone: false, mobile: false })).toBe(WEB_DEVICE)
    expect(deviceLabel({ standalone: false, mobile: true })).toBe(WEB_DEVICE)
    expect(deviceLabel({ standalone: true, mobile: false })).toBe(WEB_DEVICE)
  })
})

describe('isIdleExpired', () => {
  const now = 1_000_000_000_000

  it('is false when there is no recorded activity', () => {
    expect(isIdleExpired(null, now)).toBe(false)
  })

  it('is false within the window', () => {
    expect(isIdleExpired(now - (IDLE_TIMEOUT_MS - 1), now)).toBe(false)
  })

  it('is true exactly at the window', () => {
    expect(isIdleExpired(now - IDLE_TIMEOUT_MS, now)).toBe(true)
  })

  it('is true past the window', () => {
    expect(isIdleExpired(now - (IDLE_TIMEOUT_MS + 60_000), now)).toBe(true)
  })

  it('uses a 30-minute window', () => {
    expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })
})

describe('activity persistence', () => {
  it('round-trips the timestamp through localStorage', () => {
    markActivity(12345)
    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBe('12345')
    expect(getLastActivity()).toBe(12345)
  })

  it('clears the timestamp', () => {
    markActivity(12345)
    clearActivity()
    expect(getLastActivity()).toBeNull()
  })

  it('returns null for a corrupt value', () => {
    localStorage.setItem(LAST_ACTIVITY_KEY, 'not-a-number')
    expect(getLastActivity()).toBeNull()
  })
})
