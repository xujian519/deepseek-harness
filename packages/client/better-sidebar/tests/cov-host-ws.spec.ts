/**
 * Terminal WebSocket coverage: the three upgrade endpoints are exercised
 * through a real HTTP server and real WebSocket clients, covering the trust
 * fences, the attach contracts (?uuid / ?sessionId+?tab / missing
 * parameters), transcript replay, the control frames (resize, park, close),
 * input forwarding, the exited-terminal notice, agent-terminal pumps, the
 * agent-terminals push feed, the agent-opens replay queue, and the degraded
 * mode (node-pty unavailable) close codes. Each mount tears the plugin down
 * through the registration effects, which disposes every spawned shell.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { apply } from '../src/index.ts'
import { SIDEBAR_PREFS_NS } from '../src/config.ts'
import { PTY_DEPS_MISSING } from '../src/pty-deps.ts'
import { loadNodePty, resetNodePtyCache } from '../src/pty-deps.ts'
import type { SidebarWebUpgradeRoute } from '../src/context-types.ts'
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
  upgrades: SidebarWebUpgradeRoute[]
  tools: ToolDefinition[]
  cleanup: () => void
  base: string
  server: Server
}

interface MountOptions {
  workspace?: string
  prefs?: Record<string, unknown>
  config?: { reconnectGraceMs?: number }
  /** Sessions whose header carries NO cwd: the client cwd decides. */
  headerlessCwd?: boolean
}

/** Mount the plugin and bind its upgrade handlers to a real HTTP server. */
function mountUpgrades(opts: MountOptions = {}): Mounted {
  const upgrades: SidebarWebUpgradeRoute[] = []
  const tools: ToolDefinition[] = []
  const cleanups: Array<() => void> = []
  const settings = settingsService(opts.prefs ?? {})
  const ctx = {
    webRuntime: { trustedHosts: [] },
    webServer: {
      register: () => () => {},
      registerUpgrade: (route: SidebarWebUpgradeRoute) => { upgrades.push(route); return () => {} },
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
  apply(ctx as never, opts.config)
  const server = createServer()
  server.on('upgrade', (req, socket, head) => {
    const route = upgrades.find(candidate => (req.url ?? '/').startsWith(candidate.path))
    if (route === undefined) {
      socket.destroy()
      return
    }
    void route.handler(req as never, socket, head)
  })
  server.listen(0)
  return {
    upgrades,
    tools,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup()
      server.close()
      server.closeAllConnections()
    },
    get base() { return `ws://127.0.0.1:${(server.address() as AddressInfo).port}` },
    server,
  }
}

/** A client socket that buffers every message from the moment the
 *  handshake starts: the server pushes the replay (and the initial push
 *  lists) inside the upgrade callback, so a listener attached after the
 *  `open` event would miss them. */
interface TrackedWebSocket extends WebSocket {
  seen: string[]
  cursor: number
}

/** Open a client WebSocket and resolve on a successful handshake. */
function wsOpen(url: string): Promise<TrackedWebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url) as TrackedWebSocket
    ws.seen = []
    ws.cursor = 0
    ws.on('message', (data: Buffer) => { ws.seen.push(data.toString('utf8')) })
    ws.once('open', () =>{  resolvePromise(ws) })
    ws.once('error', reject)
  })
}



/** The first close event of the socket (code + reason). */
function wsClosed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolvePromise) => {
    ws.once('close', (code: number, reason: Buffer) =>{  resolvePromise({ code, reason: reason.toString('utf8') }) })
  })
}

/** The next text message from the socket (from the buffer, then live). */
function wsMessage(ws: TrackedWebSocket): Promise<string> {
  return new Promise((resolvePromise) => {
    const deliver = (): void => {
      const value = ws.seen[ws.cursor]
      if (value !== undefined) {
        ws.cursor += 1
        resolvePromise(value)
        return
      }
      ws.once('message', () => { deliver() })
    }
    deliver()
  })
}

/** Collect every message until the socket closes. */
function wsDrain(ws: TrackedWebSocket): { seen: string[] } {
  return { seen: ws.seen }
}

