/**
 * Idle auto-logout policy and helpers.
 *
 * Product rule: sign the user out after 30 minutes of inactivity on the **web**
 * (any browser tab) and the **desktop PWA**, but **not** on the **mobile PWA** —
 * an installed app on a phone/tablet is treated like a native app (it is
 * personal, gets backgrounded constantly by screen locks, and an idle timer
 * there would be more annoyance than protection).
 *
 * So: idle logout is enabled everywhere EXCEPT (installed PWA AND mobile device).
 */

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
/** Shared across tabs so activity in one tab keeps the others alive. */
export const LAST_ACTIVITY_KEY = 'uits_last_activity'
/** One-shot flag read by the login screen to explain the sign-out. */
export const IDLE_LOGOUT_FLAG = 'uits_idle_logout'

/**
 * Token `device_name` labels sent at login. The server honours the same
 * mobile-PWA idle exemption by skipping its idle timeout for `mobile-pwa`
 * tokens (see App\Providers\AppServiceProvider). Keep these strings in sync.
 */
export const WEB_DEVICE = 'web'
export const MOBILE_PWA_DEVICE = 'mobile-pwa'

type Nav = Navigator & {
  standalone?: boolean
  userAgentData?: { mobile?: boolean }
  maxTouchPoints?: number
}

function mql(query: string): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  } catch {
    return false
  }
}

/** True when the app runs as an installed PWA (standalone / minimal display). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const standalone =
    mql('(display-mode: standalone)') ||
    mql('(display-mode: minimal-ui)') ||
    mql('(display-mode: fullscreen)') ||
    mql('(display-mode: window-controls-overlay)')
  // iOS Safari exposes standalone on navigator instead of a display-mode query.
  const iosStandalone = typeof navigator !== 'undefined' && (navigator as Nav).standalone === true
  return standalone || iosStandalone
}

/** True on a phone or tablet (iPadOS, which reports as desktop Safari, included). */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Nav
  const ua = nav.userAgent || ''

  if (typeof nav.userAgentData?.mobile === 'boolean' && nav.userAgentData.mobile) return true
  if (/Android|iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true
  if (/iPad/i.test(ua)) return true
  // iPadOS 13+ masquerades as macOS; a Mac UA with a touch screen is an iPad.
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) return true
  // Generic tablet: coarse primary pointer, no hover, and a touch screen.
  if (mql('(pointer: coarse)') && mql('(hover: none)') && (nav.maxTouchPoints ?? 0) > 0) return true
  return false
}

/**
 * Whether idle auto-logout should run in this environment. Args are injectable
 * for testing; by default they are detected from the runtime.
 */
export function idleLogoutEnabled(opts?: { standalone?: boolean; mobile?: boolean }): boolean {
  const standalone = opts?.standalone ?? isStandalonePwa()
  const mobile = opts?.mobile ?? isMobileDevice()
  return !(standalone && mobile)
}

/**
 * The `device_name` to send at login. `mobile-pwa` exactly when idle logout is
 * disabled for this environment — so the server applies the same exemption.
 */
export function deviceLabel(opts?: { standalone?: boolean; mobile?: boolean }): string {
  return idleLogoutEnabled(opts) ? WEB_DEVICE : MOBILE_PWA_DEVICE
}

export function markActivity(now: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
  } catch {
    // storage unavailable — idle logout falls back to the in-memory timer
  }
}

export function getLastActivity(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function clearActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY)
  } catch {
    // ignore
  }
}

/** True once the last recorded activity is older than the idle window. */
export function isIdleExpired(last: number | null, now: number = Date.now()): boolean {
  if (last == null) return false
  return now - last >= IDLE_TIMEOUT_MS
}
