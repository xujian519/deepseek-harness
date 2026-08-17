// Real-service test: mounts the patent-data plugin on a real Context (over the
// real subprocess provider) and drives the search provider/cache with an
// injected search function; only the external search seam is mocked.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PatentData, { cachedSearchPatents, EgoBrowserSession } from '@deepseek-ai/dsh-patent-data'
import type { PatentSearchResult } from '@deepseek-ai/nuo-patent'

function makeSearchResult(): PatentSearchResult {
  return {
    query: 'thermal',
    total: 1,
    hits: [
      {
        patent: 'US11452699B2',
        title: 'Thermal management system',
        assignee: 'Apple Inc.',
        publication_date: '2022-09-27',
        priority_date: '2019-12-31',
        abstract: 'A thermal management system.',
        url: 'https://patents.google.com/patent/US11452699B2',
      },
    ],
    warnings: [],
  }
}

describe('PatentData service', () => {
  it('serves a search provider that caches repeated queries', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData)
    try {
      expect(ctx.patentData).toBeInstanceOf(PatentData)

      const underlying = vi.fn(async () => makeSearchResult())
      const provider = ctx.patentData.createSearchProvider({ search: cachedSearchPatents(underlying) })
      const first = await provider.search!('thermal')
      const second = await provider.search!('thermal')

      expect(underlying).toHaveBeenCalledTimes(1)
      expect(first).toEqual(second)
      expect(first[0]).toEqual({
        title: 'Thermal management system',
        snippet: 'A thermal management system.',
        url: 'https://patents.google.com/patent/US11452699B2',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('builds an ego-browser session over the injected subprocess service', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData)
    try {
      const session = ctx.patentData.createEgoSession({ platform: 'darwin' })
      expect(session).toBeInstanceOf(EgoBrowserSession)
      expect(session.taskSpaceName('patent-download', 'abc')).toBe('sati-patent-download-abc')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes ctx.patentData when its fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const fiber = ctx.plugin(PatentData)
    await fiber
    expect(ctx.patentData).toBeInstanceOf(PatentData)
    await fiber.dispose()
    expect(ctx.get('patentData')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
