import { describe, expect, it } from 'vitest'
import type { OrgUnit } from './types'
import { ancestorIds, buildForest, canDrop, isSelfOrDescendant, visibleForQuery } from './orgtree'

/** Minimal unit factory. path mirrors the backend's materialised "/1/10/771/". */
function u(id: number, parent_id: number | null, path: string, name = `u${id}`): OrgUnit {
  return { id, name, code: null, type: 'unit', type_label: 'Unit', parent_id, path, depth: 0 }
}

const units: OrgUnit[] = [
  u(1, null, '/1/', 'KNUST'),
  u(10, 1, '/1/10/', 'College of Science'),
  u(100, 1, '/1/100/', 'College of Engineering'),
  u(11, 10, '/1/10/11/', 'Faculty of Biosciences'),
  u(771, 11, '/1/10/11/771/', 'Computer Science'),
]

describe('buildForest', () => {
  it('nests children under parents and returns the root', () => {
    const forest = buildForest(units)
    expect(forest).toHaveLength(1)
    expect(forest[0].name).toBe('KNUST')
    const cos = forest[0].children.find((c) => c.id === 10)!
    expect(cos.children.map((c) => c.id)).toEqual([11])
    expect(cos.children[0].children.map((c) => c.id)).toEqual([771])
  })

  it('treats a node whose parent is absent as a root', () => {
    const orphan = [u(5, 999, '/999/5/')]
    expect(buildForest(orphan).map((n) => n.id)).toEqual([5])
  })

  it('orders KNUST children: colleges first, then everything else alphabetically', () => {
    const t = (id: number, name: string, type: string): OrgUnit => ({ ...u(id, 1, `/1/${id}/`, name), type, type_label: type })
    const list: OrgUnit[] = [
      u(1, null, '/1/', 'KNUST'),
      t(2, 'University Information Technology Services', 'directorate'),
      t(3, 'College of Science', 'college'),
      t(4, 'Africa Hall', 'unit'),
      t(5, 'College of Engineering', 'college'),
      t(6, 'Main Administration', 'directorate'),
    ]
    expect(buildForest(list)[0].children.map((c) => c.name)).toEqual([
      'College of Engineering',
      'College of Science',
      'Africa Hall',
      'Main Administration',
      'University Information Technology Services',
    ])
  })
})

describe('ancestorIds', () => {
  it('parses ancestors and excludes self', () => {
    expect(ancestorIds('/1/10/11/771/', 771)).toEqual([1, 10, 11])
  })
  it('returns [] for a root or missing path', () => {
    expect(ancestorIds('/1/', 1)).toEqual([])
    expect(ancestorIds(null, 1)).toEqual([])
  })
})

describe('isSelfOrDescendant', () => {
  const cos = units[1] // /1/10/
  it('is true for self and descendants', () => {
    expect(isSelfOrDescendant(cos, cos)).toBe(true)
    expect(isSelfOrDescendant(units[4], cos)).toBe(true) // 771 under /1/10/
  })
  it('does not confuse sibling ids that share a numeric prefix (10 vs 100)', () => {
    const coe = units[2] // /1/100/
    expect(isSelfOrDescendant(coe, cos)).toBe(false)
  })
})

describe('canDrop', () => {
  const knust = units[0]
  const cos = units[1]
  const faculty = units[3]
  const cs = units[4]

  it('rejects dropping onto itself', () => {
    expect(canDrop(cos, cos)).toBe(false)
  })
  it('rejects dropping onto its current parent (no-op)', () => {
    expect(canDrop(cos, knust)).toBe(false)
  })
  it('rejects dropping onto a descendant', () => {
    expect(canDrop(cos, cs)).toBe(false)
  })
  it('allows a legal move to another branch', () => {
    expect(canDrop(faculty, units[2])).toBe(true) // faculty -> College of Engineering
    expect(canDrop(cs, knust)).toBe(true)
  })
})

describe('visibleForQuery', () => {
  it('returns all ids for an empty query', () => {
    expect(visibleForQuery(units, '').size).toBe(units.length)
  })

  it('reveals a match plus its ancestors and descendants', () => {
    // Match the faculty: expect it, its ancestors (KNUST, CoS) and descendant (CS).
    const vis = visibleForQuery(units, 'biosciences')
    expect([...vis].sort((a, b) => a - b)).toEqual([1, 10, 11, 771])
    expect(vis.has(100)).toBe(false) // unrelated branch hidden
  })

  it('matches on code as well as name', () => {
    const withCode = [...units, { ...u(9, 1, '/1/9/'), code: 'XYZ' }]
    expect(visibleForQuery(withCode, 'xyz').has(9)).toBe(true)
  })
})
