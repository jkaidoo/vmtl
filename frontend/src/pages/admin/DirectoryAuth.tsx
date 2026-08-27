import { useEffect, useState } from 'react'
import { Save, KeyRound, PlugZap, CheckCircle2, XCircle, Plus, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { api, apiError } from '../../lib/api'
import { useMeta } from '../../context/MetaContext'
import { useToast } from '../../components/Toast'
import { Tabs, useTabParam } from '../../components/Tabs'
import { OrgUnitSelect } from '../../components/OrgUnitSelect'
import { Button, Card, Field, Input, PageHeader, Select, Spinner } from '../../components/ui'

interface RoleRule { group: string; role: string; org_unit_id?: number | null }

interface DirField {
  key: string
  label: string
  type: 'string' | 'boolean' | 'select'
  options: Record<string, string> | null
  value: string | boolean
}

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'ldap', label: 'LDAP' },
  { key: 'ad', label: 'Active Directory' },
  { key: 'mapping', label: 'Role Mapping' },
]

export function DirectoryAuth() {
  const toast = useToast()
  const meta = useMeta()
  const [general, setGeneral] = useState<DirField[]>([])
  const [ldap, setLdap] = useState<DirField[]>([])
  const [ad, setAd] = useState<DirField[]>([])
  const [ldapHasPw, setLdapHasPw] = useState(false)
  const [adHasPw, setAdHasPw] = useState(false)
  const [ldapPw, setLdapPw] = useState('')
  const [adPw, setAdPw] = useState('')
  const [defaultRole, setDefaultRole] = useState('staff')
  const [defaultOrgUnit, setDefaultOrgUnit] = useState('')
  const [rules, setRules] = useState<RoleRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null)
  const [active, setActive] = useTabParam(TABS, 'general')

  const runTest = async (provider: 'ldap' | 'ad') => {
    setTesting(provider)
    setTestResult(null)
    try {
      const r = await api.post<{ data: { ok: boolean; message: string } }>('/admin/directory-auth/test', { provider })
      setTestResult({ provider, ...r.data.data })
      toast[r.data.data.ok ? 'success' : 'error'](r.data.data.message)
    } catch (e) {
      const msg = apiError(e, 'Test failed')
      setTestResult({ provider, ok: false, message: msg })
      toast.error(msg)
    } finally {
      setTesting(null)
    }
  }

  const load = () => {
    setLoading(true)
    api
      .get<{ data: { general: { fields: DirField[] }; ldap: { fields: DirField[]; has_bind_password: boolean }; ad: { fields: DirField[]; has_bind_password: boolean }; mapping: { default_role: string; default_org_unit: number | null; rules: RoleRule[] } } }>('/admin/directory-auth')
      .then((r) => {
        const d = r.data.data
        setGeneral(d.general.fields)
        setLdap(d.ldap.fields)
        setLdapHasPw(d.ldap.has_bind_password)
        setAd(d.ad.fields)
        setAdHasPw(d.ad.has_bind_password)
        setDefaultRole(d.mapping.default_role || 'staff')
        setDefaultOrgUnit(d.mapping.default_org_unit != null ? String(d.mapping.default_org_unit) : '')
        setRules(d.mapping.rules || [])
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const updater = (setter: React.Dispatch<React.SetStateAction<DirField[]>>) => (key: string, value: string | boolean) =>
    setter((f) => f.map((x) => (x.key === key ? { ...x, value } : x)))

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/directory-auth', {
        fields: [...general, ...ldap, ...ad].map((f) => ({ key: f.key, value: f.value })),
        ldap_bind_password: ldapPw || undefined,
        ad_bind_password: adPw || undefined,
        default_role: defaultRole,
        default_org_unit: defaultOrgUnit ? Number(defaultOrgUnit) : null,
        role_map: rules.filter((r) => r.group.trim() && r.role),
      })
      setLdapPw('')
      setAdPw('')
      toast.success('Directory settings saved')
      load()
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner label="Loading directory settings…" />

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Directory Authentication"
        subtitle="Configure LDAP and Active Directory sign-in"
        actions={<Button icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>Save</Button>}
      />

      <Tabs tabs={TABS} active={active} onChange={setActive} />

      {active === 'general' && (
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {general.map((f) => (
              <FieldControl key={f.key} field={f} onChange={updater(setGeneral)} />
            ))}
          </div>
          <p className="mt-4 text-xs text-text-3">
            Enable directory sign-in and choose which provider authenticates users. Configure each provider on its own tab.
          </p>
        </Card>
      )}

      {active === 'ldap' && (
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ldap.map((f) => (
              <FieldControl key={f.key} field={f} onChange={updater(setLdap)} />
            ))}
            <BindPassword label="Bind password" hasPassword={ldapHasPw} value={ldapPw} onChange={setLdapPw} />
          </div>
          <p className="mt-4 text-xs text-text-3">Generic LDAP directory (e.g. OpenLDAP). The bind password is write-only and never returned to the browser.</p>
          <TestBlock testing={testing === 'ldap'} result={testResult?.provider === 'ldap' ? testResult : null} onTest={() => runTest('ldap')} />
        </Card>
      )}

      {active === 'ad' && (
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ad.map((f) => (
              <FieldControl key={f.key} field={f} onChange={updater(setAd)} />
            ))}
            <BindPassword label="Bind account password" hasPassword={adHasPw} value={adPw} onChange={setAdPw} />
          </div>
          <p className="mt-4 text-xs text-text-3">Microsoft Active Directory. Users typically sign in with sAMAccountName or userPrincipalName; the bind password is write-only.</p>
          <TestBlock testing={testing === 'ad'} result={testResult?.provider === 'ad' ? testResult : null} onTest={() => runTest('ad')} />
        </Card>
      )}

      {active === 'mapping' && (
        <Card className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:max-w-lg sm:grid-cols-2">
            <Field label="Default role" hint="When no group rule matches.">
              <Select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
                {meta?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
              </Select>
            </Field>
            <Field label="Default org unit" hint="When no group rule matches.">
              <OrgUnitSelect value={defaultOrgUnit} onChange={setDefaultOrgUnit} noneLabel="— None —" />
            </Field>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Group → role &amp; unit rules</h3>
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setRules((rs) => [...rs, { group: '', role: 'staff', org_unit_id: null }])}>
                Add rule
              </Button>
            </div>

            {rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-text-3">
                No rules yet. Directory users get the default role &amp; unit until you add group mappings.
              </p>
            ) : (
              <div className="space-y-2">
                {rules.map((rule, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2.5 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                    <Input
                      placeholder="Group DN — e.g. cn=CoS-Transport,ou=Groups,dc=knust,dc=edu,dc=gh"
                      value={rule.group}
                      onChange={(e) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, group: e.target.value } : r)))}
                    />
                    <Select
                      className="sm:w-40"
                      value={rule.role}
                      onChange={(e) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)))}
                    >
                      {meta?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
                    </Select>
                    <div className="sm:w-52">
                      <OrgUnitSelect
                        value={rule.org_unit_id != null ? String(rule.org_unit_id) : ''}
                        onChange={(v) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, org_unit_id: v ? Number(v) : null } : r)))}
                        noneLabel="— Unit (optional) —"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                      className="justify-self-end rounded-lg p-2 text-text-3 hover:bg-surface-2 hover:text-danger"
                      aria-label="Remove rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="mt-4 text-xs text-text-3">
            On each directory sign-in, the first matching group rule (in order) sets the user’s role and org unit; otherwise the defaults apply. The break-glass System Administrator is never changed.
          </p>
        </Card>
      )}
    </div>
  )
}

