/**
 * Side-card settings and tool-gate coverage: a deployment whose settings
 * service carries no sidebar descriptor (schema defaults in effect), the
 * settings commit that re-evaluates both model-facing tool gates, the
 * terminal shell overrides read from a missing settings document, and the
 * `sidebar_open` preference fallback when the namespace resolves no value.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import type { SidebarWebRoute } from '../src/context-types.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

interface Mounted {
  routes: SidebarWebRoute[]
  tools: ToolDefinition[]
  /** Fire the registered settings watcher (one settings commit). */
  commit(): void
  cleanup: () => void
}

/**
 * Mount the plugin with a settings service that registers the side-card
 * namespace but reports NO descriptor: `describe()` returns an empty
 * document set, exactly like a deployment whose settings document has not
 * been materialized yet.
 */
function mount(opts: { terminalTools: boolean; openTools: boolean }): Mounted {
  const routes: SidebarWebRoute[] = []
  const tools: ToolDefinition[] = []
  const cleanups: Array<() => void> = []
  const watchers: Array<() => void> = []
  const prefs = {
    agentTerminalTools: opts.terminalTools,
    agentOpenTools: opts.openTools,
    tabsEnabled: { editor: true, browser: true, terminal: true, git: true },
  }
  const settings = {
    register: () => ({
      get: () => prefs,
      watch: (callback: () => void) => { watchers.push(callback); return () => {} },
      update: async () => {},
      replace: async () => {},
    }),
    describe: () => [],
    update: async () => {},
  }
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: (route: SidebarWebRoute) => { routes.push(route); return () => {} },
      registerUpgrade: () => () => {},
      registerStream: () => () => {},
    },
    sessions: { get: () => undefined },
    tools: { register: (tool: unknown) => { tools.push(tool as ToolDefinition); return () => {} } },
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    },
    inject: (deps: readonly string[], callback: (sctx: { settings: unknown }) => void) => {
      if (deps.includes('settings')) callback({ settings })
      return () => {}
    },
    get: () => undefined,
    on: () => () => {},
  }
  apply(ctx as never, undefined)
  return {
    routes,
    tools,
    commit: () => { for (const watcher of watchers) watcher() },
    cleanup: () => { for (const cleanup of cleanups) cleanup() },
  }
}

const routeOf = (mounted: Mounted, path: string): SidebarWebRoute => {
  const route = mounted.routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} was not registered`)
  return route
}

const toolOf = (mounted: Mounted, name: string): ToolDefinition => {
  const tool = mounted.tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`tool ${name} was not registered`)
  return tool
}

const exec = (sessionId: string): ToolRunContext =>
  ({ signal: { throwIfAborted: () => {}, aborted: false }, agent: { session: { id: sessionId } } }) as unknown as ToolRunContext

/** POST one JSON payload to the /sidebar/api route. */
async function invoke(route: SidebarWebRoute, method: string, payload: unknown): Promise<{ ok: boolean; value?: unknown }> {
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
  return JSON.parse(out.body) as { ok: boolean; value?: unknown }
}

describe('settings without a sidebar descriptor', () => {
  it('reports the schema defaults and keeps the tools gated on the live prefs', async () => {
    const mounted = mount({ terminalTools: true, openTools: true })
    try {
      const read = await invoke(routeOf(mounted, '/sidebar/api'), 'settings.get', {})
      expect(read.value).toEqual({ value: undefined, revision: undefined, externalDisable: false })
      // Both gates already ran at activation; committing the same prefs again
      // must not re-register the tools.
      expect(mounted.tools).toHaveLength(9)
      mounted.commit()
      expect(mounted.tools).toHaveLength(9)
      expect(mounted.tools.filter(tool => tool.name === 'sidebar_open')).toHaveLength(1)
    } finally {
      mounted.cleanup()
    }
  })

  it('spawns an agent terminal with the default shell when no settings document exists', async () => {
    const mounted = mount({ terminalTools: true, openTools: false })
    try {
      const created = await toolOf(mounted, 'terminal_create').execute({ title: 'no-prefs', command: 'exit 0' }, exec('s1')) as { uuid: string }
      expect(created.uuid).toMatch(/^[0-9a-f-]{36}$/)
      const list = await toolOf(mounted, 'terminal_list').execute({}, exec('s1')) as Array<{ uuid: string }>
      expect(list.map(entry => entry.uuid)).toContain(created.uuid)
    } finally {
      mounted.cleanup()
    }
  }, 20_000)

  it('opens a file through the side-card defaults when the namespace resolves no value', async () => {
    const mounted = mount({ terminalTools: false, openTools: true })
    try {
      const opened = await toolOf(mounted, 'sidebar_open').execute({ target: '/tmp' }, exec('s1')) as { kind: string; delivered: boolean }
      expect(opened.kind).toBe('folder')
      expect(opened.delivered).toBe(false)
    } finally {
      mounted.cleanup()
    }
  })
})
