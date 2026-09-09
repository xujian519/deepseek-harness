/**
 * Terminal stream coverage: the three streaming endpoints are exercised
 * through their route handlers directly, covering the trust fences, the
 * attach contracts (?uuid / ?sessionId+?tab / missing parameters), transcript
 * replay, the control frames (resize, park, close), input forwarding, the
 * exited-terminal notice, agent-terminal pumps, the agent-terminals push
 * feed, the agent-opens replay queue, and the degraded mode (node-pty
 * unavailable) responses. Each mount tears the plugin down through the
 * registration effects, which disposes every spawned shell.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { SIDEBAR_PREFS_NS } from '../src/config.ts'
import { PTY_DEPS_MISSING } from '../src/pty-deps.ts'
import { loadNodePty, resetNodePtyCache } from '../src/pty-deps.ts'
import type { SidebarHttpRequest, SidebarWebStreamingRoute } from '../src/context-types.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

const testShell = (): string => (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')

// Pin the UI-tab registry's shell chain too: defaultShell() reads env.SHELL,
// and the host user's interactive shell makes transcript timing nondeterministic.
if (process.platform !== 'win32') process.env.SHELL = '/bin/sh'

/** Wait until `poll` resolves true, or throw after the deadline. */
async function until(poll: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await poll()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition not reached before the deadline')
}

/** A settings service with a mutable prefs object and a captured watcher. */
function settingsService(prefs: Record<string, unknown>) {
  const watchers: Array<() => void> = []
  return {
    watchers,
    service: {
      register: () => ({
        get: () => ({ agentTerminalTools: false, agentOpenTools: false, ...prefs }),
        watch: (callback: () => void) => { watchers.push(callback); return () => {} },
        update: async () => {},
        replace: async () => {},
      }),
      describe: () => [{ ns: SIDEBAR_PREFS_NS, value: { tabsEnabled: {}, viewersEnabled: {}, ...prefs }, applies: 'live' as const, revision: 0 }],
      update: async () => {},
    },
  }
}

interface Mounted {
  streams: SidebarWebStreamingRoute[]
  tools: ToolDefinition[]
  cleanup: () => void
  workspace: string
}

interface MountOptions {
  workspace?: string
  prefs?: Record<string, unknown>
  config?: { reconnectGraceMs?: number }
  /** Sessions whose header carries NO cwd: the client cwd decides. */
  headerlessCwd?: boolean
}

/** Mount the plugin and capture its streaming route handlers. */
function mountUpgrades(opts: MountOptions = {}): Mounted {
  const streams: SidebarWebStreamingRoute[] = []
  const tools: ToolDefinition[] = []
  const cleanups: Array<() => void> = []
  const settings = settingsService(opts.prefs ?? {})
  const ctx = {
    webRuntime: { trustedHosts: ['127.0.0.1'] },
    webServer: {
      register: () => () => {},
      registerUpgrade: () => () => {},
      registerStream: (route: SidebarWebStreamingRoute) => { streams.push(route); return () => {} },
    },
    sessions: { get: () => ({ header: opts.headerlessCwd === true ? {} : { cwd: opts.workspace ?? process.cwd() } }) },
    tools: { register: (tool: unknown) => { tools.push(tool as ToolDefinition); return () => {} } },
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    },
    inject: (deps: readonly string[], callback: (sctx: { settings: unknown }) => void) => {
      if (deps.includes('settings')) callback({ settings: settings.service })
      return () => {}
    },
    get: () => undefined,
    on: () => () => {},
  }
  const workspace = opts.workspace ?? mkdtempSync(join(tmpdir(), 'dsh-sidebar-ws-'))
  apply(ctx as never, opts.config)
  return {
    streams,
    tools,
    workspace,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup()
    },
  }
}

/** A request-body input queue: the test feeds client→host input frames, the
 *  stream handler drains them via the req async iterator. */
