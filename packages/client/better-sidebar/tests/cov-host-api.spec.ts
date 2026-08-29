/**
 * Host API-route coverage for the branches the behavior specs do not reach:
 * session-cwd resolution edges, fs read/write/search shapes (binary, missing,
 * unreadable, failing writes), every git method end to end against a scratch
 * repository, the optional-service wrappers (agent-pty.close, terminal.deps,
 * jobs, subagents.live), settings write failures, external opens, the browser
 * probe's loopback allowlist and GET fallback, and the raw upload, media, and
 * HTML route handlers (fence, method, parameter, size, and content-type
 * branches).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { anyString } from './matchers.ts'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { apply } from '../src/index.ts'
import { SIDEBAR_PREFS_NS } from '../src/config.ts'
import { encodeHtmlUrl } from '../src/html-route.ts'
import type { SidebarWebRoute, SidebarWebUpgradeRoute } from '../src/context-types.ts'
import type { SidebarConfig } from '../src/index.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-better-sidebar-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-better-sidebar-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

/** Run a fixture git command with the scratch identity. */
function gitRun(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout
}

/** A settings service whose describe() exposes the given sidebar prefs. */
function settingsService(prefs: Record<string, unknown> | undefined, updateImpl?: () => Promise<void>): unknown {
  return {
    register: () => ({
      get: () => ({ agentTerminalTools: false, agentOpenTools: false, ...prefs }),
      watch: () => () => {},
      update: async () => {},
      replace: async () => {},
    }),
    describe: () => prefs === undefined
      ? []
      : [{ ns: SIDEBAR_PREFS_NS, value: prefs, applies: 'live' as const, revision: 0 }],
    update: updateImpl ?? (async () => {}),
  }
}

interface MountOptions {
  sessions?: (id: string) => { header: { cwd?: string }; events?: unknown[] } | undefined
  sessionPersistence?: unknown
  jobs?: unknown
  agents?: unknown
  subagents?: unknown
  settings?: unknown
  config?: SidebarConfig
}

interface Mounted {
  routes: SidebarWebRoute[]
  upgrades: SidebarWebUpgradeRoute[]
  cleanup: () => void
}

/** Mount the plugin against a fake context and return the captured routes. */
function mount(opts: MountOptions = {}): Mounted {
  const routes: SidebarWebRoute[] = []
  const upgrades: SidebarWebUpgradeRoute[] = []
  const cleanups: Array<() => void> = []
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: (route: SidebarWebRoute) => { routes.push(route); return () => {} },
      registerUpgrade: (route: SidebarWebUpgradeRoute) => { upgrades.push(route); return () => {} },
    },
    sessions: { get: opts.sessions ?? (() => undefined) },
    tools: { register: () => () => {} },
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    },
    inject: (deps: readonly string[], callback: (sctx: { settings: unknown }) => void) => {
      if (deps.includes('settings') && opts.settings !== undefined) callback({ settings: opts.settings })
      return () => {}
    },
    get: (key: string) =>
      key === 'sessionPersistence' ? opts.sessionPersistence
        : key === 'jobs' ? opts.jobs
          : key === 'agents' ? opts.agents
            : key === 'subagents' ? opts.subagents
              : undefined,
    // The jobs mirror subscribes to the session feed; a no-op keeps it inert.
    on: () => () => {},
  }
  apply(ctx as never, opts.config)
  return {
    routes,
    upgrades,
    cleanup: () => { for (const cleanup of cleanups) cleanup() },
  }
}

