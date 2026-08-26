import { useEffect, useState } from 'react'
import { Database, HardDrive } from 'lucide-react'
import { api } from '../../lib/api'
import { Card, EmptyState, PageHeader, Spinner } from '../../components/ui'

interface DbData {
  active: {
    name: string; driver: string; host: string; port: string | number; database: string
    username: string; password: string; version: string | null; size_mb: number | null
  }
  profiles: { name: string; driver: string; active: boolean }[]
  tables: { table: string; rows: number | null }[]
  migration_note: string
}

export function DatabaseConnections() {
  const [data, setData] = useState<DbData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ data: DbData }>('/admin/database').then((r) => setData(r.data.data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner label="Loading database info…" />
  if (!data) return <EmptyState title="Could not load database info" />

  const a = data.active
  const rows: [string, string][] = [
    ['Connection', a.name],
    ['Driver', a.driver],
    ['Host', `${a.host}:${a.port}`],
    ['Database', a.database],
    ['Username', a.username],
    ['Password', a.password],
    ['Server version', a.version ?? '—'],
    ['Size', a.size_mb != null ? `${a.size_mb} MB` : '—'],
  ]

  return (
    <div>
      <PageHeader title="Database Connections" subtitle="Active connection and storage" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-text">Active connection</h2>
          </div>
          <dl className="space-y-2">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 text-sm">
                <dt className="text-text-3">{k}</dt>
                <dd className="truncate font-medium text-text">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-text-2">{data.migration_note}</p>
        </Card>

        <Card className="lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <HardDrive className="h-4 w-4 text-text-3" />
            <h2 className="font-semibold text-text">Tables ({data.tables.length})</h2>
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-xs uppercase tracking-wide text-text-3">
                  <th className="px-5 py-2 font-medium">Table</th>
                  <th className="px-5 py-2 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.tables.map((t) => (
                  <tr key={t.table} className="hover:bg-surface-2/50">
                    <td className="px-5 py-2 font-mono text-text-2">{t.table}</td>
                    <td className="px-5 py-2 text-right tnum text-text">{t.rows ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
