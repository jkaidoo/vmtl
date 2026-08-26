import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useList } from '../../hooks/useList'
import { useMeta } from '../../context/MetaContext'
import type { Trip } from '../../lib/types'
import { fmtDateTime, fmtKm } from '../../lib/format'
import { Card, EmptyState, Input, PageHeader, Select, Spinner } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import { Pagination } from '../../components/Pagination'
import { DataTable, type Column } from '../../components/DataTable'

export function TripList() {
  const meta = useMeta()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const { items, page, lastPage, total, loading, setPage } = useList<Trip>('/trips', {
    search: search || undefined,
    status: status || undefined,
  })

  const columns: Column<Trip>[] = [
    { key: 'trip', header: 'Trip #', primary: true, cell: (t) => <span className="font-medium text-primary">{t.trip_number}</span> },
    { key: 'vehicle', header: 'Vehicle', cell: (t) => t.vehicle?.vehicle_number ?? '—' },
    { key: 'driver', header: 'Driver', cell: (t) => t.driver?.name ?? '—' },
    { key: 'dest', header: 'Destination', cell: (t) => t.request?.destination ?? '—' },
    { key: 'sched', header: 'Scheduled', cell: (t) => fmtDateTime(t.scheduled_start) },
    { key: 'dist', header: 'Distance', cell: (t) => fmtKm(t.distance) },
    { key: 'status', header: 'Status', badge: true, cell: (t) => <StatusBadge label={t.status_label} color={t.status_color} /> },
  ]

  return (
    <div>
      <PageHeader title="Trips" subtitle="Scheduled, in-progress and completed trips" />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-3" />
            <Input placeholder="Search trip # or destination…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="">All statuses</option>
            {meta?.enums.trip_status.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No trips found" />
        ) : (
          <DataTable columns={columns} rows={items} rowKey={(t) => t.id} rowLink={(t) => `/trips/${t.id}`} overlay />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>
    </div>
  )
}
