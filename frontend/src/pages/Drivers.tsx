import { useState } from 'react'
import { Plus, Search, Power, PowerOff, Trash2 } from 'lucide-react'
import { useList } from '../hooks/useList'
import { api, apiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useMeta } from '../context/MetaContext'
import { useToast } from '../components/Toast'
import type { Driver } from '../lib/types'
import { fmtDate } from '../lib/format'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { StatusBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { DataTable } from '../components/DataTable'
import { OrgUnitSelect } from '../components/OrgUnitSelect'
import { Modal } from '../components/Modal'

export function Drivers() {
  const { can } = useAuth()
  const canManage = can('drivers.manage')
  const meta = useMeta()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Driver | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Driver | null>(null)
  const { items, page, lastPage, total, loading, setPage, reload } = useList<Driver>('/drivers', {
    search: search || undefined,
    status: status || undefined,
  })

  const toggleActive = async (d: Driver) => {
    try {
      await api.post(`/drivers/${d.id}/active`, { active: !d.active })
      toast.success(d.active ? `${d.name} deactivated` : `${d.name} reactivated`)
      reload()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  const remove = async () => {
    if (!removing) return
    try {
      await api.delete(`/drivers/${removing.id}`)
      toast.success(`${removing.name} removed`)
      setRemoving(null)
      reload()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle="Designated drivers and licence status"
        actions={canManage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add Driver</Button>}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input placeholder="Search name, employee ID, licence…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
            <option value="">All statuses</option>
            {meta?.enums.driver_status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No drivers found" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(d) => d.id}
            onRowClick={canManage ? (d) => setEditing(d) : undefined}
            columns={[
              {
                key: 'name', header: 'Name', primary: true, cell: (d) => (
                  <span className="inline-flex items-center gap-2 font-medium text-text">
                    {d.name}
                    {d.has_account && <span title="Has a self-service login" className="rounded bg-primary-tint px-1.5 py-0.5 text-[10px] font-medium text-primary">login</span>}
                  </span>
                ),
              },
              { key: 'emp', header: 'Employee ID', cell: (d) => d.employee_id ?? '—' },
              { key: 'phone', header: 'Phone', cell: (d) => d.phone ?? '—' },
              { key: 'unit', header: 'Unit', cell: (d) => d.org_unit?.name ?? '—' },
              { key: 'lic', header: 'Licence Expiry', cell: (d) => fmtDate(d.licence_expiry) },
              { key: 'status', header: 'Status', badge: true, cell: (d) => <StatusBadge label={d.status_label} color={d.status_color} /> },
            ]}
            actions={canManage ? (d) => (
              <div className="flex items-center justify-end gap-1">
                <button onClick={() => toggleActive(d)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-warning" title={d.active ? 'Deactivate' : 'Reactivate'}>
                  {d.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                </button>
                <button onClick={() => setRemoving(d)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-danger" title="Remove"><Trash2 className="h-4 w-4" /></button>
              </div>
            ) : undefined}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>

      {creating && <DriverFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {editing && <DriverFormModal driver={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {removing && (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title="Remove driver"
          footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={remove}>Remove</Button></>}
        >
          <p className="text-sm text-text-2">Remove <strong className="text-text">{removing.name}</strong>? Their trip history is retained (soft delete).</p>
        </Modal>
      )}
    </div>
  )
}

function DriverFormModal({ driver, onClose, onSaved }: { driver?: Driver; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth()
  const meta = useMeta()
  const toast = useToast()
  const isAdmin = can('drivers.manage')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: driver?.name ?? '',
    employee_id: driver?.employee_id ?? '',
    phone: driver?.phone ?? '',
    licence_number: driver?.licence_number ?? '',
    licence_expiry: driver?.licence_expiry ?? '',
    status: driver?.status ?? 'available',
    org_unit_id: driver?.org_unit_id != null ? String(driver.org_unit_id) : '',
    notes: driver?.notes ?? '',
    active: driver?.active ?? true,
  })
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  // Self-service login account (admin only).
  const hasAccount = driver?.has_account ?? false
  const [createLogin, setCreateLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState(driver?.account_email ?? '')
  const [loginPassword, setLoginPassword] = useState('')

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (createLogin && !loginEmail.trim()) {
      toast.error('A login email is required to enable an account')
      return
    }
    setLoading(true)
    try {
      const payload = {
        ...form,
        licence_expiry: form.licence_expiry || null,
        org_unit_id: form.org_unit_id ? Number(form.org_unit_id) : null,
        ...(createLogin ? { create_login: true, login_email: loginEmail, login_password: loginPassword || undefined } : {}),
      }
      if (driver) await api.put(`/drivers/${driver.id}`, payload)
      else await api.post('/drivers', payload)
      toast.success(driver ? 'Driver updated' : 'Driver added')
      onSaved()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={driver ? `Edit ${driver.name}` : 'Add Driver'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Employee ID"><Input value={form.employee_id} onChange={(e) => set('employee_id', e.target.value)} disabled={!isAdmin} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Licence Number"><Input value={form.licence_number} onChange={(e) => set('licence_number', e.target.value)} /></Field>
        <Field label="Licence Expiry"><Input type="date" value={form.licence_expiry} onChange={(e) => set('licence_expiry', e.target.value)} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {meta?.enums.driver_status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Org Unit" hint="Which unit this driver belongs to."><OrgUnitSelect value={form.org_unit_id} onChange={(v) => set('org_unit_id', v)} noneLabel="— Unassigned —" /></Field>
      </div>
      <div className="mt-4"><Field label="Notes"><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      {isAdmin && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Active
        </label>
      )}

      {isAdmin && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Self-service login</span>
            {hasAccount && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                Account: {driver?.account_email}
              </span>
            )}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            {hasAccount ? 'Update login credentials' : 'Enable a driver login account'}
          </label>
          {createLogin && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Login email" required>
                <Input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="driver@uits.test" autoComplete="off" />
              </Field>
              <Field label={hasAccount ? 'New password (blank = keep)' : 'Password'} required={!hasAccount}>
                <Input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="new-password" />
              </Field>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Drivers with a login can sign in to view and start/end their own assigned trips.
          </p>
        </div>
      )}
    </Modal>
  )
}