function bodyInput(): {
  write(d: string | Uint8Array): void
  end(): void
  iterable: AsyncIterable<string | Uint8Array>
} {
  const queue: Array<string | Uint8Array> = []
  let ended = false
  let wake: (() => void) | undefined
  const kick = (): void => { if (wake !== undefined) { const w = wake; wake = undefined; w() } }
  return {
    write(d) { queue.push(d); kick() },
    end() { ended = true; kick() },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<string | Uint8Array>> => {
          for (;;) {
            if (queue.length > 0) return { done: false, value: queue.shift()! }
            if (ended) return { done: true, value: undefined }
            await new Promise<void>((r) => { wake = r })
          }
        },
      }),
    },
  }
}

/** Build a `SidebarHttpRequest` from a URL and a body iterable. */
function mkRequest(url: string, iterable: AsyncIterable<string | Uint8Array>): SidebarHttpRequest {
  const u = new URL(url, 'http://dsh.internal')
  return {
    url: `${u.pathname}${u.search}`,
    method: 'POST',
    headers: { host: '127.0.0.1' },
    [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
  }
}

/** Buffers a response body and exposes incremental reads and a raw capture. */
class StreamCollector {
  private readonly chunks: string[] = []
  private done = false
  private wake: (() => void) | undefined
  private readonly decoder = new TextDecoder()
  constructor(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          this.chunks.push(this.decoder.decode(value, { stream: true }))
        }
      } catch {
        // A client abort is a normal stream end for these transports.
      } finally {
        this.done = true
        this.kick()
      }
    })()
  }
  private kick(): void { if (this.wake !== undefined) { const w = this.wake; this.wake = undefined; w() } }
  async next(): Promise<string> {
    for (;;) {
      if (this.chunks.length > 0) return this.chunks.shift()!
      if (this.done) return ''
      await new Promise<void>((r) => { this.wake = r })
    }
  }
  all(): string { return this.chunks.join('') }
  seen(): string[] { return [...this.chunks] }
  closed(): boolean { return this.done }
}

/** One open stream route: drives the handler directly (no HTTP server) and
 *  exposes the input body writer plus the output collector. */
interface OpenStream {
  status: number
  write(d: string | Uint8Array): void
  end(): void
  /** The next raw output chunk (terminal data). */
  next(): Promise<string>
  /** The next newline-delimited JSON payload (push feeds). */
  readJson(): Promise<unknown>
  all(): string
  seen(): string[]
  closed(): boolean
}

async function openStream(route: SidebarWebStreamingRoute, url: string): Promise<OpenStream> {
  const body = bodyInput()
  const req = mkRequest(url, body.iterable)
  const response = await route.handler(req)
  const collector = new StreamCollector(response.body ?? new ReadableStream())
  let lineBuffer = ''
  return {
    status: response.status,
    write: (d) => { body.write(d) },
    end: () => { body.end() },
    next: () => collector.next(),
    readJson: async () => {
      for (;;) {
        const newline = lineBuffer.indexOf('\n')
        if (newline !== -1) {
          const line = lineBuffer.slice(0, newline)
          lineBuffer = lineBuffer.slice(newline + 1)
          return JSON.parse(line) as unknown
        }
        const more = await collector.next()
        if (more === '') return JSON.parse(lineBuffer) as unknown
        lineBuffer += more
      }
    },
    all: () => collector.all(),
    seen: () => collector.seen(),
    closed: () => collector.closed(),
  }
}

