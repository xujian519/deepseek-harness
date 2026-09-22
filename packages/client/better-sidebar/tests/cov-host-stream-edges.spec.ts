/**
 * Streaming-endpoint edges the behavior specs do not reach: byte frames
 * (Uint8Array input), requests without a URL, the transport lifecycle
 * (body end, body error, client cancel, and the output dropped once the
 * renderer stops reading), the push streams' error subscriptions, input to
 * an agent terminal that already exited, and an attach whose pty spawn fails
 * with a non-Error.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { SIDEBAR_PREFS_DEFAULTS } from '../src/prefs-shared.ts'
import { loadNodePty, resetNodePtyCache } from '../src/pty-deps.ts'
import type { SidebarHttpRequest, SidebarWebStreamingRoute } from '../src/context-types.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

const testShell = (): string => (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')

// Pin the UI-tab registry's shell chain: defaultShell() reads env.SHELL, and
// the host user's interactive shell makes transcript timing nondeterministic.
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

/** A settings service carrying the entry's settings form. */
function settingsService() {
  return {
    describe: () => [{ ns: 'better-sidebar', value: { prefs: {} }, applies: 'live' as const, revision: 0 }],
    update: async () => {},
  }
}

interface Mounted {
  streams: SidebarWebStreamingRoute[]
  tools: ToolDefinition[]
  cleanup: () => void
  workspace: string
}

/** Mount the plugin and capture its streaming route handlers. */
function mountUpgrades(opts: { workspace?: string; prefs?: Record<string, unknown> } = {}): Mounted {
  const streams: SidebarWebStreamingRoute[] = []
  const tools: ToolDefinition[] = []
  const cleanups: Array<() => void> = []
  const settings = settingsService()
  const ctx = {
    fiber: {},
    webRuntime: { trustedHosts: ['127.0.0.1'] },
    webServer: {
      register: () => () => {},
      registerUpgrade: () => () => {},
      registerStream: (route: SidebarWebStreamingRoute) => { streams.push(route); return () => {} },
    },
    sessions: { get: () => ({ header: { cwd: opts.workspace ?? process.cwd() } }) },
    tools: { register: (tool: unknown) => { tools.push(tool as ToolDefinition); return () => {} } },
    effect: (fn: () => unknown) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    },
    inject: (deps: readonly string[], callback: (sctx: {
      settings: unknown
      configEditor: unknown
      on: (event: string, listener: (ns: string, revision: number) => void) => () => void
    }) => void) => {
      if (deps.includes('settings') && deps.includes('configEditor')) {
        callback({
          settings,
          configEditor: { entries: () => [{ fiber: ctx.fiber, options: { id: 'better-sidebar' } }] },
          // The injected settings context owns the document feed; a no-op
          // keeps the gate subscription inert here.
          on: () => () => {},
        })
      }
      return () => {}
    },
    get: () => undefined,
  }
  const workspace = opts.workspace ?? mkdtempSync(join(tmpdir(), 'dsh-sidebar-stream-'))
  const prefs = { ...SIDEBAR_PREFS_DEFAULTS, ...opts.prefs }
  apply(ctx as never, { reconnectGraceMs: 30_000, prefs: { get: () => prefs } })
  return {
    streams,
    tools,
    workspace,
    cleanup: () => { for (const cleanup of cleanups) cleanup() },
  }
}

/** A request body the test drives: chunks, an optional failing iterator, and an end. */
function bodyInput(): {
  write(d: string | Uint8Array): void
  end(): void
  fail(error: unknown): void
  iterable: AsyncIterable<string | Uint8Array>
} {
  const queue: Array<string | Uint8Array> = []
  let ended = false
  let failure: { thrown: true; error: unknown } | undefined
  let wake: (() => void) | undefined
  const kick = (): void => { if (wake !== undefined) { const w = wake; wake = undefined; w() } }
  return {
    write(d) { queue.push(d); kick() },
    end() { ended = true; kick() },
    fail(error) { failure = { thrown: true, error }; kick() },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<string | Uint8Array>> => {
          for (;;) {
            if (queue.length > 0) return { done: false, value: queue.shift()! }
            if (failure !== undefined) throw failure.error
            if (ended) return { done: true, value: undefined }
            await new Promise<void>((r) => { wake = r })
          }
        },
      }),
    },
  }
}

