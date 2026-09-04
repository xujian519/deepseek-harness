/**
 * Host-half pure-helper coverage: the wire envelope (bounded body read,
 * error writing), the workspace write-path guard's non-ENOENT resolution
 * failures, the explorer listing errors and row overflow, the name-search
 * budget stop points, the browser-trust fence's authority parsing, and the
 * live-activity parser's malformed rows. Complements the behavior specs by
 * pinning the failure and degradation branches those specs do not reach.
 */
import { describe, expect, it } from 'vitest'
import { anyString } from './matchers.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJsonBody, writeError } from '../src/wire.ts'
import { ensureWorkspaceWritePath } from '../src/path-security.ts'
import { listDirectory, messageOf } from '../src/fs-tree.ts'
import { searchFiles } from '../src/fs-search.ts'
import { isLoopbackHostname, isTrustedApiRequest } from '../src/trust-fence.ts'
import { contentText, lastActivity } from '../src/subagent-activity.ts'
import { buildSubagentLiveApi } from '../src/subagent-live-route.ts'
import type { Context, SidebarSessionEvent, SidebarSubagentDescendantEntry } from '../src/context-types.ts'

/** A response recorder shaped like SidebarHttpResponse. */
function record(): { status: number; headers?: Record<string, string> | undefined; body: string } {
  const out: { status: number; headers?: Record<string, string> | undefined; body: string } = { status: 0, body: '' }
  return {
    writeHead: (status: number, headers?: Record<string, string>) => { out.status = status; out.headers = headers },
    end: (chunk?: string | Uint8Array) => { out.body += String(chunk ?? '') },
    get status() { return out.status },
    get headers() { return out.headers },
    get body() { return out.body },
  } as unknown as { status: number; headers?: Record<string, string> | undefined; body: string }
}

/** A request whose body is the given chunks (the face readJsonBody iterates). */
function bodyRequest(chunks: Array<string | Uint8Array>): { [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array> } {
  return {
    [Symbol.asyncIterator]: async function* () { yield* chunks },
  }
}

describe('wire body reading', () => {
  it('rejects a body over the 1 MiB bound before parsing', async () => {
    const req = bodyRequest([Buffer.alloc(700 * 1024, 0x61), Buffer.alloc(700 * 1024, 0x62)])
    await expect(readJsonBody(req as never)).rejects.toMatchObject({ code: 'bad-request', message: 'request body too large' })
  })

  it('treats an empty body as an empty object', async () => {
    const parsed = await readJsonBody(bodyRequest([]) as never)
    expect(parsed).toEqual({})
  })

  it('rejects malformed JSON as bad-request', async () => {
    const req = bodyRequest(['{"truncated": '])
    await expect(readJsonBody(req as never)).rejects.toMatchObject({ code: 'bad-request', message: 'request body is not valid JSON' })
  })

  it('writeError maps non-Sidebar errors to internal 500 with the message', () => {
    const res = record()
    writeError(res as never, new Error('disk on fire'))
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: { code: 'internal', message: 'disk on fire' } })
  })

  it('writeError stringifies thrown non-Errors', () => {
    const res = record()
    writeError(res as never, 42)
    expect(res.status).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: { code: 'internal', message: '42' } })
  })
})

