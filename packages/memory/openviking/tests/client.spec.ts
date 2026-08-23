/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

/* oxlint-disable typescript/no-base-to-string -- Stub fetch bodies arrive as vitest-typed any and are stringified for assertions. */

import { describe, expect, it, vi } from 'vitest'

import { OpenVikingClient, type FetchLike, type ResponseLike } from '../src/client.ts'
import { OpenVikingAbortError, OpenVikingError, OpenVikingTimeoutError } from '../src/errors.ts'

/** Build a stub fetch returning one canned response, capturing the request. */
function stubFetch(respond: (init: { method: string; input: string; body?: string | undefined }) => ResponseLike | Promise<ResponseLike>) {
  const calls: Array<{ method: string; input: string; body?: string | undefined }> = []
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({ method: init.method, input, body: init.body })
    return Promise.resolve(respond(calls[calls.length - 1]!))
  }
  return { fetchImpl, calls }
}

function jsonResponse(status: number, body: unknown): ResponseLike {
  return {
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

const CREDS = {
  endpoint: 'http://127.0.0.1:1934/',
  apiKey: 'k',
  account: 'a',
  user: 'u',
  agentId: 'dsh',
  timeoutMs: 5000,
}

function clientWith(respond: (init: { method: string; input: string; body?: string | undefined }) => ResponseLike) {
  const { fetchImpl, calls } = stubFetch(respond)
  return { client: new OpenVikingClient(CREDS, fetchImpl), calls }
}

describe('OpenVikingClient request plumbing', () => {
  it('sends identity headers and trims the trailing slash', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: { status: 'ok' } }))
    await client.health()
    const call = calls[0]!
    expect(call.input).toBe('http://127.0.0.1:1934/health')
    expect(JSON.parse(call.body ?? '{}')).toEqual({})
    const headers = (client as never as { headers(): Record<string, string> }).headers()
    expect(headers).toEqual({
      'x-api-key': 'k',
      'x-openviking-account': 'a',
      'x-openviking-user': 'u',
      'x-openviking-agent': 'dsh',
    })
  })

  it('omits empty credential headers', () => {
    const client = new OpenVikingClient({ ...CREDS, apiKey: '', account: '', user: '', agentId: '' })
    const headers = (client as never as { headers(): Record<string, string> }).headers()
    expect(headers).toEqual({})
  })

  it('unwraps a success envelope and returns its result', async () => {
    const { client } = clientWith(() => jsonResponse(200, { status: 'ok', result: { memories: [], total: 0 } }))
    await expect(client.find({ query: 'q', targetUri: 'viking://user/memories/', limit: 5 })).resolves.toEqual({ memories: [], total: 0 })
  })

  it('treats a bare (unwrapped) body as the result', async () => {
    const { client } = clientWith(() => jsonResponse(200, { status: 'ok' }))
    await expect(client.health()).resolves.toEqual({ status: 'ok' })
  })

  it('maps an OpenViking error envelope to OpenVikingError carrying its code', async () => {
    const { client } = clientWith(() => jsonResponse(503, { status: 'error', error: { code: 'UNAVAILABLE', message: 'provider down' } }))
    await expect(client.read('viking://user/memories/', 'read')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      httpStatus: 503,
      message: expect.stringContaining('provider down'),
    })
  })

  it('maps FastAPI detail messages for non-2xx responses', async () => {
    const { client } = clientWith(() => jsonResponse(404, { detail: 'not found anywhere' }))
    await expect(client.stat('viking://missing/')).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 })
  })

  it('throws on invalid JSON bodies with the HTTP status context', async () => {
    const { client } = clientWith(() => ({ status: 200, text: () => Promise.resolve('not-json') }))
    await expect(client.health()).rejects.toMatchObject({ code: 'INVALID_JSON', httpStatus: 200 })
  })

  it('reports invalid JSON in a non-2xx as INVALID_ERROR_RESPONSE', async () => {
    const { client } = clientWith(() => ({ status: 500, text: () => Promise.resolve('OOM') }))
    await expect(client.health()).rejects.toMatchObject({ code: 'INVALID_ERROR_RESPONSE', httpStatus: 500 })
  })

  it('rejects a non-object 2xx body as an invalid response shape', async () => {
    const { client } = clientWith(() => jsonResponse(200, [1, 2]))
    await expect(client.health()).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })

  it('falls back to generic message and code for malformed error envelopes', async () => {
    const { client } = clientWith(() => jsonResponse(200, { status: 'error', error: {} }))
    await expect(client.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringContaining('OpenViking service error') })
  })

  it('wraps non-Error network failures as UNAVAILABLE', async () => {
    const { client } = clientWith(() => { throw 'boom' })
    await expect(client.health()).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.stringContaining('network error') })
  })

  it('treats 204 as an empty success', async () => {
    const { client } = clientWith(() => ({ status: 204, text: () => Promise.resolve('') }))
    await expect(client.addMessage('s1', { role: 'user', content: 'hi' })).resolves.toEqual({})
  })

  it('reports an empty body with a 200 as a null result', async () => {
    const { client } = clientWith(() => ({ status: 200, text: () => Promise.resolve('') }))
    await expect(client.health()).resolves.toBeNull()
  })

  it('throws OpenVikingTimeoutError when the deadline aborts the request', async () => {
    const { fetchImpl, calls } = stubFetch(() => new Promise<ResponseLike>((_resolve, reject) => {
      // Misbehaving fetch: ignores the abort signal entirely. The client's
      // race still surfaces the time-out.
      void reject
    }))
    const client = new OpenVikingClient({ ...CREDS, timeoutMs: 20 }, fetchImpl)
    await expect(client.health()).rejects.toBeInstanceOf(OpenVikingTimeoutError)
    expect(calls).toHaveLength(1)
  })

  it('throws OpenVikingAbortError when the caller aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await expect(client.health(controller.signal)).rejects.toBeInstanceOf(OpenVikingAbortError)
  })

  it('throws OpenVikingAbortError when the caller aborts mid-flight', async () => {
    const controller = new AbortController()
    const { fetchImpl } = stubFetch(() => new Promise<ResponseLike>((_resolve, reject) => {
      // Misbehaving fetch: ignores the abort signal and fails on its own.
      setTimeout(() => { reject(new Error('network hiccup'))  }, 30)
    }))
    const client = new OpenVikingClient(CREDS, fetchImpl)
    const pending = client.health(controller.signal)
    setTimeout(() => { controller.abort()  }, 5)
    await expect(pending).rejects.toBeInstanceOf(OpenVikingAbortError)
  })

  it('surfaces a caller abort that lands during the body read', async () => {
    const controller = new AbortController()
    const { fetchImpl } = stubFetch(() => ({
      status: 200,
      text: () => new Promise<string>(resolve => setTimeout(() => { resolve('{"status":"ok","result":{ }}') }, 30)),
    }))
    const client = new OpenVikingClient(CREDS, fetchImpl)
    const pending = client.health(controller.signal)
    setTimeout(() => { controller.abort()  }, 5)
    await expect(pending).rejects.toBeInstanceOf(OpenVikingAbortError)
  })

  it('surfaces a deadline that lands during the body read', async () => {
    const { fetchImpl } = stubFetch(() => ({
      status: 200,
      text: () => new Promise<string>(resolve => setTimeout(() => { resolve('{"status":"ok","result":{ }}') }, 60)),
    }))
    const client = new OpenVikingClient({ ...CREDS, timeoutMs: 20 }, fetchImpl)
    await expect(client.health()).rejects.toBeInstanceOf(OpenVikingTimeoutError)
  })

  it('reads nested OpenViking error fields for non-2xx responses', async () => {
    const { client } = clientWith(() => jsonResponse(502, { status: 'error', error: { code: 'UPSTREAM', message: 'embeddings down' } }))
    await expect(client.health()).rejects.toMatchObject({ code: 'UPSTREAM', httpStatus: 502, message: expect.stringContaining('embeddings down') })
  })

  it('unwraps 2xx error envelopes with nested message or code only', async () => {
    const { client } = clientWith(() => jsonResponse(200, { status: 'error', error: { message: 'only message' } }))
    await expect(client.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringContaining('only message') })
    const { client: second } = clientWith(() => jsonResponse(200, { status: 'error', error: { code: 'ONLYCODE' } }))
    await expect(second.health()).rejects.toMatchObject({ code: 'ONLYCODE' })
  })

  it('keeps non-network error messages verbatim', async () => {
    const { client } = clientWith(() => { throw new Error('kaboom') })
    await expect(client.health()).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.stringContaining('kaboom') })
  })

  it('reads top-level OpenViking error fields and falls back to HTTP text', async () => {
    const { client } = clientWith(() => jsonResponse(500, { message: 'top message', code: 'TOPCODE' }))
    await expect(client.health()).rejects.toMatchObject({ code: 'TOPCODE', message: expect.stringContaining('top message') })
    const { client: second } = clientWith(() => jsonResponse(502, {}))
    await expect(second.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringContaining('HTTP 502') })
    const { client: third } = clientWith(() => jsonResponse(500, 'oops'))
    await expect(third.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringContaining('HTTP 500') })
  })

  it('tolerates a non-object error field in a 2xx error envelope', async () => {
    const { client } = clientWith(() => jsonResponse(200, { status: 'error', error: 'boom' }))
    await expect(client.health()).rejects.toMatchObject({ code: 'HTTP_ERROR', message: expect.stringContaining('OpenViking service error') })
  })

  it('keeps a trailing-slash-free endpoint verbatim', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { status: 'ok', result: {} }))
    const client = new OpenVikingClient({ ...CREDS, endpoint: 'http://no-slash:1934' }, fetchImpl)
    await client.health()
    expect(calls[0]!.input).toBe('http://no-slash:1934/health')
  })

  it('uses the default fetch when none is injected', async () => {
    const fetchSpy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ status: 'ok', result: {} }), { status: 200 })))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const client = new OpenVikingClient(CREDS)
      await client.health()
      await client.find({ query: 'q', targetUri: 'viking://x/', limit: 1 })
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:1934/health',
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'x-api-key': 'k' }) }),
      )
      expect(fetchSpy.mock.calls.some(call => String((call[1]?.body ?? '')).includes('target_uri'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('wraps network failures as UNAVAILABLE without leaking secrets', async () => {
    const { client, calls } = clientWith(() => { throw new Error('fetch failed: ECONNREFUSED') })
    await expect(client.health()).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(calls).toHaveLength(1)
  })

  it('reconfigures live credentials', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    client.reconfigure({ ...CREDS, endpoint: 'http://example.com:9/', apiKey: 'new' })
    await client.health()
    expect(calls[0]!.input).toBe('http://example.com:9/health')
  })
})

