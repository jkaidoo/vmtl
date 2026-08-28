import { describe, expect, it } from 'vitest'
import { computeBuildHash } from './sw-build-hash'

const template = "const BUILD_HASH = '__BUILD_HASH__'\n"

describe('computeBuildHash', () => {
  it('produces a stable 12-char hex hash', () => {
    const hash = computeBuildHash(['assets/index-abc123.js', 'assets/index-def456.css'], template)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
  })

  it('is order-independent across file names', () => {
    const a = computeBuildHash(['a.js', 'b.js'], template)
    const b = computeBuildHash(['b.js', 'a.js'], template)
    expect(a).toBe(b)
  })

  it('changes when a bundled file name (content hash) changes', () => {
    const before = computeBuildHash(['assets/index-abc123.js'], template)
    const after = computeBuildHash(['assets/index-zzz999.js'], template)
    expect(before).not.toBe(after)
  })

  it('changes when the service-worker template changes', () => {
    const before = computeBuildHash(['a.js'], template)
    const after = computeBuildHash(['a.js'], template + '// extra line\n')
    expect(before).not.toBe(after)
  })

  it('is deterministic for identical inputs', () => {
    const names = ['assets/x-1.js', 'assets/y-2.css']
    expect(computeBuildHash(names, template)).toBe(computeBuildHash(names, template))
  })
})
