import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, Pencil, Power, PowerOff, Trash2 } from 'lucide-react'
import { useList } from '../../hooks/useList'
import { useAuth } from '../../context/AuthContext'
import { useMeta } from '../../context/MetaContext'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import type { Vehicle } from '../../lib/types'
import { fmtKm } from '../../lib/format'
import { Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from '../../components/ui'
import { StatusBadge } from '../../components/StatusBadge'
import { Pagination } from '../../components/Pagination'
import { DataTable } from '../../components/DataTable'
import { Modal } from '../../components/Modal'
import { VehicleFormModal } from './VehicleFormModal'

export function VehicleList() {
  const { can } = useAuth()
  const canManage = can('vehicles.manage')
  const meta = useMeta()
  const toast = useToast()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Vehicle | null>(null)
  const { items, page, lastPage, total, loading, setPage, reload } = useList<Vehicle>('/vehicles', {
    search: search || undefined,
    status: status || undefined,
  })

  const toggleActive = async (v: Vehicle) => {
    try {
      await api.post(`/vehicles/${v.id}/active`, { active: !v.active })
      toast.success(v.active ? `${v.vehicle_number} deactivated` : `${v.vehicle_number} reactivated`)
      reload()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const remove = async () => {
    if (!removing) return
    try {
      await api.delete(`/vehicles/${removing.id}`)
      toast.success(`${removing.vehicle_number} removed`)
      setRemoving(null)
      reload()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <div>
      <PageHeader
        title="Vehicles"
        subtitle="Fleet register and availability"
        actions={canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add Vehicle</Button>}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input placeholder="Search vehicle, registration, make…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="">All statuses</option>
            {meta?.enums.vehicle_status.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No vehicles found" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(v) => v.id}
            rowLink={(v) => `/vehicles/${v.id}`}
            overlay
            columns={[
              { key: 'num', header: 'Vehicle', primary: true, cell: (v) => <span className="font-medium text-primary">{v.vehicle_number}</span> },
              { key: 'reg', header: 'Registration', cell: (v) => v.registration_number },
              { key: 'model', header: 'Make / Model', cell: (v) => [v.make, v.model].filter(Boolean).join(' ') || '—' },
              { key: 'cap', header: 'Capacity', cell: (v) => v.capacity },
              { key: 'odo', header: 'Odometer', cell: (v) => fmtKm(v.current_odometer) },
              { key: 'status', header: 'Status', badge: true, cell: (v) => <StatusBadge label={v.status_label} color={v.status_color} /> },
            ]}
            actions={canManage ? (v) => (
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => setEditing(v)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-primary" title="Edit"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => toggleActive(v)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-warning" title={v.active ? 'Deactivate' : 'Reactivate'}>
                  {v.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                </button>
                <button onClick={() => setRemoving(v)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-danger" title="Remove"><Trash2 className="h-4 w-4" /></button>
              </div>
            ) : undefined}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>

      {creating && <VehicleFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {editing && <VehicleFormModal vehicle={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {removing && (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title="Remove vehicle"
          footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove</Button></>}
        >
          <p className="text-sm text-text-2">Remove <strong className="text-text">{removing.vehicle_number}</strong>? Its trip history is retained (soft delete).</p>
        </Modal>
      )}
    </div>
  )
}
