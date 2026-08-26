// Theme handling per MASTER_DOC Part I §3: Light / Dark / System.
// Explicit choice → data-theme on <html>; System → no attribute + prefers-color-scheme.

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'theme'

export function getThemeChoice(): ThemeChoice {
  const stored = localStorage.getItem(KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return 'system'
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') {
    localStorage.removeItem(KEY)
    root.removeAttribute('data-theme')
  } else {
    localStorage.setItem(KEY, choice)
    root.setAttribute('data-theme', choice)
  }
}

/** True when dark is currently effective (explicit dark, or system + OS dark). */
export function isDarkActive(): boolean {
  const choice = getThemeChoice()
  if (choice === 'dark') return true
  if (choice === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
