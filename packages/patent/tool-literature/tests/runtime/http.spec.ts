import { describe, expect, it } from 'vitest'
import {
  clearCache,
  getJSON,
  getText,
  literatureFetch,
  resetRateLimits,
  type LiteratureFetchOptions,
} from '../../src/runtime/http.ts'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('literatureFetch', () => {
  it('caches healthy GET responses', async () => {
    clearCache()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({ ok: 1 })
    }
    const url = 'https://cache.test/works?search=hello'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    const first = await literatureFetch(url, opts)
    const second = await literatureFetch(url, opts)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls).toBe(1) // second call hits cache
    expect(JSON.parse(second.body).ok).toBe(1)
  })

  it('never caches empty bodies', async () => {
    clearCache()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('', { status: 200 })
    }
    const url = 'https://empty.test/feed'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    await literatureFetch(url, opts)
    await literatureFetch(url, opts)
    expect(calls).toBe(2)
  })

  it('never caches bodies rejected by looksValid', async () => {
    clearCache()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('<html>error page</html>', { status: 200 })
    }
    const url = 'https://valid.test/feed'
    const opts: LiteratureFetchOptions = { fetchImpl, looksValid: b => b.startsWith('<feed'), retry: { maxRetries: 0 } }
    await literatureFetch(url, opts)
    await literatureFetch(url, opts)
    expect(calls).toBe(2)
  })

  it('never caches non-ok responses', async () => {
    clearCache()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('rate limited', { status: 429 })
    }
    const url = 'https://err.test/api'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    const res = await literatureFetch(url, opts)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(429)
    await literatureFetch(url, opts)
    expect(calls).toBe(2)
  })

  it('spaces request starts per host by minIntervalMs', async () => {
    resetRateLimits()
    const starts: number[] = []
    const fetchImpl: typeof fetch = async () => {
      starts.push(Date.now())
      return jsonResponse({})
    }
    const url = 'https://pace.test/api?q=1'
    const url2 = 'https://pace.test/api?q=2'
    const opts = { fetchImpl, rateLimit: { minIntervalMs: 40 }, retry: { maxRetries: 0 } as const }
    await literatureFetch(url, opts)
    await literatureFetch(url2, opts)
    expect(starts.length).toBe(2)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(30)
  })

  it('caps in-flight requests per host with maxConcurrent', async () => {
    resetRateLimits()
    let inFlight = 0
    let peak = 0
    const fetchImpl: typeof fetch = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 20))
      inFlight -= 1
      return jsonResponse({})
    }
    const opts = { fetchImpl, rateLimit: { maxConcurrent: 2 }, retry: { maxRetries: 0 } as const }
    await Promise.all([
      literatureFetch('https://conc.test/a', opts),
      literatureFetch('https://conc.test/b', opts),
      literatureFetch('https://conc.test/c', opts),
    ])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('getJSON / getText', () => {
  it('getJSON parses JSON and throws LiteratureHttpError on non-2xx', async () => {
    const ok = await getJSON<{ a: number }>('https://json.test/ok', {
      fetchImpl: async () => jsonResponse({ a: 1 }),
      retry: { maxRetries: 0 } as const,
    })
    expect(ok).toEqual({ a: 1 })

    await expect(getJSON('https://json.test/err', {
      fetchImpl: async () => new Response('boom', { status: 500 }),
      retry: { maxRetries: 0 } as const,
    })).rejects.toMatchObject({ name: 'LiteratureHttpError', status: 500 })
  })

  it('getText returns body with */* accept by default', async () => {
    let accept: string | null = null
    const fetchImpl: typeof fetch = async (_url, init) => {
      accept = (init?.headers as Record<string, string>)['Accept'] ?? null
      return new Response('<feed/>', { status: 200 })
    }
    const body = await getText('https://text.test/feed', { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(body).toBe('<feed/>')
    expect(accept).toBe('*/*')
  })

  it('getJSON sets application/json accept', async () => {
    let accept: string | null = null
    const fetchImpl: typeof fetch = async (_url, init) => {
      accept = (init?.headers as Record<string, string>)['Accept'] ?? null
      return jsonResponse({})
    }
    await getJSON('https://accept.test/api', { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(accept).toBe('application/json')
  })
})
