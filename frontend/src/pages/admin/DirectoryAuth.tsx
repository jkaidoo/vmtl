import { useEffect, useState } from 'react'
import { Save, KeyRound } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { Button, Card, Field, Input, PageHeader, Spinner } from '../../components/ui'

interface DirField { key: string; label: string; type: string; value: string | boolean }

export function DirectoryAuth() {
  const toast = useToast()
  const [fields, setFields] = useState<DirField[]>([])
  const [hasBindPassword, setHasBindPassword] = useState(false)
  const [bindPassword, setBindPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    api.get<{ data: { fields: DirField[]; has_bind_password: boolean } }>('/admin/directory-auth').then((r) => {
      setFields(r.data.data.fields)
      setHasBindPassword(r.data.data.has_bind_password)
    }).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const setValue = (key: string, value: string | boolean) => setFields((f) => f.map((x) => (x.key === key ? { ...x, value } : x)))

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/directory-auth', {
        fields: fields.map((f) => ({ key: f.key, value: f.value })),
        bind_password: bindPassword || undefined,
      })
      setBindPassword('')
      toast.success('Directory settings saved')
      load()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="Loading directory settings…" />

  const enabled = fields.find((f) => f.key === 'directory_enabled')

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Directory Authentication"
        subtitle="LDAP / Active Directory integration"
        actions={<Button icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>Save</Button>}
      />

      <Card className="p-5">
        {enabled && (
          <label className="mb-4 flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm font-medium text-text">Enable directory authentication</span>
            <button
              type="button"
              role="switch"
              aria-checked={!!enabled.value}
              onClick={() => setValue('directory_enabled', !enabled.value)}
              className={`relative h-6 w-11 rounded-full transition-colors ${enabled.value ? 'bg-primary' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled.value ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </label>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.filter((f) => f.type !== 'boolean').map((f) => (
            <Field key={f.key} label={f.label}>
              <Input value={String(f.value ?? '')} onChange={(e) => setValue(f.key, e.target.value)} />
            </Field>
          ))}
          <Field label="Bind password" hint={hasBindPassword ? 'A password is set — leave blank to keep it.' : 'No password set.'}>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-3" />
              <Input type="password" value={bindPassword} onChange={(e) => setBindPassword(e.target.value)} className="pl-9" placeholder="••••••••" autoComplete="new-password" />
            </div>
          </Field>
        </div>

        <p className="mt-4 text-xs text-text-3">
          Attribute mappings normalise directory records into the app’s account model. The bind password is write-only and never returned to the browser.
        </p>
      </Card>
    </div>
  )
}
