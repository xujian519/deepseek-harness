/**
 * Lazy-chunk route fault coverage: the "read raced a delete/rebuild between
 * the stat and the read" 404, and the URL-less request shape. The chunk file
 * genuinely exists, so the race is injected by failing exactly one scheduled
 * readFile (the handler's second read) while every other fs call stays real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBundleRouteHandler } from '../src/bundle-route.ts'
import type { SidebarHttpRequest, SidebarHttpResponse } from '../src/context-types.ts'

// Fail ONE readFile call when armed — modeling the delete/rebuild race the
// handler defends against (stat succeeded, content read failed).
let armedFailures = 0
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
      if (armedFailures > 0) {
        armedFailures -= 1
        throw new Error('EACCES: chunk rebuilt mid-read')
      }
      return actual.readFile(path, options)
    }) as typeof actual.readFile,
  }
})

/** Invoke the route handler and record the response. */
async function serve(
  handler: ReturnType<typeof createBundleRouteHandler>,
  req: Partial<SidebarHttpRequest>,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const out: { status: number; headers: Record<string, string>; body: string } = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead: (status: number, headers?: Record<string, string>) => { out.status = status; out.headers = headers ?? {} },
    end: (chunk?: string | Uint8Array) => { out.body += String(chunk ?? '') },
  } as unknown as SidebarHttpResponse
  await handler({ headers: { host: '127.0.0.1:3080' }, ...req } as SidebarHttpRequest, res)
  return out
}

describe('bundle route read-race and request shapes', () => {
  let chunkDir: string

  beforeAll(() => {
    chunkDir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-bundle-race-'))
    writeFileSync(join(chunkDir, 'client-terminal.js'), 'export const chunk = "terminal"\n')
  })

  afterAll(() => {
    rmSync(chunkDir, { recursive: true, force: true })
  })

  it('serves a warm chunk, then answers 404 when the read races a rebuild', async () => {
    const handler = createBundleRouteHandler(() => true, chunkDir)
    const first = await serve(handler, { method: 'GET', url: '/sidebar/bundle/terminal.js' })
    expect(first.status).toBe(200)
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{12}"$/)

    // The next handler readFile fails (the memoized ETag path skips its own
    // read because stat still matches), so only the route read fails.
    armedFailures = 1
    const raced = await serve(handler, { method: 'GET', url: '/sidebar/bundle/terminal.js' })
    expect(raced.status).toBe(404)
    expect(raced.body).toBe('not found')
  })

  it('treats a missing request URL as the route root (no chunk name)', async () => {
    const handler = createBundleRouteHandler(() => true, chunkDir)
    const result = await serve(handler, { method: 'GET' })
    expect(result.status).toBe(404)
    expect(result.body).toBe('not found')
  })
})
