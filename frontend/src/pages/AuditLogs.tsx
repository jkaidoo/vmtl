import { useState } from 'react'
import { Search } from 'lucide-react'
import { useList } from '../hooks/useList'
import type { AuditLog } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { Card, EmptyState, Input, PageHeader, Spinner } from '../components/ui'
import { Pagination } from '../components/Pagination'
import { DataTable } from '../components/DataTable'

export function AuditLogs() {
  const [search, setSearch] = useState('')
  const { items, page, lastPage, total, loading, setPage } = useList<AuditLog>('/audit-logs', { search: search || undefined })

  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Immutable record of all system actions" />

      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input placeholder="Search actions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No audit records" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(a) => a.id}
            columns={[
              { key: 'desc', header: 'Description', primary: true, cell: (a) => <span className="text-text">{a.description}</span> },
              { key: 'ts', header: 'Timestamp', className: 'whitespace-nowrap', cell: (a) => fmtDateTime(a.created_at) },
              { key: 'user', header: 'User', cell: (a) => a.user?.name ?? 'System' },
              { key: 'action', header: 'Action', cell: (a) => <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-text-2">{a.action}</code> },
              { key: 'ip', header: 'IP', cell: (a) => a.ip_address ?? '—' },
            ]}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>
    </div>
  )
}