const routeOf = (mounted: Mounted, path: string): SidebarWebRoute => {
  const route = mounted.routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} was not registered`)
  return route
}

/** POST one JSON payload to the /sidebar/api route. */
async function invoke(route: SidebarWebRoute, method: string, payload: unknown, headers: Record<string, string> = { host: '127.0.0.1:3080' }): Promise<{ ok: boolean; status: number; value?: unknown; error?: { code?: string; message: string } }> {
  const body = Buffer.from(JSON.stringify(payload))
  const req = {
    method: 'POST',
    url: `/sidebar/api/${method}`,
    headers,
    [Symbol.asyncIterator]: async function* () { yield body },
  }
  const out: { status: number; body: string } = { status: 200, body: '' }
  const res = {
    writeHead: (status: number) => { out.status = status },
    end: (chunk?: string | Uint8Array) => { out.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? '').toString('utf8') },
  }
  await route.handler(req, res as never)
  return { ...JSON.parse(out.body) as Record<string, unknown>, status: out.status } as never
}

/** GET a raw URL against any route handler. */
async function invokeGet(route: SidebarWebRoute, url: string, method = 'GET', headers: Record<string, string> = { host: '127.0.0.1:3080' }): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const out: { status: number; headers: Record<string, string>; body: string } = { status: 200, headers: {}, body: '' }
  const req = { method, url, headers }
  const res = {
    writeHead: (status: number, headersRecord?: Record<string, string>) => { out.status = status; out.headers = headersRecord ?? {} },
    end: (chunk?: string | Uint8Array) => { out.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? '').toString('utf8') },
  }
  await route.handler(req as never, res as never)
  return out
}

describe('session cwd and workspace API edges', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-api-'))
  const mounted = mount({
    sessions: id => id === 'ws' ? { header: { cwd: workspace } } : undefined,
  })
  const api = routeOf(mounted, '/sidebar/api')
  const settingsless = mount()
  const settingslessApi = routeOf(settingsless, '/sidebar/api')

  afterAll(() => {
    mounted.cleanup()
    settingsless.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('reports a null parent at the filesystem root', async () => {
    const result = await invoke(api, 'session.cwd', { sessionId: 'any', cwd: '/' })
    expect(result).toMatchObject({ ok: true, value: { cwd: resolvePath('/'), parent: null, root: '/' } })
  })

  it('treats a blank client cwd as absent (falls back to the process cwd)', async () => {
    const result = await invoke(api, 'session.cwd', { sessionId: 'ghost', cwd: '' })
    expect(result.value).toMatchObject({ cwd: process.cwd() })
  })

  it('lists the session cwd when no path is given', async () => {
    writeFileSync(join(workspace, 'visible.txt'), 'x')
    const result = await invoke(api, 'fs.tree', { sessionId: 'ws' })
    expect(result.ok).toBe(true)
    expect((result.value as { entries: Array<{ name: string }> }).entries.some(entry => entry.name === 'visible.txt')).toBe(true)
  })

  it('searches workspace file names from the session cwd', async () => {
    const result = await invoke(api, 'fs.search', { sessionId: 'ws', query: 'visible' })
    expect(result.value).toMatchObject({ matches: ['visible.txt'], truncated: false })
  })

  it('reads a workspace-relative path (git-derived names stay in the session)', async () => {
    const result = await invoke(api, 'fs.read', { sessionId: 'ws', path: 'visible.txt' })
    expect(result.value).toMatchObject({ kind: 'text', truncated: false })
  })

  it('returns a binary head for NUL-bearing files', async () => {
    writeFileSync(join(workspace, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]))
    const result = await invoke(api, 'fs.read', { sessionId: 'ws', path: join(workspace, 'blob.bin') })
    expect(result.value).toMatchObject({ kind: 'binary', size: 3 })
    expect((result.value as { head: string }).head).toBe(Buffer.from([0x00, 0x01, 0x02]).toString('base64'))
  })

  it('reports missing files, directories, and unreadable files as fs errors', async () => {
    const missing = await invoke(api, 'fs.read', { sessionId: 'ws', path: join(workspace, 'nope.txt') })
    expect(missing).toMatchObject({ ok: false, status: 400, error: { code: 'fs-error' } })
    const directory = await invoke(api, 'fs.read', { sessionId: 'ws', path: workspace })
    expect(directory).toMatchObject({ ok: false, status: 400, error: { message: anyString('is a directory') } })
    const locked = join(workspace, 'locked.txt')
    writeFileSync(locked, 'secret')
    chmodSync(locked, 0o000)
    try {
      const unreadable = await invoke(api, 'fs.read', { sessionId: 'ws', path: locked })
      expect(unreadable).toMatchObject({ ok: false, status: 400, error: { code: 'fs-error' } })
    } finally {
      chmodSync(locked, 0o600)
    }
  })

  it('writes files atomically and cleans up after failed writes', async () => {
    const ok = await invoke(api, 'fs.write', { sessionId: 'ws', path: join(workspace, 'written.txt'), content: 'written' })
    expect(ok).toMatchObject({ ok: true })
    expect(readFileSync(join(workspace, 'written.txt'), 'utf8')).toBe('written')
    // The parent is a regular file: mkdir fails and the error is a fs error.
    const failed = await invoke(api, 'fs.write', { sessionId: 'ws', path: join(workspace, 'visible.txt', 'child.txt'), content: 'x' })
    expect(failed).toMatchObject({ ok: false, status: 400, error: { code: 'fs-error' } })
  })

  it('releases pty keys and agent terminals and serves the deps status', async () => {
    expect(await invoke(api, 'pty.close', { sessionId: 's', tab: 't' })).toMatchObject({ ok: true })
    expect(await invoke(api, 'agent-pty.close', { uuid: 'no-such-uuid' })).toMatchObject({ ok: true })
    const deps = await invoke(api, 'terminal.deps', {})
    expect(deps.ok).toBe(true)
    expect(deps.value).toMatchObject({ ok: true })
  })

  it('routes jobs and subagents through the optional-service wrappers', async () => {
    const events = [{
      type: 'tool/call', seq: 0, time: 0,
      data: { name: 'job_output', callId: 'c1', arguments: JSON.stringify({ job_id: 'bash-1' }) },
    }, {
      type: 'tool/result', seq: 1, time: 1,
      data: { message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'tool-result', isError: false, content: [{ type: 'text', text: 'out' }] }] } },
    }]
    const jobsMounted = mount({
      sessions: id => id === 'jobby' ? { header: { cwd: workspace }, events } : undefined,
      jobs: { kill: () => 'requested' },
      agents: { get: (id: string) => ({ id }) },
    })
    try {
      const jobsApi = routeOf(jobsMounted, '/sidebar/api')
      expect(await invoke(jobsApi, 'jobs.output', { sessionId: 'jobby', id: 'bash-1' }))
        .toMatchObject({ ok: true, value: { text: 'out', read: true } })
      expect(await invoke(jobsApi, 'jobs.kill', { sessionId: 'jobby', id: 'bash-1' }))
        .toMatchObject({ ok: true, value: { outcome: 'requested' } })
    } finally {
      jobsMounted.cleanup()
    }
    // Without the services, kill and live degrade to 503 while output stays readable.
    expect(await invoke(api, 'jobs.kill', { sessionId: 'ws', id: 'bash-1' })).toMatchObject({ status: 503 })
    expect(await invoke(api, 'subagents.live', { rootSessionId: 'ws' })).toMatchObject({ status: 503 })
  })

  it('guards settings writes on the service presence and update failures', async () => {
    const missing = await invoke(settingslessApi, 'settings.update', { patch: { openByDefault: true } })
    expect(missing).toMatchObject({ ok: false, status: 503 })
    // The bare deployment reports the settings absence as undefined values.
    expect(await invoke(settingslessApi, 'settings.get', {})).toEqual({
      ok: true, value: { externalDisable: false }, status: 200,
    })
  })

  it('maps settings update failures to settings-rejected (Error and non-Error)', async () => {
    for (const thrown of [new Error('schema refused'), 'plain refusal']) {
      const failing = mount({ settings: settingsService({}, async () => { throw thrown }) })
      try {
        const result = await invoke(routeOf(failing, '/sidebar/api'), 'settings.update', { patch: {} })
        expect(result).toMatchObject({ ok: false, status: 400, error: { code: 'settings-rejected' } })
        expect((result.error as { message: string }).message).toBe(thrown instanceof Error ? 'schema refused' : 'plain refusal')
      } finally {
        failing.cleanup()
      }
    }
  })

  it('launches external opens for reveal, url, and rejects unknown actions', async () => {
    const reveal = await invoke(api, 'open.external', { action: 'reveal', path: workspace })
    expect(reveal).toMatchObject({ ok: true, value: { started: true } })
    const url = await invoke(api, 'open.external', { action: 'url', url: 'vscode://file/x.ts' })
    expect(url).toMatchObject({ ok: true, value: { started: true } })
    const bad = await invoke(api, 'open.external', { action: 'nope' })
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('refuses malformed and non-http(s) probe URLs', async () => {
    const invalid = await invoke(api, 'browser.probe', { url: 'not a url at all' })
    expect(invalid).toMatchObject({ ok: false, error: { code: 'bad-request', message: 'invalid url' } })
  })

  it('honors the loopback allowlist from the side card prefs', async () => {
    const allowed = mount({
      settings: settingsService({ browserAllowedLoopback: 'localhost, 127.0.0.1:8443, MyHost' }),
    })
    try {
      const probeApi = routeOf(allowed, '/sidebar/api')
      const respond = (status: number, headers: Record<string, string>): Response =>
        ({ status, url: 'https://target.example/', headers: new Headers(headers), body: null }) as unknown as Response
      const fetchMock = vi.fn(async () => respond(200, {}))
      vi.stubGlobal('fetch', fetchMock)
      try {
        // Bare hosts match every port; host:port entries match exactly.
        for (const target of ['http://localhost:9999/', 'http://127.0.0.1:8443/']) {
          const result = await invoke(probeApi, 'browser.probe', { url: target })
          expect(result, target).toMatchObject({ ok: true, value: { reachable: true } })
        }
        for (const target of ['http://127.0.0.1:9/', 'http://[::1]/']) {
          const result = await invoke(probeApi, 'browser.probe', { url: target })
          expect(result, target).toMatchObject({ ok: false, error: { message: 'local addresses are not probed' } })
        }
      } finally {
        vi.unstubAllGlobals()
      }
    } finally {
      allowed.cleanup()
    }
  })

  it('retries a bare HEAD as GET when no embed signals are present', async () => {
    const respond = (status: number, headers: Record<string, string>): Response =>
      ({ status, url: 'https://target.example/final', headers: new Headers(headers), body: { cancel: () => {} } }) as unknown as Response
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond(200, {}))
      .mockResolvedValueOnce(respond(200, { 'x-frame-options': 'DENY' }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await invoke(api, 'browser.probe', { url: 'https://target.example/' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.value).toEqual({ reachable: true, url: 'https://target.example/final', status: 200, xFrameOptions: 'DENY' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('api route guards: method, unknown paths, and malformed method names', async () => {
    expect((await invokeGet(api, '/sidebar/api/session.cwd', 'GET')).status).toBe(405)
    expect((await invokeGet(api, '/not-the-api/session.cwd', 'POST')).status).toBe(404)
    expect((await invokeGet(api, '/sidebar/api/a/b', 'POST')).status).toBe(404)
    const unknown = await invoke(api, 'no.such.method', {})
    expect(unknown).toMatchObject({ ok: false, status: 404, error: { message: anyString('unknown sidebar API method') } })
  })
})

describe('git API methods against a scratch repository', () => {
  const repo = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitapi-'))
  const mounted = mount({ sessions: () => ({ header: { cwd: repo } }) })
  const api = routeOf(mounted, '/sidebar/api')
  // The API's git spawn uses the ambient identity; pin a scratch one for the
  // commit-bearing requests (confined to this suite's process env).
  let previousIdentity: Record<string, string | undefined>

  beforeAll(() => {
    previousIdentity = {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
    }
    Object.assign(process.env, IDENTITY)
    gitRun(repo, ['init', '-q'])
    gitRun(repo, ['checkout', '-q', '-b', 'main'])
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n')
    gitRun(repo, ['add', '-A'])
    gitRun(repo, ['commit', '-q', '-m', 'base'])
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(previousIdentity)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    mounted.cleanup()
    rmSync(repo, { recursive: true, force: true })
  })

  it('lists worktrees and status with an explicit (unmatched) repoRoot selection', async () => {
    const worktrees = (await invoke(api, 'git.worktrees', { sessionId: 'ws' })).value as Array<{ current: boolean; branch: string }>
    expect(worktrees).toHaveLength(1)
    expect(worktrees[0]).toMatchObject({ current: true, branch: 'main' })
    const status = (await invoke(api, 'git.status', { sessionId: 'ws', repoRoot: join(tmpdir(), 'definitely-not-a-repo') })).value as { isRepo: boolean; branch: string }
    expect(status).toMatchObject({ isRepo: true, branch: 'main' })
  })

  it('diffs the worktree and the index with session-relative paths', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\nCHANGED\nthree\n')
    const unstaged = (await invoke(api, 'git.diff', { sessionId: 'ws', path: 'a.txt', staged: false })).value as { diff: string }
    expect(unstaged.diff).toContain('+CHANGED')
    gitRun(repo, ['add', '-A'])
    const staged = (await invoke(api, 'git.diff', { sessionId: 'ws', path: 'a.txt', staged: true })).value as { diff: string }
    expect(staged.diff).toContain('-two')
  })

  it('pages the log with validated count/skip values', async () => {
    gitRun(repo, ['commit', '-q', '--allow-empty', '-m', 'second'])
    const page = await invoke(api, 'git.log', { sessionId: 'ws', count: 1, skip: 0 })
    expect((page.value as Array<{ subject: string }>)[0]!.subject).toBe('second')
    // Invalid values fall back to the defaults instead of erroring.
    const fallback = await invoke(api, 'git.log', { sessionId: 'ws', count: 'many', skip: -3 })
    expect(fallback.ok).toBe(true)
    expect((fallback.value as unknown[]).length).toBeGreaterThanOrEqual(1)
  })

  it('shows a commit diff for a recorded hash', async () => {
    const hash = gitRun(repo, ['rev-parse', 'HEAD']).trim()
    const result = (await invoke(api, 'git.commit-diff', { sessionId: 'ws', hash })).value as { diff: string }
    expect(result.diff).toContain('diff --git')
  })

  it('stages, unstages, branches, checks out, and shows revision content', async () => {
    // A worktree change relative to HEAD is what staging is for.
    writeFileSync(join(repo, 'a.txt'), 'one\nSTAGED\nthree\n')
    expect(await invoke(api, 'git.stage', { sessionId: 'ws', path: 'a.txt' })).toMatchObject({ ok: true })
    let status = await invoke(api, 'git.status', { sessionId: 'ws' })
    expect((status.value as { entries: Array<{ xy: string }> }).entries.some(entry => entry.xy === 'M ')).toBe(true)
    expect(await invoke(api, 'git.unstage', { sessionId: 'ws' })).toMatchObject({ ok: true })
    status = await invoke(api, 'git.status', { sessionId: 'ws' })
    expect((status.value as { entries: Array<{ xy: string }> }).entries.every(entry => entry.xy !== 'M ')).toBe(true)

    const branches = (await invoke(api, 'git.branch', { sessionId: 'ws' })).value as { names: Array<string>; current: string }
    expect(branches.names).toContain('main')
    gitRun(repo, ['branch', 'feature'])
    expect(await invoke(api, 'git.checkout', { sessionId: 'ws', branch: 'feature' })).toMatchObject({ ok: true })
    expect(((await invoke(api, 'git.branch', { sessionId: 'ws' })).value as { current: string }).current).toBe('feature')
    expect(await invoke(api, 'git.checkout', { sessionId: 'ws', branch: 'main' })).toMatchObject({ ok: true })

    const show = (await invoke(api, 'git.show', { sessionId: 'ws', rev: 'HEAD', path: 'a.txt' })).value as { content: string | null }
    expect(show.content).toContain('CHANGED')
    // A path the revision never had resolves to null content.
    const missing = (await invoke(api, 'git.show', { sessionId: 'ws', rev: 'HEAD', path: 'never-existed.txt' })).value as { content: string | null }
    expect(missing.content).toBeNull()
  })

  it('commits, reverts, and cherry-picks through the API', async () => {
    writeFileSync(join(repo, 'a.txt'), 'one\nFINAL\nthree\n')
    expect(await invoke(api, 'git.stage', { sessionId: 'ws' })).toMatchObject({ ok: true })
    expect(await invoke(api, 'git.commit', { sessionId: 'ws', message: 'api commit' })).toMatchObject({ ok: true })
    const top = (await invoke(api, 'git.log', { sessionId: 'ws', count: 1 })).value as Array<{ hashFull: string; subject: string }>
    expect(top[0]!.subject).toBe('api commit')
    expect(await invoke(api, 'git.revert', { sessionId: 'ws', hash: top[0]!.hashFull })).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\nCHANGED\nthree\n')

    // A commit from another branch cherry-picks onto main.
    gitRun(repo, ['checkout', '-q', '-b', 'source'])
    writeFileSync(join(repo, 'picked.txt'), 'picked\n')
    gitRun(repo, ['add', '-A'])
    gitRun(repo, ['commit', '-q', '-m', 'picked work'])
    const pickedHash = gitRun(repo, ['rev-parse', 'HEAD']).trim()
    gitRun(repo, ['checkout', '-q', 'main'])
    expect(await invoke(api, 'git.cherry-pick', { sessionId: 'ws', hash: pickedHash })).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'picked.txt'), 'utf8')).toBe('picked\n')
  })

  it('discards worktree changes through the API', async () => {
    writeFileSync(join(repo, 'a.txt'), 'discarded\n')
    expect(await invoke(api, 'git.discard', { sessionId: 'ws', path: 'a.txt' })).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\nCHANGED\nthree\n')
  })

  it('branch and checkout reject requests outside a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitapi-plain-'))
    const plainMounted = mount({ sessions: () => ({ header: { cwd: plain } }) })
    try {
      const plainApi = routeOf(plainMounted, '/sidebar/api')
      const branches = await invoke(plainApi, 'git.branch', { sessionId: 'plain' })
      expect(branches).toMatchObject({ ok: false, error: { code: 'not-repo' } })
    } finally {
      plainMounted.cleanup()
      rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('raw upload, media, and HTML routes', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-media-'))
  const mounted = mount({
    sessions: () => ({ header: { cwd: workspace } }),
    config: { mediaLimit: 16, uploadLimit: 16 },
  })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  /** POST raw bytes to a route URL (the upload shape). */
  async function postRaw(route: SidebarWebRoute, url: string, bytes: string): Promise<{ status: number; body: string }> {
    const req = {
      method: 'POST',
      url,
      headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () { yield bytes },
    }
    const out = { status: 200, body: '' }
    const res = {
      writeHead: (status: number) => { out.status = status },
      end: (chunk?: string | Uint8Array) => { out.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? '').toString('utf8') },
    }
    await route.handler(req, res as never)
    return out
  }

  it('streams an upload to disk inside the workspace', async () => {
    const upload = routeOf(mounted, '/sidebar/upload')
    const result = await postRaw(upload, `/sidebar/upload?sessionId=ws&dir=${encodeURIComponent(workspace)}&relativePath=${encodeURIComponent('docs/new.txt')}`, 'uploaded bytes')
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true, value: { path: join(workspace, 'docs', 'new.txt'), size: 14 } })
    expect(readFileSync(join(workspace, 'docs', 'new.txt'), 'utf8')).toBe('uploaded bytes')
  })

  it('rejects uploads that miss parameters, exceed the limit, or escape the workspace', async () => {
    const upload = routeOf(mounted, '/sidebar/upload')
    expect((await postRaw(upload, '/sidebar/upload?sessionId=ws&dir=' + encodeURIComponent(workspace), 'x')).status).toBe(400)
    expect((await postRaw(upload, `/sidebar/upload?sessionId=ws&dir=${encodeURIComponent(workspace)}&relativePath=${encodeURIComponent('  ')}`, 'x')).status).toBe(400)
    expect((await postRaw(upload, `/sidebar/upload?sessionId=ws&dir=${encodeURIComponent(workspace)}&relativePath=${encodeURIComponent('../out.txt')}`, 'x')).status).toBe(400)
    const outside = mkdtempSync(join(tmpdir(), 'dsh-sidebar-media-out-'))
    try {
      expect((await postRaw(upload, `/sidebar/upload?sessionId=ws&dir=${encodeURIComponent(outside)}&relativePath=x.txt`, 'x')).status).toBe(403)
      // Oversized bodies are refused without touching the target.
      expect((await postRaw(upload, `/sidebar/upload?sessionId=ws&dir=${encodeURIComponent(workspace)}&relativePath=big.txt`, 'x'.repeat(64))).status).toBe(413)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
    expect((await invokeGet(upload, '/sidebar/upload', 'POST', { host: 'evil.example' })).status).toBe(403)
    expect((await invokeGet(upload, '/sidebar/upload', 'GET')).status).toBe(405)
  })

  it('serves media files with content types and an optional download disposition', async () => {
    const media = routeOf(mounted, '/sidebar/file')
    writeFileSync(join(workspace, 'pixel.png'), Buffer.from([0x89, 0x50]))
    const ok = await invokeGet(media, `/sidebar/file?sessionId=ws&path=${encodeURIComponent(join(workspace, 'pixel.png'))}`)
    expect(ok.status).toBe(200)
    expect(ok.headers['content-type']).toBe('image/png')
    expect(ok.headers['cache-control']).toBe('no-cache')
    const download = await invokeGet(media, `/sidebar/file?sessionId=ws&path=${encodeURIComponent(join(workspace, 'pixel.png'))}&download=1`)
    expect(download.headers['content-disposition']).toContain("filename*=UTF-8''pixel.png")
  })

  it('rejects media requests that miss parameters or exceed the size cap', async () => {
    const media = routeOf(mounted, '/sidebar/file')
    expect((await invokeGet(media, '/sidebar/file')).status).toBe(400)
    writeFileSync(join(workspace, 'big.png'), 'x'.repeat(64))
    expect((await invokeGet(media, `/sidebar/file?sessionId=ws&path=${encodeURIComponent(join(workspace, 'big.png'))}`)).status).toBe(400)
    expect((await invokeGet(media, `/sidebar/file?sessionId=ws&path=${encodeURIComponent(workspace)}`)).status).toBe(400)
    expect((await invokeGet(media, '/sidebar/file', 'POST')).status).toBe(405)
    expect((await invokeGet(media, '/sidebar/file', 'GET', { host: 'evil.example' })).status).toBe(403)
  })

  it('serves non-HTML previews with their own content type and the sandbox CSP', async () => {
    const html = routeOf(mounted, '/sidebar/html')
    writeFileSync(join(workspace, 'notes.txt'), 'plain notes')
    const result = await invokeGet(html, encodeHtmlUrl('ws', join(workspace, 'notes.txt')))
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('application/octet-stream')
    expect(result.headers['content-security-policy']).toContain('sandbox')
    expect(result.headers['x-content-type-options']).toBe('nosniff')
  })

  it('rejects malformed HTML routes and oversized previews', async () => {
    const html = routeOf(mounted, '/sidebar/html')
    expect((await invokeGet(html, '/sidebar/html')).status).toBe(404)
    expect((await invokeGet(html, '/sidebar/html/ws/%zz/x.html')).status).toBe(400)
    writeFileSync(join(workspace, 'big.html'), 'x'.repeat(64))
    expect((await invokeGet(html, encodeHtmlUrl('ws', join(workspace, 'big.html')))).status).toBe(400)
    expect((await invokeGet(html, '/sidebar/html/ws/x.html', 'POST')).status).toBe(405)
    expect((await invokeGet(html, '/sidebar/html/ws/x.html', 'GET', { host: 'evil.example' })).status).toBe(403)
  })
})

describe('workspace symlink discipline on the raw routes', () => {
  it('refuses uploads whose directory resolves outside the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-upload-sym-'))
    const workspace = join(root, 'ws')
    const outside = join(root, 'out')
    mkdirSync(workspace)
    mkdirSync(outside)
    symlinkSync(outside, join(workspace, 'link'))
    const mounted = mount({ sessions: () => ({ header: { cwd: workspace } }) })
    try {
      const upload = routeOf(mounted, '/sidebar/upload')
      const req = {
        method: 'POST',
        url: `/sidebar/upload?sessionId=ws&dir=${encodeURIComponent(join(workspace, 'link'))}&relativePath=x.txt`,
        headers: { host: '127.0.0.1:3080' },
        [Symbol.asyncIterator]: async function* () { yield 'x' },
      }
      const out = { status: 200, body: '' }
      const res = {
        writeHead: (status: number) => { out.status = status },
        end: (chunk?: string | Uint8Array) => { out.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? '').toString('utf8') },
      }
      await upload.handler(req, res as never)
      expect(out.status).toBe(403)
    } finally {
      mounted.cleanup()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
