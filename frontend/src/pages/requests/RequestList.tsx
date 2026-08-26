import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, CalendarClock } from 'lucide-react'
import { useList } from '../../hooks/useList'
import { useMeta } from '../../context/MetaContext'
import { useAuth } from '../../context/AuthContext'
import type { VehicleRequest } from '../../lib/types'
import { fmtDate } from '../../lib/format'
import { Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import { Pagination } from '../../components/Pagination'
import { DataTable, type Column } from '../../components/DataTable'

export function RequestList() {
  const meta = useMeta()
  const { requesterOnly } = useAuth()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const { items, page, lastPage, total, loading, setPage } = useList<VehicleRequest>('/vehicle-requests', {
    search: search || undefined,
    status: status || undefined,
  })

  const columns: Column<VehicleRequest>[] = [
    { key: 'num', header: 'Request #', primary: true, cell: (r) => <span className="font-medium text-primary">{r.request_number}</span> },
    // Staff never see the requester column (it is always themselves).
    ...(requesterOnly ? [] : [{ key: 'requester', header: 'Requester', cell: (r: VehicleRequest) => r.requester?.name ?? '—' }]),
    { key: 'dest', header: 'Destination', cell: (r) => r.destination },
    { key: 'date', header: 'Travel Date', cell: (r) => fmtDate(r.travel_date) },
    { key: 'pax', header: 'Passengers', cell: (r) => r.passenger_count },
    { key: 'status', header: 'Status', badge: true, cell: (r) => <StatusBadge label={r.status_label} color={r.status_color} /> },
  ]

  return (
    <div>
      <PageHeader
        title="Vehicle Requests"
        subtitle="Submit and track requests for official vehicle use"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/requests/availability">
              <Button variant="secondary" icon={<CalendarClock className="h-4 w-4" />}>Availability</Button>
            </Link>
            <Link to="/requests/create">
              <Button icon={<Plus className="h-4 w-4" />}>New Request</Button>
            </Link>
          </div>
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-3" />
            <Input placeholder="Search request #, destination, purpose…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="">All statuses</option>
            {meta?.enums.request_status.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No requests found" description="Try adjusting your filters or create a new request." />
        ) : (
          <DataTable columns={columns} rows={items} rowKey={(r) => r.id} rowLink={(r) => `/requests/${r.id}`} overlay />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>
    </div>
  )
}