describe('workspace write-path guard failures', () => {
  it('reports a non-ENOENT resolution failure as fs-error (NUL byte target)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-sidebar-writeguard-'))
    try {
      // A NUL byte makes realpath fail with a validation error (not ENOENT),
      // which must surface as the fs-error branch instead of walking ancestors.
      await expect(ensureWorkspaceWritePath(cwd, join(cwd, 'bad\0name'))).rejects.toMatchObject({
        code: 'fs-error',
        message: anyString('cannot resolve target'),
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('explorer listing errors and bounds', () => {
  it('reports an unreadable level as fs-error (missing path)', async () => {
    await expect(listDirectory(join(tmpdir(), 'dsh-sidebar-no-such-dir-xyz'))).rejects.toMatchObject({
      code: 'fs-error',
      message: anyString('cannot list'),
    })
  })

  it('reports a file level as fs-error (opendir ENOTDIR)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-listing-'))
    const file = join(dir, 'plain.txt')
    writeFileSync(file, 'x')
    try {
      await expect(listDirectory(file)).rejects.toMatchObject({ code: 'fs-error' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('marks a level with more rows than maxEntries as truncated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-overflow-'))
    try {
      writeFileSync(join(dir, 'a.txt'), '')
      writeFileSync(join(dir, 'b.txt'), '')
      writeFileSync(join(dir, 'c.txt'), '')
      const listing = await listDirectory(dir, 2)
      expect(listing.entries).toHaveLength(2)
      expect(listing.truncated).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('messageOf renders Error messages and stringifies other throwables', () => {
    expect(messageOf(new Error('plain'))).toBe('plain')
    expect(messageOf('raw string')).toBe('raw string')
  })
})

describe('name-search budget stop points', () => {
  it('stops descending once the match cap is reached and reports truncation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-searchcap-'))
    try {
      mkdirSync(join(root, 'sub'), { recursive: true })
      writeFileSync(join(root, 'mfile.txt'), '')
      writeFileSync(join(root, 'sub', 'mdeep.txt'), '')
      // The first match exhausts the cap; the sibling directory must not be
      // descended (or, when reached first, matched) after truncation.
      const result = await searchFiles(root, 'm', { maxMatches: 1 })
      expect(result.truncated).toBe(true)
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]).toMatch(/^sub\/mdeep\.txt$|^mfile\.txt$/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stops the walk once the visit budget is exhausted inside a subtree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-searchvisit-'))
    try {
      mkdirSync(join(root, 'inner'), { recursive: true })
      writeFileSync(join(root, 'inner', 'target-name.txt'), '')
      writeFileSync(join(root, 'other.txt'), '')
      // Budget 1: the first visited entry (inner or other.txt, in readdir
      // order) trips the budget; the walk must stop with truncated: true and
      // never report the unvisited entries.
      const result = await searchFiles(root, 'target-name', { maxVisited: 1 })
      expect(result.truncated).toBe(true)
      expect(result.matches).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('browser-trust fence authority parsing', () => {
  it('refuses a request without a Host header', () => {
    expect(isTrustedApiRequest({ headers: {} }, [])).toBe(false)
  })

  it('refuses an unparsable Host authority', () => {
    expect(isTrustedApiRequest({ headers: { host: 'exa ple:3080' } }, [])).toBe(false)
  })

  it('refuses when every trustedHosts entry is unparsable', () => {
    expect(isTrustedApiRequest({ headers: { host: 'example.com' } }, ['::'])).toBe(false)
  })

  it('accepts a trusted bare-host entry by hostname comparison', () => {
    expect(isTrustedApiRequest({ headers: { host: 'example.com' } }, ['example.com'])).toBe(true)
  })

  it('accepts a trusted host:port entry by authority comparison', () => {
    expect(isTrustedApiRequest({ headers: { host: '192.168.1.5:3080' } }, ['192.168.1.5:3080'])).toBe(true)
  })

  it('keeps loopback classification strict (127.x only, bounded octets)', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.0.0.256')).toBe(false)
    expect(isLoopbackHostname('127.0.1')).toBe(false)
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('example.com')).toBe(false)
  })
})

describe('live-activity parser malformed rows', () => {
  it('contentText skips null, primitive, and non-text blocks', () => {
    expect(contentText([null, 'plain', { type: 'text', text: 'kept' }, { type: 'text' }, { type: 'text', text: 5 }])).toBe('kept')
    expect(contentText('not an array')).toBeUndefined()
    expect(contentText([{ type: 'tool_use' }])).toBeUndefined()
  })

  it('lastActivity skips array holes and non-string tool fields', () => {
    // A sparse leading hole exercises the undefined-event guard in the
    // backward scan (a torn log read).
    const events: SidebarSessionEvent[] = new Array<SidebarSessionEvent>(3)
    events[1] = { type: 'assistant/message', seq: 1, time: 1, data: { message: { content: [{ type: 'text', text: 'answer' }] } } }
    events[2] = { type: 'tool/call', seq: 2, time: 2, data: { callId: 'c1', name: 42, arguments: { raw: true } } }
    const activity = lastActivity(events)
    expect(activity.text).toBe('answer')
    expect(activity.tool).toEqual({ name: 'tool', args: '' })
  })
})

describe('subagent live route degradation', () => {
  /** A context whose get() serves the given table; the table also rides as
   * properties because service seams read `ctx.sessions` directly. */
  const ctxWith = (table: Record<string, unknown>): Context =>
    ({ get: (key: string) => table[key], ...table }) as unknown as Context

  it('wraps a non-Error catalog failure into a 503 subagents-unavailable', async () => {
    const api = buildSubagentLiveApi(ctxWith({
      subagents: { listDescendants: async () => { throw 'catalog disk gone' } },
    }))
    await expect(api.live({ rootSessionId: 'root' })).rejects.toMatchObject({
      code: 'subagents-unavailable',
      status: 503,
      message: anyString('subagent catalog read failed: catalog disk gone'),
    })
  })

  it('omits children whose log is unreadable and unlabeled running children stay eligible', async () => {
    const descendants: SidebarSubagentDescendantEntry[] = [
      { kind: 'child', id: 'ghost', activity: 'running', hasChildren: false, mode: 'continuable', parentId: 'root', depth: 1 },
      { kind: 'child', id: 'quiet', activity: 'running', hasChildren: false, mode: 'continuable', parentId: 'root', depth: 1 },
      { kind: 'child', id: 'chatty', activity: 'running', hasChildren: false, mode: 'continuable', parentId: 'root', depth: 1 },
    ]
    const api = buildSubagentLiveApi(ctxWith({
      subagents: { listDescendants: async () => descendants },
      sessions: {
        get: (id: string) => {
          if (id === 'chatty') {
            return {
              header: {},
              events: [{
                type: 'assistant/message', seq: 0, time: 0,
                data: { message: { content: [{ type: 'text', text: 'working' }] } },
              }],
            }
          }
          return undefined
        },
      },
    }))
    const { live } = await api.live({ rootSessionId: 'root' })
    // The unreadable child yields no activity (omitted); the quiet child with
    // no events is omitted too; only the child with text surfaces.
    expect(live).toEqual({ chatty: { text: 'working' } })
  })
})