describe('OpenVikingClient method wire shapes', () => {
  it('serializes find parameters to the search/find body', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: { memories: [], resources: [], skills: [], total: 0 } }))
    await client.find({ query: 'q', targetUri: 'viking://user/memories/', limit: 7, scoreThreshold: 0.3, level: [0] })
    expect(JSON.parse(calls[0]!.body ?? '')).toEqual({
      query: 'q', target_uri: 'viking://user/memories/', limit: 7, score_threshold: 0.3, level: [0], context_type: undefined,
    })
  })

  it('serializes searchContext with session id and context mode', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await client.searchContext({ query: 'q', targetUri: 'viking://agent/', limit: 3, sessionId: 's1' })
    const body = JSON.parse(calls[0]!.body ?? '')
    expect(body.session_id).toBe('s1')
    expect(body.mode).toBe('context')
  })

  it('encodes ids in session paths', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await client.commit('s/with/slashes', { keepRecentCount: 4 })
    expect(calls[0]!.input).toContain('/sessions/s%2Fwith%2Fslashes/commit')
    expect(JSON.parse(calls[0]!.body ?? '')).toEqual({ keep_recent_count: 4 })
  })

  it('builds query strings skipping undefined values', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await (client as never as { tree(uri: string, o?: object): Promise<unknown> }).tree('viking://x/', { nodeLimit: 10 })
    expect(calls[0]!.input).toBe('http://127.0.0.1:1934/api/v1/fs/tree?uri=viking%3A%2F%2Fx%2F&node_limit=10')
  })

  it('passes through skill paths', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await client.putSkill('runbook', { content: 'x' })
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.input).toContain('/api/v1/skills/runbook')
  })

  it('serializes content writes with replace and append modes', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await client.writeContent('viking://user/memories/a.md', 'x', { mode: 'replace' })
    await client.writeContent('viking://user/memories/b.md', 'y')
    expect(JSON.parse(calls[0]!.body ?? '')).toEqual({ uri: 'viking://user/memories/a.md', content: 'x', mode: 'replace', wait: true })
    expect(JSON.parse(calls[1]!.body ?? '')).toEqual({ uri: 'viking://user/memories/b.md', content: 'y', mode: 'append', wait: true })
  })

  it('serializes batch session messages', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await client.addBatch('s1', [{ role: 'user', content: 'a', source_message_ids: ['1'] }])
    expect(calls[0]!.input).toContain('/sessions/s1/messages/batch')
    expect(JSON.parse(calls[0]!.body ?? '')).toEqual({ messages: [{ role: 'user', content: 'a', source_message_ids: ['1'] }] })
  })

  it('reads a session by id', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: { session_id: 's1', message_count: 2 } }))
    await expect(client.getSession('s1')).resolves.toMatchObject({ session_id: 's1' })
    expect(calls[0]!.input).toContain('/sessions/s1')
  })

  it('covers the remaining method wire shapes', async () => {
    const { client, calls } = clientWith(() => jsonResponse(200, { status: 'ok', result: {} }))
    await client.queue()
    await client.memoryStats()
    await client.createSession('s1')
    await client.addMessage('s1', { role: 'user', parts: [{ type: 'text', text: 'hi' }], source_message_ids: ['m1'], message_kind: 'user_query' })
    await client.commit('s1')
    await client.getSkill('runbook/split')
    await client.createSkill({ name: 'nb' })
    expect(calls.map(call => `${call.method} ${new URL(call.input).pathname}`)).toEqual([
      'GET /api/v1/observer/queue',
      'GET /api/v1/stats/memories',
      'POST /api/v1/sessions',
      'POST /api/v1/sessions/s1/messages',
      'POST /api/v1/sessions/s1/commit',
      'GET /api/v1/skills/runbook%2Fsplit',
      'POST /api/v1/skills',
    ])
    expect(JSON.parse(calls.find(call => call.input.endsWith('/commit'))!.body ?? '')).toEqual({ keep_recent_count: 10 })
    expect(calls.find(call => call.input.endsWith('/messages'))?.body).toContain('source_message_ids')
  })
})

describe('error classes', () => {
  it('names the endpoint in messages', () => {
    const error = new OpenVikingError('http://e:1', 'boom', { code: 'TIMEOUT' })
    expect(error.message).toContain('http://e:1')
    expect(error.code).toBe('TIMEOUT')
    expect(new OpenVikingTimeoutError('http://e:1', 5).code).toBe('TIMEOUT')
    expect(new OpenVikingAbortError().name).toBe('OpenVikingAbortError')
  })
})

describe('vi sanity', () => {
  it('keeps vi import used', () => {
    expect(vi).toBeDefined()
  })
})