const toolOf = (tools: ToolDefinition[], name: string): ToolDefinition => {
  const found = tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not registered`)
  return found
}

const toolExec = (sessionId: string): ToolRunContext =>
  ({ signal: { throwIfAborted: () => {}, aborted: false }, agent: { session: { id: sessionId } } }) as unknown as ToolRunContext

describe('upgrade trust fences', () => {
  it('destroys the socket for untrusted hosts on all three endpoints', () => {
    const mounted = mountUpgrades()
    try {
      for (const route of mounted.upgrades) {
        const destroyed: boolean[] = []
        void route.handler(
          { url: `${route.path}?sessionId=s&tab=t`, headers: { host: 'evil.example' } } as never,
          { destroy: () => { destroyed.push(true) } },
          Buffer.alloc(0),
        )
        expect(destroyed, route.path).toEqual([true])
      }
    } finally {
      mounted.cleanup()
    }
  })
})

describe('UI-tab terminal WebSocket', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ws-'))
  const mounted = mountUpgrades({ workspace, config: { reconnectGraceMs: 30_000 } })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('closes with 1008 when neither uuid nor sessionId+tab are supplied', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal`)
    const closed = await wsClosed(client)
    expect(closed.code).toBe(1008)
    expect(closed.reason).toBe('either ?uuid or ?sessionId+?tab are required')
  })

  it('closes with 1011 when the attach cwd cannot be resolved', async () => {
    const headerless = mountUpgrades({ headerlessCwd: true })
    try {
      const client = await wsOpen(`${headerless.base}/sidebar/ws/terminal?sessionId=s&tab=t&cwd=${encodeURIComponent('relative/cwd')}`)
      const closed = await wsClosed(client)
      expect(closed.code).toBe(1011)
      expect(closed.reason).toContain('invalid working directory')
    } finally {
      headerless.cleanup()
    }
  })

  it('replays the transcript on reconnect and pumps input, resize, and raw frames', async () => {
    const url = `${mounted.base}/sidebar/ws/terminal?sessionId=pump&tab=t1`
    const marker = `echo cov-ws-${Date.now()}`
    // First connection: run a marker command and wait for its echo, which
    // guarantees the marker is inside the retained transcript.
    const first = await wsOpen(url)
    const firstDrain = wsDrain(first)
    first.send(`${marker}\r`)
    const markerOutput = marker.slice('echo '.length)
    await until(() => firstDrain.seen.some(text => text.includes(markerOutput)))
    first.close()
    await wsClosed(first)

    // Reconnect: the marker replays before any live data.
    const second = await wsOpen(url)
    const replay = await wsMessage(second)
    expect(replay).toContain(marker)

    // Input is forwarded verbatim to the shell; the command echoes back.
    second.send(`echo cov-live-input-${Date.now()}\r`)
    const drained = wsDrain(second)
    await until(() => drained.seen.some(text => text.includes('cov-live-input')))
    // A resize control frame resizes the pty; an unrecognized JSON control is
    // forwarded as input; a JSON `null` body is raw input.
    second.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    second.send(JSON.stringify({ type: 'future-control', x: 1 }))
    second.send('null')
    await new Promise(resolve => setTimeout(resolve, 100))
    second.close()
    await wsClosed(second)
  }, 20_000)

  it('announces the exit code when the shell leaves and drops later input', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?sessionId=exiter&tab=t1`)
    client.send('exit 5\r')
    const drained = wsDrain(client)
    await until(() => drained.seen.some(text => text.includes('[process exited with code 5]')))
    // Input after exit is dropped (the pty is gone); nothing may crash.
    client.send('ignored\r')
    client.send(JSON.stringify({ type: 'close' }))
    await new Promise(resolve => setTimeout(resolve, 100))
    client.close()
    await wsClosed(client)
  }, 20_000)

  it('keeps a parked pty out of the reconnect countdown (park frame)', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?sessionId=parker&tab=t1`)
    client.send(JSON.stringify({ type: 'park' }))
    await new Promise(resolve => setTimeout(resolve, 100))
    client.close()
    const closed = await wsClosed(client)
    expect(closed.code).toBe(1005)
  }, 20_000)

  it('spawns with the settings-page shell overrides and reports the exit', async () => {
    if (process.platform === 'win32') return
    // A fresh mount whose prefs pin a shell that exits immediately.
    const overrideMounted = mountUpgrades({ workspace, prefs: { terminalShell: testShell(), terminalShellArgs: '--version' } })
    try {
      const client = await wsOpen(`${overrideMounted.base}/sidebar/ws/terminal?sessionId=shellover&tab=t1`)
      const drained = wsDrain(client)
      await until(() => drained.seen.some(text => text.includes('[process exited with code')))
      client.close()
      await wsClosed(client)
    } finally {
      overrideMounted.cleanup()
    }
  }, 20_000)
})

