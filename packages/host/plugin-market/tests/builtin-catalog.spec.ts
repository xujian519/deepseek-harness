/**
 * Tests for the bundled catalog: the in-memory source list and the pure
 * `searchBuiltinCatalog` filter (free text, category, capability, page clamp)
 * that backs `ctx.pluginMarket` out of the box without a network source.
 */

import { describe, expect, it } from 'vitest'
import { BUILTIN_SOURCE, searchBuiltinCatalog } from '../src/builtin-catalog.ts'

describe('searchBuiltinCatalog', () => {
  it('returns every entry by default, stamping the bundled provenance', () => {
    const page = searchBuiltinCatalog()
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every(item => item.source === BUILTIN_SOURCE.providerId)).toBe(true)
  })

  it('filters by free text against name, description, and package', () => {
    const page = searchBuiltinCatalog({ q: 'bash' })
    expect(page.items[0]).toMatchObject({ package: '@deepseek-ai/dsh-tool-bash' })
  })

  it('returns no entries when the free text matches nothing', () => {
    expect(searchBuiltinCatalog({ q: 'definitely-not-a-plugin' }).items).toEqual([])
  })

  it('treats a blank free text as no filter', () => {
    const page = searchBuiltinCatalog({ q: '   ' })
    expect(page.items.length).toBeGreaterThan(0)
  })

  it('filters by exact category', () => {
    const page = searchBuiltinCatalog({ category: 'tool' })
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every(item => item.category === 'tool')).toBe(true)
  })

  it('treats a blank category as no filter', () => {
    const page = searchBuiltinCatalog({ category: '   ' })
    expect(page.items.length).toBeGreaterThan(0)
  })

  it('filters by capability', () => {
    const page = searchBuiltinCatalog({ capability: 'planning' })
    expect(page.items[0]).toMatchObject({ package: '@deepseek-ai/dsh-plan-mode' })
  })

  it('returns no entries for an unmatched capability', () => {
    expect(searchBuiltinCatalog({ capability: 'nonexistent' }).items).toEqual([])
  })

  it('clamps to the requested page size', () => {
    expect(searchBuiltinCatalog({ limit: 1 }).items).toHaveLength(1)
  })

  it('clamps a negative limit to an empty page instead of a bogus truncated slice', () => {
    // slice(0, -n) would return a wrong-length tail on a catalog larger than the
    // absolute value; clamp to 0 so a model-passed negative limit degrades to a
    // deterministic empty page rather than a silently wrong count.
    expect(searchBuiltinCatalog({ limit: -3 }).items).toEqual([])
  })
})
