import { describe, expect, it, beforeEach } from 'vitest'
import { createOpenAlexConnector } from '../../../src/runtime/connectors/openalex.ts'
import { clearCache } from '../../../src/runtime/http.ts'

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
  // The shared http layer caches GET responses per URL; clear between tests.
  beforeEach(() => {
    clearCache()
  })

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

  it('normalizes sparse works defensively', async () => {
    const connector = createOpenAlexConnector({
      fetchImpl: async () => jsonResponse({
        results: [
          { id: 'https://openalex.org/W1', display_name: 'T' },
          { doi: 'https://doi.org/10.1/x' },
          { primary_location: { landing_page_url: 'https://landing.test/w3' } },
          {},
        ],
      }),
    })
    const hits = await connector.search('edge')
    const [w1, w2, w3, w4] = hits
    expect(w1!.id).toBe('W1')
    expect(w1!.title).toBe('T')
    expect(w1!.summary).toBeUndefined()
    expect(w1!.url).toBe('https://openalex.org/W1')
    expect(w2!.id).toBe('https://doi.org/10.1/x')
    expect(w2!.title).toBe('Untitled')
    expect(w2!.url).toBe('https://doi.org/10.1/x')
    expect(w2!.score).toBeUndefined()
    expect(w3!.id).toBe('')
    expect(w3!.url).toBe('https://landing.test/w3')
    expect(w4!.id).toBe('')
    expect(w4!.title).toBe('Untitled')
    expect(w4!.url).toBeUndefined()
  })

  it('returns [] when results are absent', async () => {
    const connector = createOpenAlexConnector({ fetchImpl: async () => jsonResponse({}) })
    await expect(connector.search('none')).resolves.toEqual([])
  })

  it('fetch resolves bare work ids, empty ids, and null records', async () => {
    let url = ''
    let calls = 0
    const connector = createOpenAlexConnector({
      fetchImpl: async (input: RequestInfo | URL) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls += 1
        return jsonResponse(calls === 1 ? { id: 'https://openalex.org/W2741809807' } : null)
      },
    })

    const work = await connector.fetch!('W2741809807')
    expect((work as { id: string }).id).toBe('https://openalex.org/W2741809807')
    expect(url.includes('/works/W2741809807?mailto=')).toBe(true)

    await connector.fetch!('')
    expect(url.includes('/works/?mailto=')).toBe(true)

    await expect(connector.fetch!('W999999')).resolves.toBeNull()
  })

  it('exposes the best-oa pdf link in extra.pdf_url', async () => {
    const connector = createOpenAlexConnector({
      fetchImpl: async () => jsonResponse({
        results: [{ id: 'https://openalex.org/W1', display_name: 'T', best_oa_location: { pdf_url: 'https://pdf.example/a.pdf' } }],
      }),
    })
    const [hit] = await connector.search('t', { limit: 5 })
    expect((hit?.extra as { pdf_url?: string }).pdf_url).toBe('https://pdf.example/a.pdf')
  })

  it('falls back to open_access.oa_url when the best-oa pdf is absent', async () => {
    const connector = createOpenAlexConnector({
      fetchImpl: async () => jsonResponse({
        results: [{ id: 'https://openalex.org/W1', display_name: 'T', open_access: { oa_url: 'https://pdf.example/b.pdf' } }],
      }),
    })
    const [hit] = await connector.search('t', { limit: 5 })
    expect((hit?.extra as { pdf_url?: string }).pdf_url).toBe('https://pdf.example/b.pdf')
  })

  it('omits pdf_url when no open-access link exists', async () => {
    const connector = createOpenAlexConnector({
      fetchImpl: async () => jsonResponse({ results: [{ id: 'https://openalex.org/W1', display_name: 'T' }] }),
    })
    const [hit] = await connector.search('t', { limit: 5 })
    expect((hit?.extra as { pdf_url?: string }).pdf_url).toBeUndefined()
  })
})
