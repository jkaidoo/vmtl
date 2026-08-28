import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  IDLE_LOGOUT_FLAG,
  getLastActivity,
  idleLogoutEnabled,
  isIdleExpired,
  markActivity,
} from '../lib/idle'

// How often to check the idle clock, and how often (at most) to persist an
// activity ping. The check granularity only needs to be coarse next to the
// 30-minute window.
const CHECK_INTERVAL_MS = 15_000
const ACTIVITY_WRITE_THROTTLE_MS = 5_000

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'scroll', 'click'] as const

/**
 * Signs the user out after 30 minutes of inactivity — except on the mobile PWA
 * (see `idleLogoutEnabled`). Renders nothing. Activity is shared across tabs via
 * localStorage, so staying active in one tab keeps the others signed in, and the
 * check also runs when a backgrounded tab becomes visible again (catching a
 * laptop that slept past the window).
 */
export function IdleLogout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const lastWriteRef = useRef(0)

  useEffect(() => {
    if (!user || !idleLogoutEnabled()) return

    let cancelled = false

    const ping = (now: number = Date.now()) => {
      if (now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return
      lastWriteRef.current = now
      markActivity(now)
    }

    const signOutIdle = async () => {
      if (cancelled) return
      cancelled = true
      try {
        sessionStorage.setItem(IDLE_LOGOUT_FLAG, '1')
      } catch {
        // ignore
      }
      await logout()
      navigate('/login', { replace: true })
    }

    const check = () => {
      if (isIdleExpired(getLastActivity())) void signOutIdle()
    }

    const onActivity = () => ping()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', check)

    const interval = window.setInterval(check, CHECK_INTERVAL_MS)
    // Evaluate immediately: a reload after the window elapsed should sign out at
    // once (a fresh login reset the clock in AuthContext.login).
    check()

    return () => {
      cancelled = true
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', check)
      window.clearInterval(interval)
    }
  }, [user, logout, navigate])

  return null
}
