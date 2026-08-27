import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import type { OrgUnit, EnumOption } from '../../lib/types'
import { Button, Card, PageHeader, Spinner, Field, Input, Select } from '../../components/ui'
import { Modal } from '../../components/Modal'

export function OrgUnits() {
  const toast = useToast()
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [types, setTypes] = useState<EnumOption[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OrgUnit | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<OrgUnit | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ data: OrgUnit[]; types: EnumOption[] }>('/org-units/tree')
      .then((r) => { setUnits(r.data.data); setTypes(r.data.types) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const remove = async () => {
    if (!removing) return
    try {
      await api.delete(`/org-units/${removing.id}`)
      toast.success('Org unit removed')
      setRemoving(null)
      load()
    } catch (e) {
      toast.error(apiError(e))
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Organisation Units"
        subtitle="College → Faculty → Department → Unit hierarchy. Fleet, drivers and staff are scoped to these."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add Unit</Button>}
      />

      <Card>
        {loading ? (
          <Spinner label="Loading units…" />
        ) : (
          <ul className="divide-y divide-border">
            {units.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50" style={{ paddingLeft: `${16 + u.depth * 22}px` }}>
                <Building2 className="h-4 w-4 shrink-0 text-text-3" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text">
                    {u.name}
                    {u.code && <span className="ml-2 text-xs text-text-3">{u.code}</span>}
                  </p>
                  <p className="text-xs text-text-3">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5">{u.type_label}</span>
                    <span className="ml-2">{u.vehicles_count ?? 0} vehicles · {u.drivers_count ?? 0} drivers · {u.users_count ?? 0} staff</span>
                  </p>
                </div>
                <button onClick={() => setEditing(u)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-primary" title="Edit"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => setRemoving(u)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-danger" title="Remove"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(creating || editing) && (
        <OrgUnitFormModal unit={editing ?? undefined} units={units} types={types} onClose={() => { setCreating(false); setEditing(null) }} onSaved={() => { setCreating(false); setEditing(null); load() }} />
      )}
      {removing && (
        <Modal open onClose={() => setRemoving(null)} title="Remove unit" footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Keep</Button><Button variant="danger" onClick={remove}>Remove</Button></>}>
          <p className="text-sm text-text-2">Remove <strong>{removing.name}</strong>? It must have no sub-units, vehicles, drivers or staff.</p>
        </Modal>
      )}
    </div>
  )
}

function OrgUnitFormModal({ unit, units, types, onClose, onSaved }: { unit?: OrgUnit; units: OrgUnit[]; types: EnumOption[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: unit?.name ?? '',
    code: unit?.code ?? '',
    type: unit?.type ?? (types[0]?.value ?? 'unit'),
    parent_id: unit?.parent_id != null ? String(unit.parent_id) : '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setLoading(true)
    try {
      const payload = { name: form.name, code: form.code || null, type: form.type, parent_id: form.parent_id ? Number(form.parent_id) : null }
      if (unit) await api.put(`/org-units/${unit.id}`, payload)
      else await api.post('/org-units', payload)
      toast.success(unit ? 'Unit updated' : 'Unit added')
      onSaved()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={unit ? `Edit ${unit.name}` : 'Add Org Unit'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Code"><Input value={form.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Parent unit">
          <Select value={form.parent_id} onChange={(e) => set('parent_id', e.target.value)}>
            <option value="">— None (top level) —</option>
            {units.filter((u) => u.id !== unit?.id).map((u) => (
              <option key={u.id} value={u.id}>{'  '.repeat(u.depth) + u.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