describe('agent terminal WebSocket', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ws-agent-'))
  const mounted = mountUpgrades({ workspace, prefs: { agentTerminalTools: true, terminalShell: testShell() } })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  /** Create one agent terminal through the model-facing tool. */
  const createTerminal = async (command: string): Promise<string> => {
    const result = await toolOf(mounted.tools, 'terminal_create').execute(
      { title: 'ws agent', command },
      toolExec('agent-ws'),
    ) as { uuid: string }
    return result.uuid
  }

  it('closes with 1011 for an unknown uuid', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?uuid=missing-uuid`)
    const closed = await wsClosed(client)
    expect(closed.code).toBe(1011)
    expect(closed.reason).toBe('agent terminal "missing-uuid" not found')
  })

  it('replays the transcript and pumps the agent pty (input, resize, close frame)', async () => {
    const uuid = await createTerminal('echo cov-agent-replay')
    // Wait for output so the attach replays a non-empty transcript.
    await until(async () => (await registryTranscript(uuid)).includes('cov-agent-replay'))
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?uuid=${uuid}`)
    const replay = await wsMessage(client)
    expect(replay).toContain('cov-agent-replay')
    // Raw input reaches the pty; resize frames are clamped and applied;
    // the close frame kills the pty immediately.
    client.send('echo agent-live-input\r')
    client.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }))
    const drained = wsDrain(client)
    await until(() => drained.seen.some(text => text.includes('agent-live-input')))
    client.send(JSON.stringify({ type: 'close' }))
    await until(() => registryExited(uuid))
    client.close()
    await wsClosed(client)
  }, 20_000)

  it('drops unrecognized JSON controls and exits after the pty died', async () => {
    const uuid = await createTerminal('sleep 30')
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?uuid=${uuid}`)
    await new Promise(resolve => setTimeout(resolve, 200))
    // Unrecognized control: dropped (never forwarded as input to the pty).
    client.send(JSON.stringify({ type: 'future-control' }))
    client.send(JSON.stringify({ type: 'resize', cols: 'wide', rows: 30 }))
    client.close()
    await wsClosed(client)
    // The pty outlived the socket drop (the agent owns the lifetime): the
    // same uuid reattaches with the full transcript replayed.
    const reattach = await wsOpen(`${mounted.base}/sidebar/ws/terminal?uuid=${uuid}`)
    const replay = await wsMessage(reattach).catch(() => '')
    void replay
    expect(reattach.readyState).toBe(WebSocket.OPEN)
    reattach.close()
    await wsClosed(reattach)
    // Only the close FRAME kills the agent pty.
    const killer = await wsOpen(`${mounted.base}/sidebar/ws/terminal?uuid=${uuid}`)
    killer.send(JSON.stringify({ type: 'close' }))
    await until(async () =>  (await registryExited(uuid)))
    killer.close()
    await wsClosed(killer)
  }, 20_000)

  /** Registry-internal state, reachable through the model-facing tools. */
  async function registryTranscript(uuid: string): Promise<string> {
    const read = toolOf(mounted.tools, 'terminal_read')
    const page = await read.execute({ uuid, count: 500 }, toolExec('agent-ws')) as { text: string }
    return page.text
  }
  async function registryExited(uuid: string): Promise<boolean> {
    const list = toolOf(mounted.tools, 'terminal_list')
    const rows = await list.execute({}, toolExec('agent-ws')) as Array<{ uuid: string; exited: boolean }>
    return rows.find(candidate => candidate.uuid === uuid)?.exited === true
  }
})

describe('agent-terminals push WebSocket', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ws-list-'))
  const mounted = mountUpgrades({ workspace, prefs: { agentTerminalTools: true, terminalShell: testShell() } })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('pushes the initial list and every later change to the attached view', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/agent-terminals?sessionId=pushy`)
    const initial = JSON.parse(await wsMessage(client)) as Array<unknown>
    expect(initial).toEqual([])
    // Creating a terminal fires a registry change → a fresh push.
    await toolOf(mounted.tools, 'terminal_create').execute(
      { title: 'pushed', command: '' },
      toolExec('pushy'),
    )
    const update = JSON.parse(await wsMessage(client)) as Array<{ uuid: string; title: string }>
    expect(update).toHaveLength(1)
    expect(update[0]!.title).toBe('pushed')
    client.close()
    await wsClosed(client)
  }, 20_000)
})

