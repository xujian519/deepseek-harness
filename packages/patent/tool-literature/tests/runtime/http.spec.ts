import { describe, expect, it } from 'vitest'
import { LiteratureHttpClient, type LiteratureFetchOptions } from '../../src/runtime/http.ts'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('LiteratureHttpClient.request', () => {
  it('caches healthy GET responses', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({ ok: 1 })
    }
    const url = 'https://cache.test/works?search=hello'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    const first = await client.request(url, opts)
    const second = await client.request(url, opts)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(calls).toBe(1) // second call hits cache
    expect((JSON.parse(second.body) as { ok: number }).ok).toBe(1)
  })

  it('never caches empty bodies', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('', { status: 200 })
    }
    const url = 'https://empty.test/feed'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    await client.request(url, opts)
    await client.request(url, opts)
    expect(calls).toBe(2)
  })

  it('never caches bodies rejected by looksValid', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('<html>error page</html>', { status: 200 })
    }
    const url = 'https://valid.test/feed'
    const opts: LiteratureFetchOptions = { fetchImpl, looksValid: b => b.startsWith('<feed'), retry: { maxRetries: 0 } }
    await client.request(url, opts)
    await client.request(url, opts)
    expect(calls).toBe(2)
  })

  it('never caches non-ok responses', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('rate limited', { status: 429 })
    }
    const url = 'https://err.test/api'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    const res = await client.request(url, opts)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(429)
    await client.request(url, opts)
    expect(calls).toBe(2)
  })

  it('spaces request starts per host by minIntervalMs', async () => {
    const client = new LiteratureHttpClient()
    const starts: number[] = []
    const fetchImpl: typeof fetch = async () => {
      starts.push(Date.now())
      return jsonResponse({})
    }
    const opts = { fetchImpl, rateLimit: { minIntervalMs: 40 }, retry: { maxRetries: 0 } as const }
    const controller = new AbortController()
    await client.request('https://pace.test/api?q=1', opts)
    await client.request('https://pace.test/api?q=2', opts)
    await client.request('https://pace.test/api?q=3', { ...opts, signal: controller.signal })
    expect(starts.length).toBe(3)
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(30)
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(30)
  })

  it('caps in-flight requests per host with maxConcurrent', async () => {
    const client = new LiteratureHttpClient()
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
      client.request('https://conc.test/a', opts),
      client.request('https://conc.test/b', opts),
      client.request('https://conc.test/c', opts),
    ])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('releases the concurrency slot when the host has never queued', async () => {
    const client = new LiteratureHttpClient()
    const opts = { fetchImpl: async () => jsonResponse({}), rateLimit: { maxConcurrent: 2 }, retry: { maxRetries: 0 } as const }
    await expect(client.request('https://conc-solo.test/a', opts)).resolves.toMatchObject({ ok: true })
    // The released slot is available again: this request acquires it directly.
    await expect(client.request('https://conc-solo.test/b', opts)).resolves.toMatchObject({ ok: true })
  })

  it('tolerates malformed URLs (no per-host limiter slot)', async () => {
    const client = new LiteratureHttpClient()
    const fetchImpl: typeof fetch = async () => jsonResponse({ ok: 1 })
    const res = await client.request(':::not-a-url:::', { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(res.ok).toBe(true)
  })

  it('removes a queued request when its signal aborts', async () => {
    const client = new LiteratureHttpClient()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fetchImpl: typeof fetch = async () => {
      await gate
      return jsonResponse({})
    }
    const opts = { fetchImpl, rateLimit: { maxConcurrent: 1 }, retry: { maxRetries: 0 } as const }
    const first = client.request('https://abort.test/first', opts)
    const aborted = new AbortController()
    const queued = client.request('https://abort.test/second', { ...opts, signal: aborted.signal })
    aborted.abort(new Error('stop queued'))
    await expect(queued).rejects.toThrow('stop queued')

    // A request still holding a live signal receives the slot the aborted one left.
    const thirdController = new AbortController()
    const third = client.request('https://abort.test/third', { ...opts, signal: thirdController.signal })
    release()
    await expect(Promise.all([first, third])).resolves.toHaveLength(2)
  })

  it('frees the slot when the last queued request aborts before handover', async () => {
    const client = new LiteratureHttpClient()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fetchImpl: typeof fetch = async () => {
      await gate
      return jsonResponse({})
    }
    const opts = { fetchImpl, rateLimit: { maxConcurrent: 1 }, retry: { maxRetries: 0 } as const }
    const first = client.request('https://abort-empty.test/first', opts)
    const controller = new AbortController()
    const queued = client.request('https://abort-empty.test/second', { ...opts, signal: controller.signal })
    controller.abort(new Error('stop queued'))
    await expect(queued).rejects.toThrow('stop queued')
    release()
    await first
    // The aborted waiter consumed no slot: the next request starts immediately.
    const later = await client.request('https://abort-empty.test/later', opts)
    expect(later.ok).toBe(true)
  })

  it('rejects a request aborted while waiting for the pacing interval', async () => {
    const client = new LiteratureHttpClient()
    const fetchImpl: typeof fetch = async () => jsonResponse({})
    const opts = { fetchImpl, rateLimit: { minIntervalMs: 60 }, retry: { maxRetries: 0 } as const }
    await client.request('https://pace-abort.test/a', opts)
    const controller = new AbortController()
    const pending = client.request('https://pace-abort.test/b', { ...opts, signal: controller.signal })
    controller.abort(new Error('stop pacing'))
    await expect(pending).rejects.toThrow('stop pacing')
  })

  it('normalizes a non-Error abort reason to an Error', async () => {
    const client = new LiteratureHttpClient()
    const fetchImpl: typeof fetch = async () => jsonResponse({})
    const opts = { fetchImpl, rateLimit: { minIntervalMs: 60 }, retry: { maxRetries: 0 } as const }
    await client.request('https://pace-string.test/a', opts)
    const controller = new AbortController()
    const pending = client.request('https://pace-string.test/b', { ...opts, signal: controller.signal })
    controller.abort('stop pacing')
    await expect(pending).rejects.toThrow('request aborted')
  })

  it('refuses an already-aborted signal before the network request', async () => {
    const client = new LiteratureHttpClient()
    const controller = new AbortController()
    controller.abort(new Error('already stopped'))
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({})
    }
    await expect(
      client.request('https://pre-abort.test/a', {
        fetchImpl,
        rateLimit: { minIntervalMs: 10 },
        retry: { maxRetries: 0 } as const,
        signal: controller.signal,
      }),
    ).rejects.toThrow('already stopped')
    expect(calls).toBe(0)
  })

  it('disables the GET cache with cacheTtlMs 0', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({})
    }
    const url = 'https://no-cache.test/api'
    const opts = { fetchImpl, cacheTtlMs: 0, retry: { maxRetries: 0 } as const }
    await client.request(url, opts)
    await client.request(url, opts)
    expect(calls).toBe(2)
  })

  it('refetches when the cached entry has expired', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({})
    }
    const url = 'https://expire.test/api'
    const opts = { fetchImpl, cacheTtlMs: 1, retry: { maxRetries: 0 } as const }
    await client.request(url, opts)
    await new Promise(r => setTimeout(r, 10))
    await client.request(url, opts)
    expect(calls).toBe(2)
  })

  it('evicts the oldest entry once the cache exceeds its entry cap', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({})
    }
    const url = (i: number) => `https://lru.test/works?i=${i}`
    for (let i = 0; i < 501; i += 1) {
      await client.request(url(i), { fetchImpl, retry: { maxRetries: 0 } as const })
    }
    expect(calls).toBe(501)
    // The oldest entry was evicted: refetching it hits the network again.
    await client.request(url(0), { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(calls).toBe(502)
    // The newest entry is still cached.
    await client.request(url(500), { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(calls).toBe(502)
  })

  it('keeps state isolated between clients', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return jsonResponse({})
    }
    const url = 'https://isolated.test/api'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    await new LiteratureHttpClient().request(url, opts)
    await new LiteratureHttpClient().request(url, opts)
    expect(calls).toBe(2)
  })
})

