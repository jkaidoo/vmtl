import { useState } from 'react'
import { Plus, Search, Pencil } from 'lucide-react'
import { useList } from '../hooks/useList'
import { api, apiError } from '../lib/api'
import { useMeta } from '../context/MetaContext'
import { useToast } from '../components/Toast'
import { fileToAvatarDataUrl } from '../lib/image'
import type { User } from '../lib/types'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../components/ui'
import { Pagination } from '../components/Pagination'
import { DataTable } from '../components/DataTable'
import { Modal } from '../components/Modal'

export function Users({ embedded = false }: { embedded?: boolean } = {}) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const { items, page, lastPage, total, loading, setPage, reload } = useList<User>('/users', { search: search || undefined })

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-text-2">Staff accounts, roles and access.</p>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add User</Button>
        </div>
      ) : (
        <PageHeader
          title="Users"
          subtitle="Manage accounts and roles"
          actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add User</Button>}
        />
      )}

      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <DataTable
            rows={items}
            rowKey={(u) => u.id}
            columns={[
              { key: 'name', header: 'Name', primary: true, cell: (u) => <span className="font-medium text-text">{u.name}</span> },
              { key: 'email', header: 'Email', cell: (u) => u.email },
              { key: 'role', header: 'Role', cell: (u) => u.role?.name ?? '—' },
              { key: 'dept', header: 'Department', cell: (u) => u.department?.name ?? '—' },
              {
                key: 'active', header: 'Active', badge: true, cell: (u) => (
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${u.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                ),
              },
            ]}
            actions={(u) => (
              <button onClick={() => setEditing(u)} className="text-text-3 hover:text-primary" title="Edit"><Pencil className="h-4 w-4" /></button>
            )}
          />
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onChange={setPage} />
      </Card>

      {creating && <UserFormModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />}
      {editing && <UserFormModal user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function UserFormModal({ user, onClose, onSaved }: { user?: User; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null)
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    password_confirmation: '',
    role_id: user?.role?.id?.toString() ?? '',
    department_id: user?.department_id?.toString() ?? '',
    phone: user?.phone ?? '',
    active: user?.active ?? true,
  })
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  const onPickAvatar = async (file?: File) => {
    if (!file) return
    try {
      setAvatar(await fileToAvatarDataUrl(file))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const submit = async () => {
    if (!form.name || !form.email || !form.role_id) {
      toast.error('Name, email and role are required')
      return
    }
    setLoading(true)
    try {
      const payload = {
        name: form.name,
        email: form.email,
        role_id: Number(form.role_id),
        department_id: form.department_id ? Number(form.department_id) : null,
        phone: form.phone || null,
        active: form.active,
        avatar, // profile picture (data URL) or null to clear
        ...(form.password ? { password: form.password, password_confirmation: form.password_confirmation } : {}),
      }
      if (user) await api.put(`/users/${user.id}`, payload)
      else await api.post('/users', payload)
      toast.success(user ? 'User updated' : 'User created')
      onSaved()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.name}` : 'Add User'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}>
      {/* Profile picture */}
      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-lg font-semibold text-text-2">
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : (form.name?.charAt(0) || '?')}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
            {avatar ? 'Change photo' : 'Upload photo'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickAvatar(e.target.files?.[0])} />
          </label>
          {avatar && <button type="button" onClick={() => setAvatar(null)} className="text-left text-xs text-danger hover:underline">Remove photo</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Role" required>
          <Select value={form.role_id} onChange={(e) => set('role_id', e.target.value)}>
            <option value="">— Select —</option>
            {meta?.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
            <option value="">— None —</option>
            {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <div />
        <Field label={user ? 'New Password (optional)' : 'Password'} required={!user}>
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm Password">
          <Input type="password" value={form.password_confirmation} onChange={(e) => set('password_confirmation', e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        Active account
      </label>
    </Modal>
  )
}