/** Build a `SidebarHttpRequest` from a URL (null omits it) and a body iterable. */
function mkRequest(url: string | null, iterable: AsyncIterable<string | Uint8Array>): SidebarHttpRequest {
  const u = url === null ? undefined : new URL(url, 'http://dsh.internal')
  return {
    ...(u === undefined ? {} : { url: `${u.pathname}${u.search}` }),
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
}

interface OpenStream {
  status: number
  body: ReturnType<typeof bodyInput>
  response: Response
  write(d: string | Uint8Array): void
  end(): void
  fail(error: unknown): void
  next(): Promise<string>
  readJson(): Promise<unknown>
  all(): string
  seen(): string[]
}

/** Drive one stream handler directly and expose its input body and output. */
async function openStream(route: SidebarWebStreamingRoute, url: string | null): Promise<OpenStream> {
  const body = bodyInput()
  const req = mkRequest(url, body.iterable)
  const response = await route.handler(req)
  const collector = new StreamCollector(response.body ?? new ReadableStream())
  let lineBuffer = ''
  return {
    status: response.status,
    body,
    response,
    write: (d) => { body.write(d) },
    end: () => { body.end() },
    fail: (error) => { body.fail(error) },
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
  }
}

/** One stream whose response body stays untouched (the caller cancels or reads it). */
interface RawStream {
  status: number
  body: ReturnType<typeof bodyInput>
  response: Response
  write(d: string | Uint8Array): void
  end(): void
  fail(error: unknown): void
}

/** Drive one stream handler without attaching a response reader. */
async function openRaw(route: SidebarWebStreamingRoute, url: string | null): Promise<RawStream> {
  const body = bodyInput()
  const response = await route.handler(mkRequest(url, body.iterable))
  return {
    status: response.status,
    body,
    response,
    write: (d) => { body.write(d) },
    end: () => { body.end() },
    fail: (error) => { body.fail(error) },
  }
}

const toolOf = (tools: ToolDefinition[], name: string): ToolDefinition => {
  const found = tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not registered`)
  return found
}

const toolExec = (sessionId: string): ToolRunContext =>
  ({ signal: { throwIfAborted: () => {}, aborted: false }, agent: { session: { id: sessionId } } }) as unknown as ToolRunContext

describe('stream requests without a URL', () => {
  const mounted = mountUpgrades()
  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  it('answers 400 for a push stream and a terminal stream that carry no URL', async () => {
    for (const path of ['/sidebar/ws/agent-terminals', '/sidebar/ws/agent-opens']) {
      const stream = await openStream(mounted.streams.find(route => route.path === path)!, null)
      expect(stream.status, path).toBe(400)
    }
    const terminal = await openStream(mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!, null)
    expect(terminal.status).toBe(400)
  })
})

describe('agent terminal stream framing and lifecycle', () => {
  const mounted = mountUpgrades({ prefs: { agentTerminalTools: true, terminalShell: testShell() } })
  const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!

  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  /** Create one agent terminal through the model-facing tool. */
  const createTerminal = async (title: string, command = ''): Promise<string> =>
    ((await toolOf(mounted.tools, 'terminal_create').execute({ title, command }, toolExec('stream-edges'))) as { uuid: string }).uuid

  const transcriptOf = async (uuid: string): Promise<string> =>
    ((await toolOf(mounted.tools, 'terminal_read').execute({ uuid, count: 500 }, toolExec('stream-edges'))) as { text: string }).text

  /** Close the terminal through the model-facing tool (releases the pty). */
  const closeTerminal = async (uuid: string): Promise<void> => {
    await toolOf(mounted.tools, 'terminal_close').execute({ uuid }, toolExec('stream-edges'))
  }

  it('forwards a byte frame to the pty verbatim', async () => {
    const uuid = await createTerminal('byte-frame', 'sleep 30')
    try {
      const stream = await openStream(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
      const marker = `byte-frame-${Date.now()}`
      stream.write(Buffer.from(`echo ${marker}\r`))
      await until(async () => (await transcriptOf(uuid)).includes(marker))
      stream.end()
    } finally {
      await closeTerminal(uuid)
    }
  }, 20_000)

  it('drops frames delivered after the client cancels the response stream', async () => {
    const uuid = await createTerminal('cancelled', 'sleep 30')
    try {
      const stream = await openRaw(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
      await stream.response.body?.cancel()
      const marker = `late-frame-${Date.now()}`
      stream.write(`echo ${marker}\r`)
      await new Promise(resolve => setTimeout(resolve, 300))
      // A closed transport forwards nothing: the shell never saw the frame.
      expect(await transcriptOf(uuid)).not.toContain(marker)
      stream.end()
    } finally {
      await closeTerminal(uuid)
    }
  }, 20_000)

  it('treats a bare body end after the response stream closed as a no-op', async () => {
    const uuid = await createTerminal('ended-late', 'sleep 30')
    try {
      const stream = await openRaw(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
      await stream.response.body?.cancel()
      stream.end()
      await new Promise(resolve => setTimeout(resolve, 100))
      // The agent still owns the terminal: the double teardown touched nothing.
      const list = await toolOf(mounted.tools, 'terminal_list').execute({}, toolExec('stream-edges')) as Array<{ uuid: string; exited: boolean }>
      expect(list.find(entry => entry.uuid === uuid)?.exited).toBe(false)
    } finally {
      await closeTerminal(uuid)
    }
  }, 20_000)

  it('ignores a request-body failure that follows the response-stream cancel', async () => {
    const uuid = await createTerminal('cancel-then-fail', 'sleep 30')
    try {
      const stream = await openRaw(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
      await stream.response.body?.cancel()
      stream.fail(new Error('client vanished'))
      await new Promise(resolve => setTimeout(resolve, 100))
      const list = await toolOf(mounted.tools, 'terminal_list').execute({}, toolExec('stream-edges')) as Array<{ uuid: string; exited: boolean }>
      expect(list.find(entry => entry.uuid === uuid)?.exited).toBe(false)
    } finally {
      await closeTerminal(uuid)
    }
  }, 20_000)

  it('stops forwarding once a frame arrives after the body ended', async () => {
    const uuid = await createTerminal('end-first', 'sleep 30')
    try {
      const stream = await openRaw(terminal, `/sidebar/ws/terminal?uuid=${uuid}`)
      stream.end()
      await new Promise(resolve => setTimeout(resolve, 50))
      // The cancel follows the body-end close; the guard keeps it a no-op.
      await stream.response.body?.cancel()
      const marker = `after-end-${Date.now()}`
      stream.write(`echo ${marker}\r`)
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(await transcriptOf(uuid)).not.toContain(marker)
    } finally {
      await closeTerminal(uuid)
    }
  }, 20_000)
})

describe('transport behaviour under a failing or missing consumer', () => {
  it('closes the transport on a body error and keeps dropping later pty output', async () => {
    const mounted = mountUpgrades({ prefs: { agentTerminalTools: true, terminalShell: testShell() } })
    try {
      const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!
      const created = await toolOf(mounted.tools, 'terminal_create').execute(
        { title: 'noisy', command: 'cat /dev/zero | tr "\\0" "a"' },
        toolExec('body-error'),
      ) as { uuid: string }
      const stream = await openStream(terminal, `/sidebar/ws/terminal?uuid=${created.uuid}`)
      await new Promise(resolve => setTimeout(resolve, 200))
      // The request body fails: the terminal pump has no error handler, so
      // the transport closes while the pty keeps producing output — every
      // later send must be dropped rather than written onto a dead stream.
      stream.fail(new Error('client body failed'))
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(stream.status).toBe(200)
      // The pty keeps producing, but nothing reaches the closed transport.
      const page = await toolOf(mounted.tools, 'terminal_read').execute({ uuid: created.uuid }, toolExec('body-error')) as { text: string }
      expect(page.text.length).toBeGreaterThan(0)
      await toolOf(mounted.tools, 'terminal_signal').execute({ uuid: created.uuid, signal: 'SIGKILL' }, toolExec('body-error'))
      await toolOf(mounted.tools, 'terminal_close').execute({ uuid: created.uuid }, toolExec('body-error'))
    } finally {
      mounted.cleanup()
      rmSync(mounted.workspace, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('push-stream subscriptions', () => {
  const mounted = mountUpgrades({ prefs: { agentTerminalTools: true, agentOpenTools: true } })
  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  it('detaches the agent-opens view when the request body fails', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-opens')!
    const stream = await openStream(route, '/sidebar/ws/agent-opens?sessionId=failing-opens')
    stream.fail(new Error('client vanished'))
    await new Promise(resolve => setTimeout(resolve, 50))
    // The view was detached by the error callback: the open queues again.
    const open = toolOf(mounted.tools, 'sidebar_open')
    const queued = await open.execute({ target: '/tmp' }, toolExec('failing-opens')) as { delivered: boolean }
    expect(queued.delivered).toBe(false)
  }, 20_000)

  it('detaches the agent-terminals view when the request body fails', async () => {
    const route = mounted.streams.find(candidate => candidate.path === '/sidebar/ws/agent-terminals')!
    const stream = await openStream(route, '/sidebar/ws/agent-terminals?sessionId=failing-terminals')
    await stream.readJson()
    stream.fail(new Error('client vanished'))
    await new Promise(resolve => setTimeout(resolve, 50))
    // The subscription is gone: creating a terminal after the failure must
    // not write to the closed transport (no unhandled enqueue).
    const created = await toolOf(mounted.tools, 'terminal_create').execute({ title: 'post-failure', command: '' }, toolExec('failing-terminals')) as { uuid: string }
    expect(created.uuid).toMatch(/^[0-9a-f-]{36}$/)
    await toolOf(mounted.tools, 'terminal_close').execute({ uuid: created.uuid }, toolExec('failing-terminals'))
  }, 20_000)
})

describe('agent terminal input after exit', () => {
  const mounted = mountUpgrades({ prefs: { agentTerminalTools: true, terminalShell: testShell() } })
  afterAll(() => {
    mounted.cleanup()
    rmSync(mounted.workspace, { recursive: true, force: true })
  })

  it('drops stream input once the agent terminal has exited', async () => {
    const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!
    const created = await toolOf(mounted.tools, 'terminal_create').execute(
      { title: 'oneshot', command: 'exit 7' },
      toolExec('exited-input'),
    ) as { uuid: string }
    await until(async () => ((await toolOf(mounted.tools, 'terminal_list').execute({}, toolExec('exited-input'))) as Array<{ uuid: string; exited: boolean }>)
      .some(entry => entry.uuid === created.uuid && entry.exited))
    const stream = await openStream(terminal, `/sidebar/ws/terminal?uuid=${created.uuid}`)
    await stream.next()
    const before = (await toolOf(mounted.tools, 'terminal_read').execute({ uuid: created.uuid }, toolExec('exited-input')) as { text: string }).text
    stream.write('echo never-delivered\r')
    await new Promise(resolve => setTimeout(resolve, 200))
    const after = (await toolOf(mounted.tools, 'terminal_read').execute({ uuid: created.uuid }, toolExec('exited-input')) as { text: string }).text
    expect(after).toBe(before)
    const list = await toolOf(mounted.tools, 'terminal_list').execute({}, toolExec('exited-input')) as Array<{ uuid: string; exited: boolean }>
    expect(list.find(entry => entry.uuid === created.uuid)?.exited).toBe(true)
    stream.end()
  }, 20_000)
})

describe('pty spawn failures during attach', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-stream-spawn-'))
  let mounted: Mounted

  beforeAll(() => {
    // Poison the loader cache with a module whose spawn throws a non-Error:
    // the attach must still answer the client with a 500 envelope.
    resetNodePtyCache()
    loadNodePty(() => ({ spawn: () => { throw 'spawn exploded' } }))
    mounted = mountUpgrades({ workspace, prefs: { terminalTools: true } })
  })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
    resetNodePtyCache()
    expect(loadNodePty()).not.toBeNull()
  })

  it('answers 500 with the raw failure text', async () => {
    const terminal = mounted.streams.find(route => route.path === '/sidebar/ws/terminal')!
    const stream = await openStream(terminal, '/sidebar/ws/terminal?sessionId=spawn&tab=t1')
    expect(stream.status).toBe(500)
    expect(stream.all() ?? '').toContain('spawn exploded')
  })
})
