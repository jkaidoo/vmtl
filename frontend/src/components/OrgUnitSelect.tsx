import { useMeta } from '../context/MetaContext'
import { Select } from './ui'

/**
 * Org-unit picker: an indented dropdown of the units the current user may assign
 * to (their subtree; everything for a super admin) — sourced from /meta.
 */
export function OrgUnitSelect({
  value,
  onChange,
  includeNone = true,
  noneLabel = '— None —',
}: {
  value: string
  onChange: (v: string) => void
  includeNone?: boolean
  noneLabel?: string
}) {
  const meta = useMeta()
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {includeNone && <option value="">{noneLabel}</option>}
      {meta?.org_units.map((u) => (
        <option key={u.id} value={u.id}>
          {'  '.repeat(u.depth) + u.name}
        </option>
      ))}
    </Select>
  )
}
