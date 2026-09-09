import { describe, expect, it } from 'vitest'
import { PortlessWebServer, type DesktopHttpRequest, type DesktopHttpResponse, type DesktopRouteKind } from '../src/portless-webserver.ts'

async function readBody(req: DesktopHttpRequest): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function jsonRoute(path: string): { kind: 'exact'; path: string; handler: (req: DesktopHttpRequest, res: DesktopHttpResponse) => Promise<void> } {
  return {
    kind: 'exact',
    path,
    handler: async (req, res) => {
      const body = await readBody(req)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ method: req.method, body, url: req.url }))
    },
  }
}

function route(kind: DesktopRouteKind, path: string, tag: string) {
  return { kind, path, handler: (_req: DesktopHttpRequest, res: DesktopHttpResponse) => { res.writeHead(200); res.end(tag) } }
}

describe('PortlessWebServer', () => {
  it('serves an exact route and adapts the Fetch request body to the async iterator', async () => {
    const web = new PortlessWebServer()
    web.register(jsonRoute('/sidebar/api'))
    const request = new Request('http://x/sidebar/api', { method: 'POST', body: '{"a":1}' })
    const response = await web.dispatch(request)
    expect(response).not.toBeNull()
    const payload = await response!.json() as { method: string; body: string; url: string }
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(payload).toEqual({ method: 'POST', body: '{"a":1}', url: 'http://x/sidebar/api' })
  })

  it('serves a prefix route and adapts a binary body', async () => {
    const web = new PortlessWebServer()
    web.register({
      kind: 'prefix',
      path: '/sidebar/file',
      handler: (req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from([1, 2, 3]))
      },
    })
    const response = await web.dispatch(new Request('http://x/sidebar/file/a.png?path=x', { method: 'GET' }))
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response!.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
  })

  it('returns null when no route matches, leaving the asset handler to answer', async () => {
    const web = new PortlessWebServer()
    expect(await web.dispatch(new Request('http://x/index.html', { method: 'GET' }))).toBeNull()
    expect(await web.dispatch(new Request('http://x/sidebar/api', { method: 'GET' }))).toBeNull()
  })

  it('prefers the exact match and longest-prefix-wins over a shorter prefix', async () => {
    const web = new PortlessWebServer()
    const calls: string[] = []
    const tagged = (kind: DesktopRouteKind, path: string, tag: string) => ({
      kind,
      path,
      handler: (_req: DesktopHttpRequest, res: DesktopHttpResponse) => { calls.push(tag); res.writeHead(200); res.end() },
    })
    web.register(tagged('exact', '/sidebar/exact/path', 'exact'))
    web.register(tagged('prefix', '/sidebar', 'short'))
    web.register(tagged('prefix', '/sidebar/file', 'long'))

    await web.dispatch(new Request('http://x/sidebar/other', { method: 'GET' }))
    expect(calls).toEqual(['short'])

    calls.length = 0
    await web.dispatch(new Request('http://x/sidebar/file/x', { method: 'GET' }))
    expect(calls).toEqual(['long'])

    calls.length = 0
    await web.dispatch(new Request('http://x/sidebar/exact/path', { method: 'GET' }))
    expect(calls).toEqual(['exact'])
  })

  it('rejects duplicate routes and returns disposers that unregister', async () => {
    const web = new PortlessWebServer()
    web.register(route('exact', '/a', 'a'))
    expect(() => web.register(route('exact', '/a', 'a2'))).toThrow(/duplicate exact route/)
    web.register(route('prefix', '/p', 'p'))
    expect(() => web.register(route('prefix', '/p', 'p2'))).toThrow(/duplicate prefix route/)
    web.registerUpgrade({ path: '/ws', handler: {} })
    expect(() => web.registerUpgrade({ path: '/ws', handler: {} })).toThrow(/duplicate upgrade route/)

    const dispose = web.register(jsonRoute('/sidebar/api'))
    expect(await web.dispatch(new Request('http://x/sidebar/api', { method: 'POST' }))).not.toBeNull()
    dispose()
    expect(await web.dispatch(new Request('http://x/sidebar/api', { method: 'POST' }))).toBeNull()
  })
})
