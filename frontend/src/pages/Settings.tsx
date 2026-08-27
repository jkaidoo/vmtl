import { useEffect, useState } from 'react'
import { Download, ShieldCheck, Save, ScrollText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'
import { useToast } from '../components/Toast'
import { Button, Card, Field, Input, PageHeader, Spinner } from '../components/ui'
import { Tabs, useTabParam, type TabDef } from '../components/Tabs'
import { Users } from './Users'

interface Setting {
  key: string
  value: string | null
  type: string
  group: string
  label: string | null
}

const TABS: TabDef[] = [
  { key: 'general', label: 'General' },
  { key: 'accounts', label: 'Staff accounts' },
  { key: 'rbac', label: 'Roles & RBAC' },
  { key: 'backup', label: 'Backup & export' },
]

// VMTL capability catalog (MASTER_DOC Part II §1/§7). Static, DB-free.
const RBAC: { role: string; caps: string[] }[] = [
  { role: 'System Administrator', caps: ['Full access', 'Manage users & roles', 'Manage departments', 'Manage vehicles & drivers', 'System settings', 'Audit logs', 'Odometer corrections'] },
  { role: 'Approver', caps: ['View pending requests', 'Approve / reject (with reason)', 'View request history', 'Analytics'] },
  { role: 'Transport / Admin Officer', caps: ['Assign vehicle + driver', 'Start / end / no-show trips', 'Record odometer', 'Maintenance', 'Reports & exports', 'Manage availability'] },
  { role: 'Staff', caps: ['Create requests', 'Track own requests', 'Cancel eligible requests'] },
  { role: 'Driver', caps: ['View own assigned trips', 'Start / end / no-show own trips'] },
]

export function Settings() {
  const [active, setActive] = useTabParam(TABS, 'general')

  return (
    <div>
      <PageHeader title="Settings" subtitle="System administration — UITS Vehicle Management" />
      <Tabs tabs={TABS} active={active} onChange={setActive} />

      {active === 'general' && <GeneralTab />}
      {active === 'accounts' && <Users embedded />}
      {active === 'rbac' && <RbacTab />}
      {active === 'backup' && <BackupTab />}
    </div>
  )
}

function GeneralTab() {
  const toast = useToast()
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState('')

  useEffect(() => {
    api.get<{ data: Setting[] }>('/settings').then((r) => setSettings(r.data.data)).finally(() => setLoading(false))
  }, [])

  const setValue = (key: string, value: string) => setSettings((s) => s.map((x) => (x.key === key ? { ...x, value } : x)))

  // Independent per-section save (MASTER_DOC Part II §3): only send this group's keys.
  const saveGroup = async (group: string) => {
    setSavingGroup(group)
    try {
      const changed = settings.filter((s) => s.group === group).map((s) => ({ key: s.key, value: s.value }))
      await api.put('/settings', { settings: changed })
      toast.success(`${group} settings saved`)
    } catch (e) {
      toast.error(apiError(e))
    } finally {
      setSavingGroup('')
    }
  }

  if (loading) return <Spinner label="Loading settings…" />

  const groups = Array.from(new Set(settings.map((s) => s.group)))

  return (
    <div className="max-w-3xl space-y-6">
      {groups.map((group) => (
        <Card key={group} className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold capitalize text-text">{group}</h2>
            <Button size="sm" icon={<Save className="h-4 w-4" />} loading={savingGroup === group} onClick={() => saveGroup(group)}>
              Save {group}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {settings.filter((s) => s.group === group).map((s) => (
              <Field key={s.key} label={s.label ?? s.key}>
                <Input type={s.type === 'integer' ? 'number' : 'text'} value={s.value ?? ''} onChange={(e) => setValue(s.key, e.target.value)} />
              </Field>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function RbacTab() {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-text">Roles & capabilities</h2>
        </div>
        <p className="mb-4 text-sm text-text-2">
          Access is capability-based and <strong>enforced server-side</strong> — the interface only reflects what each role may do.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-3">
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Capabilities</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {RBAC.map((r) => (
                <tr key={r.role}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-text">{r.role}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.caps.map((c) => (
                        <span key={c} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-text-2">{c}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="mb-2 font-semibold text-text">Scopes</h3>
        <p className="text-sm text-text-2">
          Record access is scoped: staff and drivers operate on <strong>OWN</strong> records; approvers and officers on <strong>ALL</strong>.
          Every delete is soft and every state change is written to the append-only <Link to="/audit-logs" className="text-primary hover:underline">audit log</Link>.
        </p>
      </Card>
    </div>
  )
}

function BackupTab() {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)

  const doExport = async () => {
    setExporting(true)
    try {
      const res = await api.get('/settings/export', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `uits-vmtl-export_${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Data snapshot exported')
    } catch (e) {
      toast.error(apiError(e, 'Export failed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5">
        <h2 className="mb-1 font-semibold text-text">Data export (JSON)</h2>
        <p className="mb-4 text-sm text-text-2">
          Export a snapshot of operational data — users, vehicles, drivers, requests, trips, maintenance and settings.
          Password hashes and secrets are <strong>redacted</strong>.
        </p>
        <Button icon={<Download className="h-4 w-4" />} loading={exporting} onClick={doExport}>
          Export snapshot
        </Button>
      </Card>
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-text-3" />
          <h2 className="font-semibold text-text">Audit trail</h2>
        </div>
        <p className="text-sm text-text-2">
          All administrative actions, approvals, assignments and trip events are recorded.
          Review them in the <Link to="/audit-logs" className="text-primary hover:underline">audit log</Link>.
        </p>
      </Card>
    </div>
  )
}
