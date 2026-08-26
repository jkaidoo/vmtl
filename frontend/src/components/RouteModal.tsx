import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

/**
 * True when a detail page is being rendered inside a route-driven modal overlay
 * (opened from a list) rather than as a full page. Detail pages read this to
 * hide their "back to list" link and drop their page-width container.
 */
const InRouteModal = createContext(false)

// eslint-disable-next-line react-refresh/only-export-components
export function useInRouteModal(): boolean {
  return useContext(InRouteModal)
}

/**
 * Modal shell for a routed detail overlay. Renders the detail component inside a
 * scrollable panel; closing returns to the background list. Deep-linking still
 * works — without a background location, App renders the detail as a full page.
 */
export function RouteModal({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const close = () => navigate(-1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [navigate])

  return (
    <InRouteModal.Provider value={true}>
      <div
        className="animate-overlay-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-6"
        onClick={close}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="animate-modal-pop relative w-full max-w-4xl rounded-2xl border border-border bg-bg shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 text-text-2 transition-colors hover:bg-surface-3 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="max-h-[calc(100vh-2.5rem)] overflow-y-auto p-4 sm:max-h-[calc(100vh-3rem)] sm:p-6">
            {children}
          </div>
        </div>
      </div>
    </InRouteModal.Provider>
  )
}
