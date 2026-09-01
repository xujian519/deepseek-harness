import { describe, expect, it } from 'vitest'
import {
  NetworkFetchError,
  isRetryableNetworkCode,
  networkFetch,
  normalizeNetworkError,
} from '../../src/network-fetch.ts'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** fetchImpl that rejects with the abort reason when its signal fires, like real fetch. */
function abortingFetch(): typeof fetch {
  return (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(init.signal?.reason as Error)
    })
  })
}

describe('networkFetch', () => {
  it('returns the response for a plain GET without retry or timeout options', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ ok: 1 })
    const res = await networkFetch('https://plain.test/a', {}, { fetchImpl })
    expect(res.ok).toBe(true)
    expect(JSON.parse(await res.text()) as { ok: number }).toEqual({ ok: 1 })
  })

  it('uses init.signal as the parent signal when options.signal is absent', async () => {
    const controller = new AbortController()
    const fetchImpl: typeof fetch = async () => jsonResponse({})
    const res = await networkFetch('https://init-signal.test/a', { signal: controller.signal }, { fetchImpl })
    expect(res.ok).toBe(true)
  })

  it('throws without retrying a POST unless retryOnPost is set', async () => {
    const noRetryPost: typeof fetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(networkFetch('https://post.test/a', { method: 'POST' }, { fetchImpl: noRetryPost }))
      .rejects.toMatchObject({ code: 'network_connection_refused' })

    let calls = 0
    const retryablePost: typeof fetch = async () => {
      calls += 1
      if (calls === 1) throw new Error('ECONNREFUSED')
      return jsonResponse({})
    }
    const res = await networkFetch('https://post.test/b', { method: 'POST' }, {
      retry: { retryOnPost: true, maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 },
      fetchImpl: retryablePost,
    })
    expect(res.ok).toBe(true)
  })

  it('times out and aborts the in-flight request', async () => {
    await expect(networkFetch('https://timeout.test/a', {}, {
      timeoutMs: 30,
      fetchImpl: abortingFetch(),
    })).rejects.toMatchObject({ name: 'NetworkFetchError', code: 'network_timeout' })
  })

  it('retries retryable network errors with backoff then succeeds', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls <= 2) throw new Error('ECONNRESET: socket hang up')
      return jsonResponse({ ok: 1 })
    }
    const res = await networkFetch('https://retry.test/a', {}, {
      retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 },
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    expect(calls).toBe(3)
  })

  it('throws immediately on non-retryable TLS errors', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('certificate verify failed')
    }
    await expect(networkFetch('https://tls.test/a', {}, {
      retry: { maxRetries: 2, baseDelayMs: 1 },
      fetchImpl,
    })).rejects.toMatchObject({ code: 'network_tls_error' })
  })

  it('throws the normalized error once retries are exhausted', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(networkFetch('https://exhaust.test/a', {}, {
      retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 10 },
      fetchImpl,
    })).rejects.toMatchObject({ code: 'network_connection_refused' })
  })

  it('retries retryable statuses and respects the retry-after header', async () => {
    // The first response body's cancel() rejects; the retry path must swallow that failure.
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('x')) },
      cancel() { throw new Error('cancel failed') },
    })
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return new Response(stream, { status: 418, headers: { 'retry-after': '30' } })
      return jsonResponse({ ok: 1 })
    }
    const controller = new AbortController()
    const res = await networkFetch('https://status-retry.test/a', {}, {
      retry: { maxRetries: 1, maxDelayMs: 10, retryStatuses: [418] },
      fetchImpl,
      signal: controller.signal,
    })
    expect(res.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('retries default retryable statuses without a retry-after header', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 429 })
      return jsonResponse({})
    }
    const res = await networkFetch('https://status-default.test/a', {}, {
      retry: { maxRetries: 1, maxDelayMs: 5 },
      fetchImpl,
    })
    expect(res.ok).toBe(true)
  })

  it('cancels a retry wait immediately when retry-after is zero', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 503, headers: { 'retry-after': '0' } })
      return jsonResponse({})
    }
    const res = await networkFetch('https://retry-zero.test/a', {}, {
      retry: { maxRetries: 1 },
      fetchImpl,
    })
    expect(res.ok).toBe(true)
  })

  it('falls back to exponential backoff for unparseable retry-after values', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': 'later' } })
      return jsonResponse({})
    }
    const res = await networkFetch('https://retry-garbage.test/a', {}, {
      retry: { maxRetries: 1, maxDelayMs: 5 },
      fetchImpl,
    })
    expect(res.ok).toBe(true)
  })

  it('parses a future HTTP-date retry-after into a bounded delay', async () => {
    const future = new Date(Date.now() + 5000).toUTCString()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': future } })
      return jsonResponse({})
    }
    const res = await networkFetch('https://retry-date.test/a', {}, {
      retry: { maxRetries: 1, maxDelayMs: 5 },
      fetchImpl,
    })
    expect(res.ok).toBe(true)
  })

  it('ignores a past HTTP-date retry-after', async () => {
    const past = new Date(Date.now() - 5000).toUTCString()
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': past } })
      return jsonResponse({})
    }
    const res = await networkFetch('https://retry-past.test/a', {}, {
      retry: { maxRetries: 1, maxDelayMs: 5 },
      fetchImpl,
    })
    expect(res.ok).toBe(true)
  })

  it('aborts a pending retry delay when the parent signal fires', async () => {
    const controller = new AbortController()
    const fetchImpl: typeof fetch = async () => {
      setTimeout(() => { controller.abort() }, 15)
      throw new Error('ECONNREFUSED')
    }
    await expect(networkFetch('https://retry-abort.test/a', {}, {
      retry: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 1000 },
      fetchImpl,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'NetworkFetchError', code: 'network_abort' })
  })

  it('rejects immediately when the parent signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl: typeof fetch = async () => {
      throw new NetworkFetchError('network_timeout', 'timed out')
    }
    await expect(networkFetch('https://retry-preabort.test/a', {}, {
      retry: { maxRetries: 1 },
      fetchImpl,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'network_abort' })
  })

  it('throws network_fetch_failed without fetching when maxRetries is NaN', async () => {
    let called = false
    const fetchImpl: typeof fetch = async () => {
      called = true
      return jsonResponse({})
    }
    await expect(networkFetch('https://nan.test/a', {}, {
      retry: { maxRetries: Number.NaN },
      fetchImpl,
    })).rejects.toMatchObject({ name: 'NetworkFetchError', code: 'network_fetch_failed' })
    expect(called).toBe(false)
  })
})

