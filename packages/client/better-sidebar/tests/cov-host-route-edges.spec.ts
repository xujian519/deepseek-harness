/**
 * /sidebar JSON-API route edges the behavior specs do not reach: requests
 * that carry no URL at all, the git path fallbacks (repository-root
 * resolution when the session-relative name is absent, a selected repository
 * whose root cannot be resolved, a `worktree` selector that is not a string),
 * the diff/unstage path variants, and the write failure whose temp-file
 * cleanup fails too.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import type { SidebarHttpResponse, SidebarWebRoute } from '../src/context-types.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-better-sidebar-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-better-sidebar-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

/** Run one fixture git command with the scratch identity. */
function gitRun(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout
}

interface Mounted {
  routes: SidebarWebRoute[]
  cleanup: () => void
}

/** Mount the plugin against a fake context and return the captured routes. */
function mount(sessions: (id: string) => { header: { cwd?: string } } | undefined): Mounted {
  const routes: SidebarWebRoute[] = []
  const cleanups: Array<() => void> = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: (route: SidebarWebRoute) => { routes.push(route); return () => {} },
      registerUpgrade: () => () => {},
      registerStream: () => () => {},
    },
    sessions: { get: sessions },
    tools: { register: () => () => {} },
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    },
    inject: () => () => {},
    get: () => undefined,
    on: () => () => {},
  }
  apply(ctx as never, undefined)
  return { routes, cleanup: () => { for (const cleanup of cleanups) cleanup() } }
}

