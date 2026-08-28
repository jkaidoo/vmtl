import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Building2, ChevronRight, Search, Car, Users, FoldVertical, UnfoldVertical } from 'lucide-react'
import { clsx } from 'clsx'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import type { OrgUnit, EnumOption } from '../../lib/types'
import { buildForest, canDrop, visibleForQuery, type OrgNode } from '../../lib/orgtree'
import { Button, Card, PageHeader, Spinner, Field, Input, Select } from '../../components/ui'
import { Modal } from '../../components/Modal'

/** Per-type accent (disc + pill) using the KNUST design tokens. */
const TYPE_STYLE: Record<string, string> = {
  institution: 'bg-primary-tint text-primary',
  college: 'bg-info/10 text-info',
  faculty: 'bg-violet/10 text-violet',
  department: 'bg-success/15 text-success',
  directorate: 'bg-warning/10 text-warning',
  unit: 'bg-surface-2 text-text-3',
  office: 'bg-surface-2 text-text-3',
}
const typeStyle = (t: string) => TYPE_STYLE[t] ?? TYPE_STYLE.unit

export function OrgUnits() {
  const toast = useToast()
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [types, setTypes] = useState<EnumOption[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OrgUnit | null>(null)
  const [creating, setCreating] = useState<{ parent: OrgUnit | null } | null>(null)
  const [removing, setRemoving] = useState<OrgUnit | null>(null)

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropId, setDropId] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const didInit = useRef(false)

  const load = useCallback(() => {
    setLoading(true)
    return api
      .get<{ data: OrgUnit[]; types: EnumOption[] }>('/org-units/tree')
      .then((r) => {
        setUnits(r.data.data)
        setTypes(r.data.types)
        // First load: reveal the top two levels so the shape is immediately legible.
        if (!didInit.current) {
          didInit.current = true
          setExpanded(new Set(r.data.data.filter((u) => u.depth <= 1).map((u) => u.id)))
        }
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => void load(), [load])

  const forest = useMemo(() => buildForest(units), [units])
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const searching = query.trim().length > 0
  const visible = useMemo(() => visibleForQuery(units, query), [units, query])

  const isOpen = (id: number) => searching || expanded.has(id)
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const expandAll = () => setExpanded(new Set(units.map((u) => u.id)))
  const collapseAll = () => setExpanded(new Set())

  const move = useCallback(
    async (dragged: OrgUnit, target: OrgUnit) => {
      if (!canDrop(dragged, target)) return
      setMoving(true)
      try {
        await api.put(`/org-units/${dragged.id}`, {
          name: dragged.name,
          code: dragged.code,
          type: dragged.type,
          parent_id: target.id,
        })
        toast.success(`Moved “${dragged.name}” into “${target.name}”`)
        await load()
        setExpanded((prev) => new Set(prev).add(target.id)) // reveal where it landed
      } catch (e) {
        toast.error(apiError(e))
      } finally {
        setMoving(false)
        setDragId(null)
        setDropId(null)
      }
    },
    [load, toast],
  )

  const renderNode = (node: OrgNode) => {
    if (searching && !visible.has(node.id)) return null
    const hasChildren = node.children.length > 0
    const open = isOpen(node.id)
    const dragging = dragId === node.id
    const dragged = dragId != null ? byId.get(dragId) : undefined
    const isValidTarget = !!dragged && dragId !== node.id && canDrop(dragged, node)
    const isDrop = dropId === node.id && isValidTarget

    return (
      <div key={node.id}>
        <div
          draggable={!moving}
          onDragStart={(e) => {
            setDragId(node.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragId(null)
            setDropId(null)
          }}
          onDragOver={(e) => {
            if (!isValidTarget) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (dropId !== node.id) setDropId(node.id)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragged) void move(dragged, node)
          }}
          className={clsx(
            'group flex cursor-grab items-center gap-2 rounded-xl border px-2.5 py-2 transition-all active:cursor-grabbing',
            dragging && 'opacity-40',
            isDrop
              ? 'border-primary bg-primary-tint ring-2 ring-primary/40'
              : 'border-transparent hover:border-border hover:bg-surface-2/60',
          )}
        >
          {/* Drag grip (appears on hover) */}
          <span className="grid shrink-0 grid-cols-2 gap-0.5 px-0.5 opacity-0 transition-opacity group-hover:opacity-40" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="h-[3px] w-[3px] rounded-full bg-current" />
            ))}
          </span>

          {/* Expand / collapse toggle (or a spacer to keep rows aligned) */}
          {hasChildren ? (
            <button
              onClick={() => toggle(node.id)}
              disabled={searching}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-40"
              title={open ? 'Collapse' : 'Expand'}
            >
              <ChevronRight className={clsx('h-4 w-4 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}

          {/* Type disc */}
          <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', typeStyle(node.type))}>
            <Building2 className="h-4 w-4" />
          </span>

          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate font-medium text-text">
              <span className="truncate">{node.name}</span>
              {node.code && <span className="shrink-0 text-xs font-normal text-text-3">{node.code}</span>}
              {hasChildren && (
                <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-semibold text-text-3">
                  {node.children.length}
                </span>
              )}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-3">
              <span className={clsx('rounded px-1.5 py-0.5 font-medium', typeStyle(node.type))}>{node.type_label}</span>
              {!!node.vehicles_count && (
                <span className="inline-flex items-center gap-1"><Car className="h-3 w-3" />{node.vehicles_count}</span>
              )}
              {!!node.users_count && (
                <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{node.users_count}</span>
              )}
              {!!node.drivers_count && <span>{node.drivers_count} drivers</span>}
            </div>
          </div>

          {/* Row actions */}
          <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button onClick={() => setCreating({ parent: node })} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-primary" title="Add sub-unit"><Plus className="h-4 w-4" /></button>
            <button onClick={() => setEditing(node)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-primary" title="Edit"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => setRemoving(node)} className="rounded p-1.5 text-text-3 hover:bg-surface-2 hover:text-danger" title="Remove"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Children with a guide rail */}
        {hasChildren && open && (
          <div className="ml-[1.35rem] border-l border-border/70 pl-2">{node.children.map(renderNode)}</div>
        )}
      </div>
    )
  }

  const visibleRoots = forest.filter((n) => !searching || visible.has(n.id))

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Organisation Units"
        subtitle="Drag a unit onto another to move it. College → Faculty → Department → Unit; fleet, drivers and staff are scoped to these."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating({ parent: null })}>Add Unit</Button>}
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search units…" className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<UnfoldVertical className="h-4 w-4" />} onClick={expandAll} disabled={searching}>Expand all</Button>
          <Button variant="secondary" size="sm" icon={<FoldVertical className="h-4 w-4" />} onClick={collapseAll} disabled={searching}>Collapse all</Button>
        </div>
      </div>

      <Card className={clsx('p-2 transition-opacity', moving && 'pointer-events-none opacity-60')}>
        {loading ? (
          <Spinner label="Loading units…" />
        ) : visibleRoots.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-text-3">No units match “{query}”.</p>
        ) : (
          <div>{visibleRoots.map(renderNode)}</div>
        )}
      </Card>

      {(creating || editing) && (
        <OrgUnitFormModal
          unit={editing ?? undefined}
          presetParent={creating?.parent ?? undefined}
          units={units}
          types={types}
          onClose={() => { setCreating(null); setEditing(null) }}
          onSaved={() => { setCreating(null); setEditing(null); load() }}
        />
      )}
      {removing && (
        <Modal open onClose={() => setRemoving(null)} title="Remove unit" footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Keep</Button><Button variant="danger" onClick={async () => {
          try {
            await api.delete(`/org-units/${removing.id}`)
            toast.success('Org unit removed')
            setRemoving(null)
            load()
          } catch (e) {
            toast.error(apiError(e))
          }
        }}>Remove</Button></>}>
          <p className="text-sm text-text-2">Remove <strong>{removing.name}</strong>? It must have no sub-units, vehicles, drivers or staff.</p>
        </Modal>
      )}
    </div>
  )
}

function OrgUnitFormModal({ unit, presetParent, units, types, onClose, onSaved }: { unit?: OrgUnit; presetParent?: OrgUnit; units: OrgUnit[]; types: EnumOption[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: unit?.name ?? '',
    code: unit?.code ?? '',
    type: unit?.type ?? (types[0]?.value ?? 'unit'),
    parent_id: unit?.parent_id != null ? String(unit.parent_id) : presetParent ? String(presetParent.id) : '',
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

  const title = unit ? `Edit ${unit.name}` : presetParent ? `Add sub-unit of ${presetParent.name}` : 'Add Org Unit'

  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={loading} onClick={submit}>Save</Button></>}>
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
              <option key={u.id} value={u.id}>{'  '.repeat(u.depth) + u.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}