describe('normalizeNetworkError', () => {
  it('passes through an existing NetworkFetchError', () => {
    const original = new NetworkFetchError('network_timeout', 'timed out')
    expect(normalizeNetworkError(original)).toBe(original)
  })

  it('classifies aborted parent signals before any system error codes', () => {
    const parent = new AbortController()
    parent.abort(new NetworkFetchError('network_abort', 'caller cancelled'))
    expect(normalizeNetworkError(new Error('ENOTFOUND'), undefined, parent.signal)).toBe(parent.signal.reason)

    const plain = new AbortController()
    plain.abort('caller stopped')
    const err = normalizeNetworkError(new Error('anything'), undefined, plain.signal)
    expect(err.code).toBe('network_abort')
    expect(err.cause).toBe('caller stopped')
  })

  it('classifies aborted local signals as timeouts', () => {
    const local = new AbortController()
    local.abort(new NetworkFetchError('network_timeout', 'timed out'))
    expect(normalizeNetworkError(new Error('x'), local.signal)).toBe(local.signal.reason)

    const plain = new AbortController()
    plain.abort('server stalled')
    const err = normalizeNetworkError(new Error('x'), plain.signal)
    expect(err.code).toBe('network_timeout')
    expect(err.cause).toBe('server stalled')
  })

  it('maps Node system error codes from error.code', () => {
    const enotfound = Object.assign(new Error('lookup'), { code: 'ENOTFOUND' })
    expect(normalizeNetworkError(enotfound).code).toBe('network_dns_error')
    const econnrefused = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
    expect(normalizeNetworkError(econnrefused).code).toBe('network_connection_refused')
    const etimedout = Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' })
    expect(normalizeNetworkError(etimedout).code).toBe('network_timeout')
  })

  it('maps error messages to network error codes', () => {
    expect(normalizeNetworkError(new Error('getaddrinfo EAI_AGAIN host')).code).toBe('network_dns_error')
    expect(normalizeNetworkError(new Error('DNS lookup failed')).code).toBe('network_dns_error')
    expect(normalizeNetworkError(new Error('socket hang up')).code).toBe('network_connection_reset')
    expect(normalizeNetworkError(new Error('connection terminated')).code).toBe('network_connection_reset')
    expect(normalizeNetworkError(new Error('request timeout exceeded')).code).toBe('network_timeout')
    expect(normalizeNetworkError(new Error('certificate has expired')).code).toBe('network_tls_error')
    expect(normalizeNetworkError(new Error('SSL handshake failed')).code).toBe('network_tls_error')
    expect(normalizeNetworkError(new Error('proxy auth required')).code).toBe('network_proxy_error')
    expect(normalizeNetworkError(new Error('fetch aborted')).code).toBe('network_abort')
    expect(normalizeNetworkError(new Error('generic failure')).code).toBe('network_fetch_failed')
  })

  it('normalizes non-Error throws into fetch_failed errors', () => {
    expect(normalizeNetworkError('boom').code).toBe('network_fetch_failed')
    expect(normalizeNetworkError('boom')?.message).toBe('boom')
    expect(normalizeNetworkError(42).code).toBe('network_fetch_failed')
    expect(normalizeNetworkError('ENOTFOUND').code).toBe('network_dns_error')
    expect(normalizeNetworkError(null)?.message).toBe('Network request failed.')
    expect(normalizeNetworkError(undefined)?.code).toBe('network_fetch_failed')
  })

  it('reads error codes from the cause chain', () => {
    const fromCause = new Error('underlying', { cause: { code: 'ECONNRESET' } })
    expect(normalizeNetworkError(fromCause).code).toBe('network_connection_reset')

    const badCause = new Error('underlying', { cause: { code: 123 } })
    expect(normalizeNetworkError(badCause).code).toBe('network_fetch_failed')

    const bare = new Error('plain')
    expect(normalizeNetworkError(bare).code).toBe('network_fetch_failed')
  })

  it('reads codes from plain object errors and tolerates non-string codes', () => {
    expect(normalizeNetworkError({ code: 'ECONNREFUSED' }).code).toBe('network_connection_refused')
    expect(normalizeNetworkError({ code: 123 }).code).toBe('network_fetch_failed')
  })
})

describe('isRetryableNetworkCode', () => {
  it('marks only abort and TLS errors as non-retryable', () => {
    expect(isRetryableNetworkCode('network_abort')).toBe(false)
    expect(isRetryableNetworkCode('network_tls_error')).toBe(false)
    expect(isRetryableNetworkCode('network_timeout')).toBe(true)
    expect(isRetryableNetworkCode('network_connection_reset')).toBe(true)
  })
})