const routeOf = (mounted: Mounted, path: string): SidebarWebRoute => {
  const route = mounted.routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} was not registered`)
  return route
}

/** One recorded response. */
interface Recorded { status: number; body: string; headers: Record<string, string> | undefined }

const responseRecorder = (out: Recorded): SidebarHttpResponse => ({
  writeHead: (status: number, headers?: Record<string, string>) => { out.status = status; out.headers = headers },
  end: (chunk?: string | Uint8Array) => { out.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? '').toString('utf8') },
}) as unknown as SidebarHttpResponse

const apiOutcome = (recorded: Recorded): { ok: boolean; status: number; value?: unknown; error?: { code?: string; message?: string } } =>
  ({ ...JSON.parse(recorded.body) as Record<string, unknown>, status: recorded.status }) as never

/** POST one JSON payload to the /sidebar/api route; `null` omits the URL field. */
async function invokeApi(route: SidebarWebRoute, method: string, payload: unknown, url: string | null = `/sidebar/api/${method}`): Promise<Recorded> {
  const out: Recorded = { status: 200, body: '', headers: undefined }
  const body = Buffer.from(JSON.stringify(payload))
  const req = {
    method: 'POST',
    ...(url === null ? {} : { url }),
    headers: { host: '127.0.0.1:3080' },
    [Symbol.asyncIterator]: async function* () { yield body },
  }
  await route.handler(req, responseRecorder(out))
  return out
}

/** Call a byte route (media / html / upload) with an arbitrary URL; `null` omits the URL field. */
async function invokeByteRoute(route: SidebarWebRoute, url: string | null, method = 'GET'): Promise<Recorded> {
  const out: Recorded = { status: 200, body: '', headers: undefined }
  const req = {
    method,
    ...(url === null ? {} : { url }),
    headers: { host: '127.0.0.1:3080' },
    [Symbol.asyncIterator]: async function* () { yield Buffer.from('') },
  }
  await route.handler(req, responseRecorder(out))
  return out
}

describe('requests without a URL', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-edges-'))
  const mounted = mount(id => (id === 'ws' ? { header: { cwd: workspace } } : undefined))

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('answers not-found for an API request that carries no URL', async () => {
    const recorded = await invokeApi(routeOf(mounted, '/sidebar/api'), 'session.cwd', { sessionId: 'ws' }, null)
    expect(apiOutcome(recorded)).toMatchObject({ ok: false, status: 404, error: { code: 'not-found' } })
  })

  it('refuses an upload, media, and HTML request that carries no URL', async () => {
    const upload = await invokeByteRoute(routeOf(mounted, '/sidebar/upload'), null, 'POST')
    expect(apiOutcome(upload)).toMatchObject({ ok: false, status: 400, error: { code: 'bad-request' } })
    const media = await invokeByteRoute(routeOf(mounted, '/sidebar/file'), null)
    expect(apiOutcome(media)).toMatchObject({ ok: false, status: 400, error: { code: 'bad-request' } })
    // An absent URL decodes as the root path, which is not an html route.
    const html = await invokeByteRoute(routeOf(mounted, '/sidebar/html'), null)
    expect(apiOutcome(html)).toMatchObject({ ok: false, status: 404, error: { code: 'bad-request' } })
  })
})

describe('relative git paths outside a repository', () => {
  const plain = mkdtempSync(join(tmpdir(), 'dsh-sidebar-edges-plain-'))
  const mounted = mount(() => ({ header: { cwd: plain } }))

  afterAll(() => {
    mounted.cleanup()
    rmSync(plain, { recursive: true, force: true })
  })

  it('falls back to the session cwd when no repository root can be resolved', async () => {
    // The session-relative name does not exist and the cwd is not a
    // repository, so the repo-root lookup rejects and the caller keeps the
    // session-scoped path (the request then fails on workspace containment,
    // not on the unresolved repository).
    const recorded = await invokeApi(routeOf(mounted, '/sidebar/api'), 'fs.read', { sessionId: 'plain', path: 'missing/relative.txt' })
    expect(apiOutcome(recorded)).toMatchObject({ ok: false, status: 400, error: { code: 'fs-error' } })
  })
})

describe('git route path and repository variants', () => {
  let repo: string
  const mounted = mount(() => ({ header: { cwd: repo } }))

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'dsh-sidebar-edges-repo-'))
    gitRun(repo, ['init', '-q'])
    gitRun(repo, ['checkout', '-q', '-b', 'main'])
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
    gitRun(repo, ['add', '-A'])
    gitRun(repo, ['commit', '-q', '-m', 'base'])
    // An unstaged worktree change for the whole-tree diff and a staged file
    // for the unstage-path case.
    writeFileSync(join(repo, 'a.txt'), 'one\nchanged\n')
    writeFileSync(join(repo, 'b.txt'), 'staged\n')
    gitRun(repo, ['add', 'b.txt'])
  })

  afterAll(() => {
    mounted.cleanup()
    rmSync(repo, { recursive: true, force: true })
  })

  it('diffs the whole worktree when no path is given', async () => {
    const recorded = await invokeApi(routeOf(mounted, '/sidebar/api'), 'git.diff', { sessionId: 'r', staged: false })
    const value = apiOutcome(recorded).value as { diff: string }
    expect(value.diff).toContain('a.txt')
  })

  it('unstages the given path and leaves it untracked', async () => {
    const recorded = await invokeApi(routeOf(mounted, '/sidebar/api'), 'git.unstage', { sessionId: 'r', path: 'b.txt' })
    expect(apiOutcome(recorded)).toMatchObject({ ok: true })
    const status = apiOutcome(await invokeApi(routeOf(mounted, '/sidebar/api'), 'git.status', { sessionId: 'r' })).value as { entries: Array<{ path: string; xy: string }> }
    expect(status.entries.find(entry => entry.path === 'b.txt')?.xy).toBe('??')
  })

  it('rejects an unknown linked-worktree selector and ignores a non-string one', async () => {
    const unknown = await invokeApi(routeOf(mounted, '/sidebar/api'), 'git.worktrees', { sessionId: 'r', worktree: join(tmpdir(), 'dsh-sidebar-edges-nope') })
    expect(apiOutcome(unknown)).toMatchObject({ ok: false, error: { code: 'git-worktree' } })
    const ignored = await invokeApi(routeOf(mounted, '/sidebar/api'), 'git.worktrees', { sessionId: 'r', worktree: 42 })
    expect(apiOutcome(ignored).ok).toBe(true)
  })

  it('defaults a selected repository to the cwd when its root cannot be resolved', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'dsh-sidebar-edges-container-'))
    const containerMount = mount(() => ({ header: { cwd: plain } }))
    try {
      const recorded = await invokeApi(routeOf(containerMount, '/sidebar/api'), 'git.worktrees', { sessionId: 'c', repoRoot: plain })
      // No repository at the cwd: the worktree inventory is empty.
      expect(apiOutcome(recorded).value).toEqual([])
    } finally {
      containerMount.cleanup()
      rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('workspace write failure whose temp cleanup fails', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-edges-write-'))
  const mounted = mount(() => ({ header: { cwd: workspace } }))

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('reports the write failure and leaves the undeletable temp entry behind', async () => {
    // The temp sibling is an existing directory, so the write fails (EISDIR)
    // and the cleanup `rm` refuses to delete a directory — the original
    // failure must still be the reported one.
    const target = join(workspace, 'occupied.txt')
    const tmp = `${target}.dsh-sidebar-tmp-${process.pid}`
    mkdirSync(tmp)
    const recorded = await invokeApi(routeOf(mounted, '/sidebar/api'), 'fs.write', { sessionId: 'w', path: target, content: 'x' })
    expect(apiOutcome(recorded)).toMatchObject({ ok: false, status: 400, error: { code: 'fs-error' } })
    expect((apiOutcome(recorded).error?.message ?? '')).toContain('cannot write')
    expect(existsSync(tmp)).toBe(true)
  })
})

describe('browser probe timeout', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-edges-probe-'))
  const mounted = mount(() => ({ header: { cwd: workspace } }))

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('aborts a probe whose response never arrives and reports it unreachable', async () => {
    vi.useFakeTimers()
    let aborted = false
    const fetchMock = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const pending = invokeApi(routeOf(mounted, '/sidebar/api'), 'browser.probe', { url: 'https://never-answers.example/' })
      await vi.advanceTimersByTimeAsync(8_000)
      const recorded = await pending
      expect(aborted).toBe(true)
      expect(apiOutcome(recorded).value).toEqual({ reachable: false })
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
