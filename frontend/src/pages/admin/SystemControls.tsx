import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, PageHeader, Spinner } from '../../components/ui'

interface Control {
  key: string
  label: string | null
  group: string
  type: string
  value: string | number | boolean
}

const GROUP_LABELS: Record<string, string> = {
  features: 'Feature flags',
  notifications: 'Notifications',
  retention: 'Retention',
  maintenance: 'Maintenance',
}

export function SystemControls() {
  const toast = useToast()
  const [items, setItems] = useState<Control[]>([])
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState('')

  const load = () => {
    setLoading(true)
    api.get<{ data: Control[] }>('/admin/system-controls').then((r) => setItems(r.data.data)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const setValue = (key: string, value: string | boolean) => setItems((s) => s.map((x) => (x.key === key ? { ...x, value } : x)))

  const saveGroup = async (group: string) => {
    setSavingGroup(group)
    try {
      const changed = items.filter((s) => s.group === group).map((s) => ({ key: s.key, value: s.value }))
      await api.put('/admin/system-controls', { settings: changed })
      toast.success(`${GROUP_LABELS[group] ?? group} saved`)
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSavingGroup('')
    }
  }

  if (loading) return <Spinner label="Loading system controls…" />

  const groups = Array.from(new Set(items.map((s) => s.group)))

  return (
    <div className="max-w-3xl">
      <PageHeader title="System Controls" subtitle="Feature flags, notifications, retention and maintenance" />

      <div className="space-y-6">
        {groups.map((group) => (
          <Card key={group} className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-text">{GROUP_LABELS[group] ?? group}</h2>
              <Button size="sm" icon={<Save className="h-4 w-4" />} loading={savingGroup === group} onClick={() => saveGroup(group)}>Save</Button>
            </div>

            <div className={group === 'features' ? 'space-y-2' : 'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
              {items.filter((s) => s.group === group).map((s) =>
                s.type === 'boolean' ? (
                  <label key={s.key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <span className="text-sm text-text">{s.label ?? s.key}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!s.value}
                      onClick={() => setValue(s.key, !s.value)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${s.value ? 'bg-primary' : 'bg-surface-3'}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${s.value ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </label>
                ) : (
                  <Field key={s.key} label={s.label ?? s.key}>
                    <Input
                      type={s.type === 'integer' ? 'number' : 'text'}
                      value={String(s.value ?? '')}
                      onChange={(e) => setValue(s.key, e.target.value)}
                    />
                  </Field>
                ),
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
