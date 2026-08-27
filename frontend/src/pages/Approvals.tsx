import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useList } from '../hooks/useList'
import { api } from '../lib/api'
import type { VehicleRequest } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Tabs, useTabParam } from '../components/Tabs'

const EMPTY: Record<string, string> = {
  pending: "You're all caught up.",
  changes_requested: 'Nothing is currently sent back for changes.',
  open: 'No open requests.',
}

export function Approvals() {
  const location = useLocation()

  // Count of requests currently sent back for changes (for the tab badge).
  const [changesCount, setChangesCount] = useState<number | null>(null)
  const refreshChangesCount = () => {
    api
      .get<{ meta?: { total: number } }>('/vehicle-requests', { params: { status: 'changes_requested', per_page: 1 } })
      .then((r) => setChangesCount(r.data.meta?.total ?? 0))
      .catch(() => undefined)
  }
  useEffect(refreshChangesCount, [])

  const tabs = [
    { key: 'pending', label: 'Pending' },
    { key: 'changes_requested', label: changesCount ? `Changes Requested (${changesCount})` : 'Changes Requested' },
    { key: 'open', label: 'All open' },
  ]
  const [active, setActive] = useTabParam(tabs, 'pending')
  const status = active === 'open' ? 'pending,changes_requested' : active

  const { items, page, lastPage, total, loading, setPage } = useList<VehicleRequest>('/vehicle-requests', { status })

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle={active === 'changes_requested' ? 'Requests you sent back — awaiting the requester’s edits' : 'Requests awaiting your review'}
      />

      <Tabs tabs={tabs} active={active} onChange={setActive} />

      <Card>
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="Nothing here" description={EMPTY[active] ?? 'No requests.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-text-3">
                  <th className="px-4 py-2.5 font-medium">Request #</th>
                  <th className="px-4 py-2.5 font-medium">Requester</th>
                  <th className="px-4 py-2.5 font-medium">Department</th>
                  <th className="px-4 py-2.5 font-medium">Destination</th>
                  <th className="px-4 py-2.5 font-medium">Departure</th>
                  <th className="px-4 py-2.5 font-medium">Pax</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <Link to={`/requests/${r.id}`} state={{ background: location }} className="font-medium text-primary hover:underline">
                        {r.request_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-2">{r.requester?.name}</td>
                    <td className="px-4 py-3 text-text-2">{r.department_label ?? '—'}</td>
                    <td className="px-4 py-3 text-text">{r.destination}</td>
                    <td className="px-4 py-3 text-text-2">{fmtDateTime(r.requested_start_time)}</td>
                    <td className="px-4 py-3 text-text-2">{r.passenger_count}</td>
                    <td className="px-4 py-3">
                      <StatusBadge label={r.status_label} color={r.status_color} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>
    </div>
  )
}
