import type { OrgUnit } from './types'

/** A unit with its children resolved — the shape the tree view renders. */
export interface OrgNode extends OrgUnit {
  children: OrgNode[]
}

/**
 * Sibling order within any level: colleges first (they only exist directly under
 * KNUST), then everything else — each group alphabetical by name. Deeper levels
 * therefore fall back to plain alphabetical order.
 */
export function compareSiblings(a: OrgUnit, b: OrgUnit): number {
  const rank = (t: string) => (t === 'college' ? 0 : 1)
  const byRank = rank(a.type) - rank(b.type)
  if (byRank !== 0) return byRank
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/** Build a nested forest from the flat unit list, ordered by {@link compareSiblings}. */
export function buildForest(units: OrgUnit[]): OrgNode[] {
  const byId = new Map<number, OrgNode>()
  units.forEach((u) => byId.set(u.id, { ...u, children: [] }))

  const roots: OrgNode[] = []
  byId.forEach((node) => {
    const parent = node.parent_id != null ? byId.get(node.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })

  const sortRec = (nodes: OrgNode[]) => {
    nodes.sort(compareSiblings)
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)

  return roots
}

/** Ancestor ids parsed from a materialised path like "/1/10/771/" (excludes self). */
export function ancestorIds(path: string | null | undefined, selfId: number): number[] {
  if (!path) return []
  return path
    .split('/')
    .filter(Boolean)
    .map(Number)
    .filter((id) => id !== selfId && !Number.isNaN(id))
}

/**
 * True when `target` is the dragged node itself or one of its descendants —
 * i.e. an illegal drop that would make a unit its own ancestor. Uses the
 * materialised path (trailing slashes make "/1/10/" not match "/1/100/").
 */
export function isSelfOrDescendant(target: OrgUnit, dragged: OrgUnit): boolean {
  if (target.id === dragged.id) return true
  if (!target.path || !dragged.path) return false
  return target.path.startsWith(dragged.path)
}

/** Whether `dragged` may be re-parented under `target`. */
export function canDrop(dragged: OrgUnit, target: OrgUnit): boolean {
  if (dragged.id === target.id) return false
  if (dragged.parent_id === target.id) return false // already there
  return !isSelfOrDescendant(target, dragged)
}

/**
 * For a search query, the set of unit ids to show: every match, plus its
 * ancestors (so the path to it stays visible) and its descendants (so the
 * matched subtree is browsable). Empty query ⇒ everything visible.
 */
export function visibleForQuery(units: OrgUnit[], query: string): Set<number> {
  const q = query.trim().toLowerCase()
  const visible = new Set<number>()
  if (!q) {
    units.forEach((u) => visible.add(u.id))
    return visible
  }

  const matches = new Set<number>()
  for (const u of units) {
    const hay = `${u.name} ${u.code ?? ''}`.toLowerCase()
    if (hay.includes(q)) matches.add(u.id)
  }

  for (const u of units) {
    if (matches.has(u.id)) {
      visible.add(u.id)
      for (const a of ancestorIds(u.path, u.id)) visible.add(a) // reveal the path
      continue
    }
    // A descendant of a match: keep it so the matched subtree is browsable.
    if (ancestorIds(u.path, u.id).some((a) => matches.has(a))) visible.add(u.id)
  }
  return visible
}