describe('agent-opens push WebSocket', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ws-opens-'))
  const mounted = mountUpgrades({ workspace, prefs: { agentOpenTools: true } })

  afterAll(() => {
    mounted.cleanup()
    rmSync(workspace, { recursive: true, force: true })
  })

  it('closes with 1008 without a sessionId', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/agent-opens`)
    const closed = await wsClosed(client)
    expect(closed.code).toBe(1008)
  })

  it('replays queued opens on attach and delivers later opens live', async () => {
    const open = toolOf(mounted.tools, 'sidebar_open')
    const queued = await open.execute({ target: '/tmp' }, toolExec('opens')) as { delivered: boolean }
    expect(queued.delivered).toBe(false)
    const client = await wsOpen(`${mounted.base}/sidebar/ws/agent-opens?sessionId=opens`)
    const replay = JSON.parse(await wsMessage(client)) as { kind: string; target: string }
    expect(replay.kind).toBe('folder')
    // A later open is delivered immediately to the attached view.
    const live = await open.execute({ target: '/tmp' }, toolExec('opens')) as { delivered: boolean }
    expect(live.delivered).toBe(true)
    const second = JSON.parse(await wsMessage(client)) as { kind: string }
    expect(second.kind).toBe('folder')
    client.close()
    await wsClosed(client)
    // After the view detaches, opens queue again.
    const requeued = await open.execute({ target: '/tmp' }, toolExec('opens')) as { delivered: boolean }
    expect(requeued.delivered).toBe(false)
  }, 20_000)

  it('detaches the view on an abrupt socket error', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/agent-opens?sessionId=abrupt`)
    await wsMessage(client).catch(() => undefined)
    // No opens were queued, so no message arrives; reset the TCP connection.
    const websocket = client as unknown as { _socket: { destroy: () => void } }
    websocket._socket.destroy()
    await until(() => client.readyState === WebSocket.CLOSED)
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

  it('refuses UI-tab terminals with the deps-missing close marker', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?sessionId=s&tab=t1`)
    const closed = await wsClosed(client)
    expect(closed.code).toBe(1011)
    expect(closed.reason).toBe(PTY_DEPS_MISSING)
  })

  it('refuses agent terminals like missing uuids', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/terminal?uuid=any`)
    const closed = await wsClosed(client)
    expect(closed.code).toBe(1011)
    expect(closed.reason).toBe('agent terminal "any" not found')
  })

  it('pushes the honest empty terminal list', async () => {
    const client = await wsOpen(`${mounted.base}/sidebar/ws/agent-terminals?sessionId=s`)
    const initial = JSON.parse(await wsMessage(client)) as unknown[]
    expect(initial).toEqual([])
    client.close()
    await wsClosed(client)
  })

  it('never registers the terminal tools in degraded mode', () => {
    expect(mounted.tools.map(tool => tool.name)).toEqual([])
  })
})