function FieldControl({ field, onChange }: { field: DirField; onChange: (key: string, value: string | boolean) => void }) {
  if (field.type === 'boolean') {
    const on = !!field.value
    return (
      <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
        <span className="text-sm font-medium text-text">{field.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange(field.key, !on)}
          className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-surface-3'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </label>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <Field label={field.label}>
        <Select value={String(field.value ?? '')} onChange={(e) => onChange(field.key, e.target.value)}>
          <option value="">— Select —</option>
          {Object.entries(field.options).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </Field>
    )
  }

  return (
    <Field label={field.label}>
      <Input value={String(field.value ?? '')} onChange={(e) => onChange(field.key, e.target.value)} />
    </Field>
  )
}

function TestBlock({ testing, result, onTest }: { testing: boolean; result: { ok: boolean; message: string } | null; onTest: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <Button variant="secondary" icon={<PlugZap className="h-4 w-4" />} loading={testing} onClick={onTest}>
        Test connection
      </Button>
      {result && (
        <span className={clsx('inline-flex items-center gap-1.5 text-sm', result.ok ? 'text-success' : 'text-danger')}>
          {result.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          {result.message}
        </span>
      )}
      <span className="ml-auto text-xs text-text-3">Tests the saved settings — save first.</span>
    </div>
  )
}

function BindPassword({ label, hasPassword, value, onChange }: { label: string; hasPassword: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hasPassword ? 'A password is set — leave blank to keep it.' : 'No password set.'}>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-3" />
        <Input type="password" value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" placeholder="••••••••" autoComplete="new-password" />
      </div>
    </Field>
  )
}