describe('getJSON / getText', () => {
  it('getJSON parses JSON and throws LiteratureHttpError on non-2xx', async () => {
    const client = new LiteratureHttpClient()
    const ok = await client.getJSON<{ a: number }>('https://json.test/ok', {
      fetchImpl: async () => jsonResponse({ a: 1 }),
      retry: { maxRetries: 0 } as const,
    })
    expect(ok).toEqual({ a: 1 })

    await expect(client.getJSON('https://json.test/err', {
      fetchImpl: async () => new Response('boom', { status: 500 }),
      retry: { maxRetries: 0 } as const,
    })).rejects.toMatchObject({ name: 'LiteratureHttpError', status: 500 })
  })

  it('getText returns body with */* accept by default', async () => {
    const client = new LiteratureHttpClient()
    let accept: string | null = null
    const fetchImpl: typeof fetch = async (_url, init) => {
      accept = (init?.headers as Record<string, string>)['Accept'] ?? null
      return new Response('<feed/>', { status: 200 })
    }
    const body = await client.getText('https://text.test/feed', { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(body).toBe('<feed/>')
    expect(accept).toBe('*/*')
  })

  it('getJSON sets application/json accept', async () => {
    const client = new LiteratureHttpClient()
    let accept: string | null = null
    const fetchImpl: typeof fetch = async (_url, init) => {
      accept = (init?.headers as Record<string, string>)['Accept'] ?? null
      return jsonResponse({})
    }
    await client.getJSON('https://accept.test/api', { fetchImpl, retry: { maxRetries: 0 } as const })
    expect(accept).toBe('application/json')
  })

  it('getJSON wraps non-JSON bodies with a descriptive error', async () => {
    const client = new LiteratureHttpClient()
    const fetchImpl: typeof fetch = async () => new Response('<html>oops</html>', { status: 200 })
    await expect(client.getJSON('https://json.test/html', { fetchImpl, retry: { maxRetries: 0 } as const }))
      .rejects.toThrow(/Non-JSON response from/)
  })

  it('does not cache a non-JSON 200 response', async () => {
    const client = new LiteratureHttpClient()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('<html>maintenance</html>', { status: 200 })
    }
    const url = 'https://json.test/html-cache'
    const opts = { fetchImpl, retry: { maxRetries: 0 } as const }
    await expect(client.getJSON(url, opts)).rejects.toThrow(/Non-JSON response from/)
    await expect(client.getJSON(url, opts)).rejects.toThrow(/Non-JSON response from/)
    expect(calls).toBe(2)
  })
})
