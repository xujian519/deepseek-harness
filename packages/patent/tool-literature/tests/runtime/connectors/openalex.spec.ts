import { describe, expect, it } from 'vitest'
import { createOpenAlexConnector } from '../../../src/runtime/connectors/openalex.ts'

const SEARCH_RESPONSE = {
  meta: { count: 1 },
  results: [
    {
      id: 'https://openalex.org/W2741809807',
      doi: 'https://doi.org/10.48550/arXiv.1706.03762',
      display_name: 'Attention Is All You Need',
      publication_year: 2017,
      cited_by_count: 120000,
      relevance_score: 0.95,
      abstract_inverted_index: { Attention: [0], Is: [1], All: [2], You: [3], Need: [4] },
      authorships: [{ author: { display_name: 'Ashish Vaswani' } }],
      primary_location: {
        source: { display_name: 'arXiv' },
        landing_page_url: 'https://arxiv.org/abs/1706.03762',
      },
    },
  ],
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('openalex connector', () => {
  it('rebuilds abstracts from inverted index and normalizes hits', async () => {
    const connector = createOpenAlexConnector({ fetchImpl: async () => jsonResponse(SEARCH_RESPONSE) })
    const hits = await connector.search('attention is all you need', { limit: 5 })

    expect(hits.length).toBe(1)
    const hit = hits[0]!
    expect(hit.id).toBe('W2741809807')
    expect(hit.title).toBe('Attention Is All You Need')
    expect(hit.summary).toBe('Attention Is All You Need')
    expect(hit.score).toBe(0.95)
    expect(hit.url).toBe('https://openalex.org/W2741809807')
  })

  it('adds mailto polite-pool param', async () => {
    let url = ''
    const connector = createOpenAlexConnector({
      mailto: 'researcher@example.com',
      fetchImpl: async (input: RequestInfo | URL) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return jsonResponse({ results: [] })
      },
    })

    await connector.search('transformer')
    expect(url.includes('mailto=researcher%40example.com')).toBe(true)
    expect(url.includes('per-page=10')).toBe(true)
  })

  it('falls back to OPENALEX_MAILTO env when option absent', async () => {
    const previous = process.env.OPENALEX_MAILTO
    process.env.OPENALEX_MAILTO = 'env@example.com'
    try {
      let url = ''
      const connector = createOpenAlexConnector({
        fetchImpl: async (input: RequestInfo | URL) => {
          url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          return jsonResponse({ results: [] })
        },
      })
      await connector.search('attention')
      expect(url.includes('mailto=env%40example.com')).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.OPENALEX_MAILTO
      else process.env.OPENALEX_MAILTO = previous
    }
  })

  it('fetch resolves a DOI as a raw path segment', async () => {
    let url = ''
    const connector = createOpenAlexConnector({
      fetchImpl: async (input: RequestInfo | URL) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return jsonResponse((SEARCH_RESPONSE as { results: unknown[] }).results[0])
      },
    })

    const record = await connector.fetch!('10.48550/arXiv.1706.03762')
    expect((record as { id?: string }).id?.includes('W2741809807')).toBe(true)
    expect(url.includes('/works/doi:10.48550/arXiv.1706.03762?')).toBe(true)
  })
})