const toolOf = (tools: ToolDefinition[], name: string): ToolDefinition => {
  const found = tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not registered`)
  return found
}

const toolExec = (sessionId: string): ToolRunContext =>
  ({ signal: { throwIfAborted: () => {}, aborted: false }, agent: { session: { id: sessionId } } }) as unknown as ToolRunContext

describe('upgrade trust fences', () => {
  it('answers 403 for untrusted hosts on all three endpoints', async () => {
    const mounted = mountUpgrades()
    try {
      for (const route of mounted.streams) {
        const req = mkRequest(`${route.path}?sessionId=s&tab=t`, bodyInput().iterable)
        req.headers = { host: 'evil.example' }
        const response = await route.handler(req)
        expect(response.status, route.path).toBe(403)
      }
    } finally {
      mounted.cleanup()
    }
  })
})

describe('UI-tab terminal stream', () => {
  const mounted = mountUpgrades({ config: { reconnectGraceMs: 30_000 } })
  const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!

  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  it('answers 400 when neither uuid nor sessionId+tab are supplied', async () => {
    const stream = await openStream(terminal, '/sidebar/ws/terminal')
    expect(stream.status).toBe(400)
  })

  it('answers 500 when the attach cwd cannot be resolved', async () => {
    const headerless = mountUpgrades({ headerlessCwd: true })
    try {
      const stream = await openStream(
        headerless.streams.find(route => route.path === '/sidebar/ws/terminal')!,
        `/sidebar/ws/terminal?sessionId=s&tab=t&cwd=${encodeURIComponent('relative/cwd')}`,
      )
      expect(stream.status).toBe(500)
    } finally {
      headerless.cleanup()
    }
  })

  it('replays the transcript on reconnect and pumps input, resize, and raw frames', async () => {
    const url = '/sidebar/ws/terminal?sessionId=pump&tab=t1'
    const marker = `echo cov-ws-${Date.now()}`
    // First connection: run a marker command and wait for its echo, which
    // guarantees the marker is inside the retained transcript.
    const first = await openStream(terminal, url)
    first.write(`${marker}\r`)
    const markerOutput = marker.slice('echo '.length)
    await until(() => first.seen().some(text => text.includes(markerOutput)))
    first.end()

    // Reconnect: the marker replays before any live data.
    const second = await openStream(terminal, url)
    const replay = await second.next()
    expect(replay).toContain(marker)

    // Input is forwarded verbatim to the shell; the command echoes back.
    second.write(`echo cov-live-input-${Date.now()}\r`)
    await until(() => second.seen().some(text => text.includes('cov-live-input')))
    // A resize control frame resizes the pty; an unrecognized JSON control is
    // forwarded as input; a JSON `null` body is raw input.
    second.write(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    second.write(JSON.stringify({ type: 'future-control', x: 1 }))
    second.write('null')
    await new Promise(resolve => setTimeout(resolve, 100))
    second.end()
  }, 20_000)

  it('announces the exit code when the shell leaves and drops later input', async () => {
    const stream = await openStream(terminal, '/sidebar/ws/terminal?sessionId=exiter&tab=t1')
    stream.write('exit 5\r')
    await until(() => stream.all().includes('[process exited with code 5]'))
    // Input after exit is dropped (the pty is gone); nothing may crash.
    stream.write('ignored\r')
    stream.write(JSON.stringify({ type: 'close' }))
    await new Promise(resolve => setTimeout(resolve, 100))
    stream.end()
  }, 20_000)

  it('keeps a parked pty out of the reconnect countdown (park frame)', async () => {
    const url = '/sidebar/ws/terminal?sessionId=parker&tab=t1'
    const marker = `echo parker-${Date.now()}`
    const first = await openStream(terminal, url)
    first.write(`${marker}\r`)
    await until(() => first.seen().some(text => text.includes(marker.slice('echo '.length))))
    first.write(JSON.stringify({ type: 'park' }))
    await new Promise(resolve => setTimeout(resolve, 100))
    first.end()
    // A parked pty survives the bare body end: a reconnect replays the SAME
    // shell's transcript (the marker is still there) instead of respawning.
    const second = await openStream(terminal, url)
    const replay = await second.next()
    expect(replay).toContain(marker)
    second.end()
  }, 20_000)

  it('spawns with the settings-page shell overrides and reports the exit', async () => {
    if (process.platform === 'win32') return
    const overrideMounted = mountUpgrades({ prefs: { terminalShell: testShell(), terminalShellArgs: '--version' } })
    try {
      const override = overrideMounted.streams.find(route => route.path === '/sidebar/ws/terminal')!
      const stream = await openStream(override, '/sidebar/ws/terminal?sessionId=shellover&tab=t1')
      await until(() => stream.all().includes('[process exited with code'))
      stream.end()
    } finally {
      overrideMounted.cleanup()
    }
  }, 20_000)
})

describe('agent terminal stream', () => {
  const mounted = mountUpgrades({ prefs: { agentTerminalTools: true, terminalShell: testShell() } })
  const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!

  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  /** Create one agent terminal through the model-facing tool. */
  const createTerminal = async (command: string): Promise<string> => {
    const result = await toolOf(mounted.tools, 'terminal_create').execute(
      { title: 'ws agent', command },
      toolExec('agent-ws'),
    ) as { uuid: string }
    return result.uuid
  }

  it('answers 404 for an unknown uuid', async () => {
    const stream = await openStream(terminal, '/sidebar/ws/terminal?uuid=missing-uuid')
    expect(stream.status).toBe(404)
  })

  it('replays the transcript and pumps the agent pty (input, resize, close frame)', async () => {
    const uuid = await createTerminal('echo cov-agent-replay')
    // Wait for output so the attach replays a non-empty transcript.
    await until(async () => (await registryTranscript(uuid)).includes('cov-agent-replay'))
    const stream = await openStream(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
    const replay = await stream.next()
    expect(replay).toContain('cov-agent-replay')
    // Raw input reaches the pty; resize frames are clamped and applied;
    // the close frame kills the pty immediately.
    stream.write('echo agent-live-input\r')
    stream.write(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }))
    await until(() => stream.all().includes('agent-live-input'))
    stream.write(JSON.stringify({ type: 'close' }))
    await until(async () => (await registryClosed(uuid)))
    stream.end()
  }, 20_000)

  it('drops unrecognized JSON controls and survives a bare body end until a close frame', async () => {
    const uuid = await createTerminal('sleep 30')
    const stream = await openStream(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
    await new Promise(resolve => setTimeout(resolve, 200))
    // Unrecognized control: dropped (never forwarded as input to the pty).
    stream.write(JSON.stringify({ type: 'future-control' }))
    stream.write(JSON.stringify({ type: 'resize', cols: 'wide', rows: 30 }))
    stream.end()
    // A bare body end leaves the agent pty alive (the agent owns the
    // lifetime): the same uuid reattaches with the full transcript replayed.
    const reattach = await openStream(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
    expect(reattach.status).toBe(200)
    reattach.end()
    // Only the close FRAME kills the agent pty.
    const killer = await openStream(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
    killer.write(JSON.stringify({ type: 'close' }))
    await until(async () => (await registryClosed(uuid)))
    killer.end()
  }, 20_000)

  /** Registry-internal state, reachable through the model-facing tools. */
  async function registryTranscript(uuid: string): Promise<string> {
    const read = toolOf(mounted.tools, 'terminal_read')
    const page = await read.execute({ uuid, count: 500 }, toolExec('agent-ws')) as { text: string }
    return page.text
  }
  /** A close frame kills the pty and drops the handle: the uuid leaves the list. */
  async function registryClosed(uuid: string): Promise<boolean> {
    const list = toolOf(mounted.tools, 'terminal_list')
    const rows = await list.execute({}, toolExec('agent-ws')) as Array<{ uuid: string; exited: boolean }>
    return !rows.some(candidate => candidate.uuid === uuid)
  }
})

describe('agent-terminals push stream', () => {
  const mounted = mountUpgrades({ prefs: { agentTerminalTools: true, terminalShell: testShell() } })

  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  it('pushes the initial list and every later change to the attached view', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-terminals')!
    const stream = await openStream(route, '/sidebar/ws/agent-terminals?sessionId=pushy')
    const initial = await stream.readJson() as Array<unknown>
    expect(initial).toEqual([])
    // Creating a terminal fires a registry change → a fresh push.
    await toolOf(mounted.tools, 'terminal_create').execute(
      { title: 'pushed', command: '' },
      toolExec('pushy'),
    )
    const update = await stream.readJson() as Array<{ uuid: string; title: string }>
    expect(update).toHaveLength(1)
    expect(update[0]!.title).toBe('pushed')
    stream.end()
  }, 20_000)
})

describe('agent-opens push stream', () => {
  const mounted = mountUpgrades({ prefs: { agentOpenTools: true } })

  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  it('answers 400 without a sessionId', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-opens')!
    const stream = await openStream(route, '/sidebar/ws/agent-opens')
    expect(stream.status).toBe(400)
  })

  it('replays queued opens on attach and delivers later opens live', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-opens')!
    const open = toolOf(mounted.tools, 'sidebar_open')
    const queued = await open.execute({ target: '/tmp' }, toolExec('opens')) as { delivered: boolean }
    expect(queued.delivered).toBe(false)
    const stream = await openStream(route, '/sidebar/ws/agent-opens?sessionId=opens')
    const replay = await stream.readJson() as { kind: string; target: string }
    expect(replay.kind).toBe('folder')
    // A later open is delivered immediately to the attached view.
    const live = await open.execute({ target: '/tmp' }, toolExec('opens')) as { delivered: boolean }
    expect(live.delivered).toBe(true)
    const second = await stream.readJson() as { kind: string }
    expect(second.kind).toBe('folder')
    stream.end()
    // After the view detaches, opens queue again.
    const requeued = await open.execute({ target: '/tmp' }, toolExec('opens')) as { delivered: boolean }
    expect(requeued.delivered).toBe(false)
  }, 20_000)

  it('detaches the view on an abrupt stream cancel', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-opens')!
    const body = bodyInput()
    const response = await route.handler(mkRequest('/sidebar/ws/agent-opens?sessionId=abrupt', body.iterable))
    expect(response.status).toBe(200)
    // No opens are queued for a fresh session, so the attach pushes nothing;
    // cancel the body (an abrupt client disconnect) then queue again.
    await response.body?.cancel()
    // The view is detached: opens queue rather than deliver.
    const open = toolOf(mounted.tools, 'sidebar_open')
    const after = await open.execute({ target: '/tmp' }, toolExec('abrupt')) as { delivered: boolean }
    expect(after.delivered).toBe(false)
  }, 20_000)
})

describe('degraded mode (node-pty unavailable)', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ws-degraded-'))
  let mounted: Mounted

  beforeAll(() => {
    // Poison the loader cache so apply() degrades exactly like a broken
    // install; restored after the assertions.
    resetNodePtyCache()
    loadNodePty(() => { throw new Error('simulated broken node-pty install') })
    mounted = mountUpgrades({ workspace, prefs: { agentTerminalTools: true, terminalShell: testShell() } })
  })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
    resetNodePtyCache()
    expect(loadNodePty()).not.toBeNull()
  })

  it('refuses UI-tab terminals with the deps-missing marker', async () => {
    const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!
    const stream = await openStream(terminal, '/sidebar/ws/terminal?sessionId=s&tab=t1')
    expect(stream.status).toBe(503)
    await until(() => stream.all().includes(PTY_DEPS_MISSING))
  })

  it('refuses agent terminals like missing uuids', async () => {
    const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!
    const stream = await openStream(terminal, '/sidebar/ws/terminal?uuid=any')
    expect(stream.status).toBe(404)
  })

  it('pushes the honest empty terminal list', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-terminals')!
    const stream = await openStream(route, '/sidebar/ws/agent-terminals?sessionId=s')
    const initial = await stream.readJson() as unknown[]
    expect(initial).toEqual([])
    stream.end()
  })

  it('never registers the terminal tools in degraded mode', () => {
    expect(mounted.tools.map(tool => tool.name)).toEqual([])
  })
})
