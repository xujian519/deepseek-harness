import { describe, expect, it } from 'vitest'
import { createCrossrefConnector } from '../../../src/runtime/connectors/crossref.ts'

const SEARCH_RESPONSE = {
  message: {
    'total-results': 1,
    items: [
      {
        DOI: '10.48550/arXiv.1706.03762',
        title: ['Attention Is All You Need'],
        subtitle: ['Transformer'],
        abstract: '<jats:p>The dominant sequence transduction models are based on complex recurrent networks.</jats:p>',
        author: [{ given: 'Ashish', family: 'Vaswani' }, { name: 'Noam Shazeer' }],
        'container-title': ['Advances in Neural Information Processing Systems'],
        issued: { 'date-parts': [[2017]] },
        score: 12.5,
        URL: 'https://doi.org/10.48550/arXiv.1706.03762',
      },
    ],
  },
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('crossref connector', () => {
  it('strips JATS abstract and normalizes hits', async () => {
    const connector = createCrossrefConnector({ fetchImpl: async () => jsonResponse(SEARCH_RESPONSE) })
    const hits = await connector.search('attention is all you need')

    expect(hits.length).toBe(1)
    const hit = hits[0]!
    expect(hit.id).toBe('10.48550/arXiv.1706.03762')
    expect(hit.title).toBe('Attention Is All You Need: Transformer')
    expect(hit.summary).toBe('The dominant sequence transduction models are based on complex recurrent networks.')
    expect(hit.score).toBe(12.5)
    expect(hit.url).toBe('https://doi.org/10.48550/arXiv.1706.03762')
  })

  it('appends mailto and select projection', async () => {
    let url = ''
    const connector = createCrossrefConnector({
      fetchImpl: async (input: RequestInfo | URL) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return jsonResponse({ message: { items: [] } })
      },
    })

    await connector.search('transformer', { limit: 3 })
    expect(url.includes('rows=3')).toBe(true)
    expect(url.includes('mailto=sati@users.noreply.github.com')).toBe(true)
    expect(url.includes('select=DOI,title')).toBe(true)
  })
})
