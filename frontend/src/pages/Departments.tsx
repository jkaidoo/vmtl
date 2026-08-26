import { useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { useList } from '../hooks/useList'
import { api, apiError } from '../lib/api'
import { useToast } from '../components/Toast'
import type { Department } from '../lib/types'
import { Button, Card, EmptyState, Field, Input, PageHeader, Spinner } from '../components/ui'
import { Pagination } from '../components/Pagination'
import { DataTable } from '../components/DataTable'
import { Modal } from '../components/Modal'

export function Departments({ embedded = false }: { embedded?: boolean } = {}) {
  const [editing, setEditing] = useState<Department | null>(null)
  const [creating, setCreating] = useState(false)
  const { items, page, lastPage, total, loading, setPage, reload } = useList<Department>('/departments', {})

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-text-2">Organisational units used on requests.</p>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add Department</Button>
        </div>
      ) : (
        <PageHeader
          title="Departments"
          subtitle="Organisational units"
          actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add Department</Button>}
        />
      )}

      <Card>
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No departments" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(d) => d.id}
            columns={[
              { key: 'name', header: 'Name', primary: true, cell: (d) => <span className="font-medium text-text">{d.name}</span> },
              { key: 'code', header: 'Code', cell: (d) => d.code ?? '—' },
              {
                key: 'active', header: 'Active', badge: true, cell: (d) => (
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${d.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                    {d.active ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
            ]}
            actions={(d) => (
              <button onClick={() => setEditing(d)} className="text-text-3 hover:text-primary" title="Edit"><Pencil className="h-4 w-4" /></button>
            )}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>

      {creating && <DeptFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {editing && <DeptFormModal department={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function DeptFormModal({ department, onClose, onSaved }: { department?: Department; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: department?.name ?? '', code: department?.code ?? '', active: department?.active ?? true })
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    setLoading(true)
    try {
      if (department) await api.put(`/departments/${department.id}`, form)
      else await api.post('/departments', form)
      toast.success(department ? 'Department updated' : 'Department created')
      onSaved()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={department ? 'Edit Department' : 'Add Department'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Active
        </label>
      </div>
    </Modal>
  )
}
