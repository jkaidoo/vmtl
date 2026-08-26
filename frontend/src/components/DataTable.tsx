import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Column shown as the card title on mobile (defaults to the first column). */
  primary?: boolean
  /** Column shown top-right on the mobile card (e.g. a status badge). */
  badge?: boolean
  /** Extra classes for the header/cell (desktop). */
  className?: string
  /** Omit this column from the mobile card entirely. */
  hideOnMobile?: boolean
}

/**
 * Responsive list: a table on tablet/desktop, and stacked cards on mobile that
 * fit the frame with no horizontal scrolling. Used by every list page.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowLink,
  actions,
  overlay,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  rowLink?: (row: T) => string
  actions?: (row: T) => ReactNode
  /** Open rowLink as a modal overlay over the current list (background location). */
  overlay?: boolean
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const linkState = overlay ? { background: location } : undefined

  const primary = columns.find((c) => c.primary) ?? columns[0]
  const badge = columns.find((c) => c.badge)
  const metaCols = columns.filter((c) => c !== primary && c !== badge && !c.hideOnMobile)

  return (
    <>
      {/* Tablet / desktop */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-text-3">
              {columns.map((c) => (
                <th key={c.key} className={clsx('px-4 py-2.5 font-medium', c.className)}>
                  {c.header}
                </th>
              ))}
              {actions && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={clsx('hover:bg-surface-2/60', rowLink && 'cursor-pointer')}
                onClick={rowLink ? () => navigate(rowLink(row), { state: linkState }) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-4 py-3 text-text-2', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-border sm:hidden">
        {rows.map((row) => {
          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 truncate font-medium text-text">{primary.cell(row)}</div>
                <div className="flex shrink-0 items-center gap-2">
                  {badge && <span>{badge.cell(row)}</span>}
                  {actions && (
                    <span onClick={(e) => { e.stopPropagation(); e.preventDefault() }}>{actions(row)}</span>
                  )}
                </div>
              </div>
              {metaCols.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
                  {metaCols.map((c) => (
                    <span key={c.key}>
                      <span className="text-text-3">{c.header}: </span>
                      {c.cell(row)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )
          return (
            <li key={rowKey(row)}>
              {rowLink ? (
                <Link to={rowLink(row)} state={linkState} className="block px-4 py-3 hover:bg-surface-2">
                  {inner}
                </Link>
              ) : (
                <div className="px-4 py-3">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
