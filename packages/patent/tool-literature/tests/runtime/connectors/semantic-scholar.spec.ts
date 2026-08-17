import { describe, expect, it } from 'vitest'
import { createSemanticScholarConnector } from '../../../src/runtime/connectors/semantic-scholar.ts'
import type { Connector } from '../../../src/protocol/types.ts'

/** Test injection: skip the keyless 1s per-host rate limit to keep the suite fast. */
function makeConnector(fetchImpl: typeof fetch, options: { apiKey?: string } = {}): Connector {
  return createSemanticScholarConnector({ ...options, fetchImpl, rateLimit: { minIntervalMs: 0 } })
}

const SEARCH_RESPONSE = {
  total: 1,
  data: [
    {
      paperId: '204e3073870fae3d05bcbc2f6a8e263d9b72e776',
      title: 'Attention Is All You Need',
      abstract: 'The dominant sequence transduction models are based on complex recurrent networks.',
      url: 'https://www.semanticscholar.org/paper/Attention-Is-All-You-Need-204e3073870fae3d05bcbc2f6a8e263d9b72e776',
      year: 2017,
      venue: 'NeurIPS',
      citationCount: 120000,
      externalIds: { ArXiv: '1706.03762' },
      authors: [{ name: 'Ashish Vaswani' }, { name: 'Noam Shazeer' }],
    },
  ],
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('semantic scholar connector', () => {
  it('normalizes hits with citation score', async () => {
    const connector = makeConnector(async () => jsonResponse(SEARCH_RESPONSE))
    const hits = await connector.search('attention is all you need')

    expect(hits.length).toBe(1)
    const hit = hits[0]!
    expect(hit.id).toBe('204e3073870fae3d05bcbc2f6a8e263d9b72e776')
    expect(hit.title).toBe('Attention Is All You Need')
    expect(hit.score).toBe(120000)
    expect(hit.summary).toBe('The dominant sequence transduction models are based on complex recurrent networks.')
  })

  it('sends no x-api-key header on keyless tier', async () => {
    let headers: Record<string, string> | undefined
    const connector = makeConnector(async (_input, init) => {
      headers = (init?.headers ?? {}) as Record<string, string>
      return jsonResponse({ data: [] })
    })

    await connector.search('attention')
    expect(headers?.['x-api-key']).toBeUndefined()
  })

  it('sends x-api-key header when key configured', async () => {
    let headers: Record<string, string> | undefined
    const connector = makeConnector(
      async (_input, init) => {
        headers = (init?.headers ?? {}) as Record<string, string>
        return jsonResponse({ data: [] })
      },
      { apiKey: 's2-test-key' },
    )

    await connector.search('transformer')
    expect(headers?.['x-api-key']).toBe('s2-test-key')
  })
})
