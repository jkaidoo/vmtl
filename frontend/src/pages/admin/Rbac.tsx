import { Fragment, useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { Button, Card, PageHeader, Spinner } from '../../components/ui'

interface Capability { key: string; label: string; group: string; description: string }
interface RbacRole { id: number; slug: string; name: string; description: string | null; capabilities: string[] }
interface RbacData { capabilities: Capability[]; roles: RbacRole[]; scopes: { key: string; description: string }[]; note: string }

export function Rbac() {
  const toast = useToast()
  const [data, setData] = useState<RbacData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Editable matrix: roleId -> Set(capability)
  const [matrix, setMatrix] = useState<Record<number, Set<string>>>({})
  const [dirty, setDirty] = useState<Set<number>>(new Set())

  const load = () => {
    setLoading(true)
    api.get<{ data: RbacData }>('/rbac').then((r) => {
      setData(r.data.data)
      const m: Record<number, Set<string>> = {}
      r.data.data.roles.forEach((role) => (m[role.id] = new Set(role.capabilities)))
      setMatrix(m)
      setDirty(new Set())
    }).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const groups = useMemo(() => {
    if (!data) return []
    const byGroup = new Map<string, Capability[]>()
    data.capabilities.forEach((c) => byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]))
    return Array.from(byGroup.entries())
  }, [data])

  const toggle = (roleId: number, cap: string) => {
    setMatrix((prev) => {
      const set = new Set(prev[roleId])
      set.has(cap) ? set.delete(cap) : set.add(cap)
      return { ...prev, [roleId]: set }
    })
    setDirty((d) => new Set(d).add(roleId))
  }

  const save = async () => {
    if (!data) return
    setSaving(true)
    try {
      for (const roleId of dirty) {
        await api.put(`/rbac/roles/${roleId}/capabilities`, { capabilities: Array.from(matrix[roleId] ?? []) })
      }
      toast.success('Capabilities updated')
      load()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !data) return <Spinner label="Loading RBAC…" />

  return (
    <div>
      <PageHeader
        title="RBAC"
        subtitle="Grant capabilities to roles — enforced server-side"
        actions={<Button icon={<Check className="h-4 w-4" />} loading={saving} disabled={dirty.size === 0} onClick={save}>Save changes</Button>}
      />

      <Card className="mb-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-3">Capability</th>
              {data.roles.map((r) => (
                <th key={r.id} className="px-3 py-3 text-center text-xs font-medium text-text-2">{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, caps]) => (
              <Fragment key={group}>
                <tr className="bg-surface-2">
                  <td colSpan={data.roles.length + 1} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-text-3">{group}</td>
                </tr>
                {caps.map((cap) => (
                  <tr key={cap.key} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-text">{cap.label}</p>
                      <p className="text-xs text-text-3">{cap.description}</p>
                    </td>
                    {data.roles.map((role) => (
                      <td key={role.id} className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border-strong text-primary focus:ring-primary/30"
                          checked={matrix[role.id]?.has(cap.key) ?? false}
                          onChange={() => toggle(role.id, cap.key)}
                          aria-label={`${cap.label} for ${role.name}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-semibold text-text">Scopes</h2>
        <ul className="space-y-1.5 text-sm text-text-2">
          {data.scopes.map((s) => (
            <li key={s.key}><span className="font-mono font-semibold text-text">{s.key}</span> — {s.description}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-3">{data.note}</p>
      </Card>
    </div>
  )
}
