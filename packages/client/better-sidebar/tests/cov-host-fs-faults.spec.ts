/**
 * Filesystem faults no real filesystem produces on demand: a rejection that
 * is not an Error (the `String(error)` fallback of every fs guard) and a
 * directory stream that fails after `opendir` succeeded. Each test injects
 * one fault into `node:fs/promises` and asserts the reported wire error, so a
 * regression that drops the fallback surfaces as a broken message instead of
 * a silently different one.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { anyString } from './matchers.ts'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply } from '../src/index.ts'
import { listDirectory } from '../src/fs-tree.ts'
import { ensureWorkspacePath, ensureWorkspaceWritePath } from '../src/path-security.ts'
import { AgentOpenRegistry, registerOpenTool } from '../src/agent-opens.ts'
import type { Context, SidebarWebRoute } from '../src/context-types.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** One injected fault: which operation, which paths, and the thrown value. */
interface Fault {
  op: 'stat' | 'open' | 'writeFile' | 'realpath'
  /** Paths whose call should fail. */
  when: (path: string) => boolean
  error: unknown
}

let faults: Fault[] = []

/** The injected fault for one call, if any. */
function faultFor(op: Fault['op'], path: string): unknown {
  for (const fault of faults) {
    if (fault.op === op && fault.when(path)) return fault.error
  }
  return undefined
}

/** Whether the path asks for a directory stream that fails mid-iteration. */
let opendirThrows = false

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const guarded = async <T>(op: Fault['op'], path: string, run: () => Promise<T>): Promise<T> => {
    const fault = faultFor(op, path)
    if (fault !== undefined) throw fault
    return run()
  }
  return {
    ...actual,
    stat: (path: string, options?: unknown) => guarded('stat', path, () => actual.stat(path as never, options as never)),
    open: (path: string, flags: unknown) => guarded('open', path, () => actual.open(path as never, flags as never)),
    writeFile: (path: string, data: unknown) => guarded('writeFile', path, () => actual.writeFile(path as never, data as never)),
    realpath: (path: string) => guarded('realpath', path, () => actual.realpath(path)),
    opendir: async (path: string) => {
      if (opendirThrows) {
        return {
          [Symbol.asyncIterator]: () => ({
            next: async (): Promise<IteratorResult<never>> => { throw new Error('readdir failed') },
          }),
        }
      }
      return actual.opendir(path)
    },
  }
})

afterEach(() => {
  faults = []
  opendirThrows = false
})

interface Mounted {
  routes: SidebarWebRoute[]
  tools: ToolDefinition[]
  cleanup: () => void
}

/** Mount the plugin against a fake context rooted at `workspace`. */
function mount(workspace: string): Mounted {
  const routes: SidebarWebRoute[] = []
  const tools: ToolDefinition[] = []
  const cleanups: Array<() => void> = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: (route: SidebarWebRoute) => { routes.push(route); return () => {} },
      registerUpgrade: () => () => {},
      registerStream: () => () => {},
    },
    sessions: { get: () => ({ header: { cwd: workspace } }) },
    tools: { register: (tool: unknown) => { tools.push(tool as ToolDefinition); return () => {} } },
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    },
    inject: () => () => {},
    get: () => undefined,
    on: () => () => {},
  }
  apply(ctx as never, undefined)
  return { routes, tools, cleanup: () => { for (const cleanup of cleanups) cleanup() } }
}

interface ApiOutcome { ok: boolean; status: number; value?: unknown; error?: { code?: string; message: string } }

/** POST one JSON payload to the /sidebar/api route. */
async function invoke(route: SidebarWebRoute, method: string, payload: unknown): Promise<ApiOutcome> {
  const out = { status: 0, body: '' }
  const req = {
    method: 'POST',
    url: `/sidebar/api/${method}`,
    headers: { host: '127.0.0.1:3080' },
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(payload)) },
  }
  const res = {
    statusCode: 0,
    writeHead: (status: number) => { out.status = status },
    end: (chunk?: string | Uint8Array) => { out.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? '').toString('utf8') },
  }
  await route.handler(req, res)
  return { ...JSON.parse(out.body) as Record<string, unknown>, status: out.status } as never
}

const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-faults-'))
// The route hands the REAL path to the filesystem (the workspace guard
// canonicalizes through realpath), so the fault predicates must match the
// canonical form — on macOS the temp root is a symlink.
const root = realpathSync(workspace)

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('directory stream failures', () => {
  it('reports a readdir failure after opendir succeeded', async () => {
    opendirThrows = true
    await expect(listDirectory(workspace)).rejects.toMatchObject({
      code: 'fs-error',
      message: anyString('cannot list'),
    })
  })
})

