import { useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'

export interface TabDef {
  key: string
  label: string
}

/**
 * In-page tabs with a sliding primary indicator, deep-linkable via ?tab=
 * (MASTER_DOC §I-7).
 */
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const isActive = t.key === active
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              'relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'text-primary' : 'text-text-2 hover:text-text',
            )}
          >
            {t.label}
            {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
          </button>
        )
      })}
    </div>
  )
}

/** Hook that syncs the active tab to the ?tab= query param. */
export function useTabParam(tabs: TabDef[], fallback: string): [string, (k: string) => void] {
  const [params, setParams] = useSearchParams()
  const current = params.get('tab')
  const active = tabs.some((t) => t.key === current) ? (current as string) : fallback
  const setActive = (key: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', key)
    setParams(next, { replace: true })
  }
  return [active, setActive]
}
