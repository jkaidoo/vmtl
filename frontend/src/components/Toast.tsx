import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'

// Result feedback is presented as a centered modal (success / error / failure /
// notice) so every add / update / remove / status change is clearly confirmed.
type FeedbackKind = 'success' | 'error' | 'warning' | 'info'

interface Feedback {
  id: number
  kind: FeedbackKind
  title: string
  message: string
}

interface ToastContextValue {
  toast: (message: string, kind?: FeedbackKind, title?: string) => void
  success: (message: string, title?: string) => void
  error: (message: string, title?: string) => void
  warning: (message: string, title?: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

let counter = 0

const DEFAULT_TITLE: Record<FeedbackKind, string> = {
  success: 'Success',
  error: 'Error',
  warning: 'Action failed',
  info: 'Notice',
}

const STYLE: Record<FeedbackKind, { icon: ReactNode; ring: string; btn: string; anim: string }> = {
  success: { icon: <CheckCircle2 className="h-6 w-6 text-green-600" />, ring: 'bg-green-100', btn: 'primary', anim: 'animate-result-pop' },
  error: { icon: <XCircle className="h-6 w-6 text-danger" />, ring: 'bg-danger/10', btn: 'danger', anim: 'animate-result-shake' },
  warning: { icon: <AlertTriangle className="h-6 w-6 text-warning" />, ring: 'bg-warning/10', btn: 'primary', anim: 'animate-result-shake' },
  info: { icon: <Info className="h-6 w-6 text-info" />, ring: 'bg-info/10', btn: 'primary', anim: 'animate-result-pop' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Feedback | null>(null)

  const show = useCallback((message: string, kind: FeedbackKind = 'info', title?: string) => {
    setCurrent({ id: ++counter, kind, title: title ?? DEFAULT_TITLE[kind], message })
  }, [])

  const value: ToastContextValue = {
    toast: show,
    success: (m, t) => show(m, 'success', t),
    error: (m, t) => show(m, 'error', t),
    warning: (m, t) => show(m, 'warning', t),
  }

  const close = useCallback(() => setCurrent(null), [])

  // Success confirmations auto-dismiss; errors/warnings wait for acknowledgement.
  useEffect(() => {
    if (current?.kind === 'success') {
      const t = setTimeout(() => setCurrent((c) => (c?.id === current.id ? null : c)), 2200)
      return () => clearTimeout(t)
    }
  }, [current])

  // Close on Escape.
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, close])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {current && <ResultModal feedback={current} onClose={close} />}
    </ToastContext.Provider>
  )
}

function ResultModal({ feedback, onClose }: { feedback: Feedback; onClose: () => void }) {
  const style = STYLE[feedback.kind]
  return (
    <div
      className="animate-overlay-in fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-modal-pop w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={clsx('mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full', style.ring, style.anim)}>
          {style.icon}
        </div>
        <h2 className="mb-1 text-lg font-semibold text-text">{feedback.title}</h2>
        <p className="mb-5 text-sm text-text-2">{feedback.message}</p>
        <button
          onClick={onClose}
          autoFocus
          className={clsx(
            'w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors',
            style.btn === 'danger' ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-600',
          )}
        >
          OK
        </button>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