describe('workspace guards against non-Error resolution failures', () => {
  it('reports a workspace path that cannot be resolved at all', async () => {
    faults = [{ op: 'realpath', when: () => true, error: 'plain realpath cause' }]
    await expect(ensureWorkspacePath(workspace, join(workspace, 'any.txt'))).rejects.toMatchObject({
      code: 'fs-error',
      message: anyString('plain realpath cause'),
    })
  })

  it('refuses a write target whose ancestors cannot be resolved at all', async () => {
    // Every realpath the walk performs reports ENOENT, so it climbs to the
    // filesystem root and refuses the target. The target sits outside the
    // workspace, which the fault exempts: a target below it would meet that
    // exempted ancestor and resolve there instead.
    faults = [{
      op: 'realpath',
      when: path => path !== workspace,
      error: Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
    }]
    const outside = join(dirname(root), 'dsh-fault-walk', 'file.txt')
    await expect(ensureWorkspaceWritePath(workspace, outside)).rejects.toMatchObject({
      code: 'fs-error',
      message: anyString('cannot resolve target'),
    })
  })

  it('reports an unresolvable write ancestor while the workspace resolves', async () => {
    const target = join(root, 'dsh-fault-target.txt')
    faults = [{ op: 'realpath', when: path => path.includes('dsh-fault-target'), error: 'plain ancestor cause' }]
    await expect(ensureWorkspaceWritePath(workspace, target)).rejects.toMatchObject({
      code: 'fs-error',
      message: anyString('plain ancestor cause'),
    })
  })
})

describe('read and write failures through the API', () => {
  const mounted = mount(workspace)
  afterAll(() => { mounted.cleanup() })
  const api = (): SidebarWebRoute => {
    const route = mounted.routes.find(candidate => candidate.path === '/sidebar/api')
    if (route === undefined) throw new Error('/sidebar/api was not registered')
    return route
  }

  it('reports a stat failure during a read for Error and non-Error faults', async () => {
    const path = join(root, 'stat-fault.txt')
    writeFileSync(path, 'content')
    faults = [{ op: 'stat', when: candidate => candidate === path, error: new Error('stat exploded') }]
    expect(await invoke(api(), 'fs.read', { sessionId: 's', path })).toMatchObject({
      ok: false, error: { code: 'fs-error', message: anyString('stat exploded') },
    })
    faults = [{ op: 'stat', when: candidate => candidate === path, error: 'plain stat cause' }]
    expect(await invoke(api(), 'fs.read', { sessionId: 's', path })).toMatchObject({
      ok: false, error: { code: 'fs-error', message: anyString('plain stat cause') },
    })
  })

  it('reports an open failure whose thrown value is not an Error', async () => {
    const path = join(root, 'open-fault.txt')
    writeFileSync(path, 'content')
    faults = [{ op: 'open', when: candidate => candidate === path, error: 'plain open cause' }]
    expect(await invoke(api(), 'fs.read', { sessionId: 's', path })).toMatchObject({
      ok: false, error: { code: 'fs-error', message: anyString('plain open cause') },
    })
  })

  it('reports a write failure whose thrown value is not an Error', async () => {
    const path = join(root, 'write-fault.txt')
    faults = [{ op: 'writeFile', when: candidate => candidate.startsWith(path), error: 'plain write cause' }]
    expect(await invoke(api(), 'fs.write', { sessionId: 's', path, content: 'x' })).toMatchObject({
      ok: false, error: { code: 'fs-error', message: anyString('plain write cause') },
    })
  })
})

describe('open-tool classification failures', () => {
  it('reports a non-Error stat failure while classifying a target', async () => {
    let captured: ToolDefinition | undefined
    const ctx = {
      tools: { register: (tool: unknown) => { captured = tool as ToolDefinition; return () => {} } },
    } as unknown as Context
    registerOpenTool(ctx, new AgentOpenRegistry(), async () => workspace, (() => ({ tabsEnabled: {} })) as never)
    if (captured === undefined) throw new Error('sidebar_open was not registered')
    const target = join(root, 'classify-fault.txt')
    faults = [{ op: 'stat', when: candidate => candidate === target, error: 'plain classify cause' }]
    const exec = { signal: { throwIfAborted: () => {}, aborted: false }, agent: { session: { id: 's1' } } } as unknown as ToolRunContext
    await expect(captured.execute({ target }, exec)).rejects.toThrow('plain classify cause')
  })
})

describe('fault isolation', () => {
  it('resolves a directory listing once no fault is installed', async () => {
    mkdirSync(join(workspace, 'clean'), { recursive: true })
    const listing = await listDirectory(join(workspace, 'clean'))
    expect(listing.entries).toEqual([])
  })
})
