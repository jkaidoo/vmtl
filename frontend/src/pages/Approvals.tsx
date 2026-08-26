import { Link, useLocation } from 'react-router-dom'
import { useList } from '../hooks/useList'
import type { VehicleRequest } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'

export function Approvals() {
  const location = useLocation()
  const { items, page, lastPage, total, loading, setPage } = useList<VehicleRequest>('/vehicle-requests', { status: 'pending' })

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Requests awaiting your review" />

      <Card>
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No pending requests" description="You're all caught up." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Request #</th>
                  <th className="px-4 py-2.5 font-medium">Requester</th>
                  <th className="px-4 py-2.5 font-medium">Department</th>
                  <th className="px-4 py-2.5 font-medium">Destination</th>
                  <th className="px-4 py-2.5 font-medium">Departure</th>
                  <th className="px-4 py-2.5 font-medium">Pax</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/requests/${r.id}`} state={{ background: location }} className="font-medium text-primary hover:underline">
                        {r.request_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.requester?.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.department_label ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.destination}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDateTime(r.requested_start_time)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.passenger_count}</td>
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
