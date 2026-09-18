/**
 * Agent-terminal behaviours that need an injected pty module: an exit
 * without an exit code or signal (the handle's null markers and the
 * `waitFor` projections built from them), a `kill()` that rejects the named
 * signal (Windows ConPTY), and the wait poll running under a host whose
 * timer handle is a plain number rather than a Node Timeout.
 */
import { describe, expect, it, vi } from 'vitest'
import { AgentPtyRegistry } from '../src/agent-pty.ts'
import type { NodePtyModule } from '../src/pty-deps.ts'

/** The pty seat one injected module hands back, with its callbacks exposed. */
interface FakePty {
  onData: (cb: (data: string) => void) => { dispose(): void }
  onExit: (cb: (event: { exitCode?: number; signal?: number }) => void) => { dispose(): void }
  write: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  emitExit(event: { exitCode?: number; signal?: number }): void
}

/** One fake pty whose kill() can be told to reject the named signal. */
function fakePty(killImpl?: (signal?: string) => void): FakePty {
  let exitCb: ((event: { exitCode?: number; signal?: number }) => void) | undefined
  return {
    onData: () => ({ dispose: () => {} }),
    onExit: (cb) => { exitCb = cb; return { dispose: () => {} } },
    write: vi.fn(),
    kill: vi.fn((signal?: string) => { killImpl?.(signal) }),
    resize: vi.fn(),
    emitExit(event) { exitCb?.(event) },
  }
}

/** An injected node-pty module returning the given pty. */
const moduleOf = (pty: FakePty): NodePtyModule => ({ spawn: () => pty }) as unknown as NodePtyModule

describe('signal-less exits', () => {
  it('reports a missing exit code and signal as null', async () => {
    const pty = fakePty()
    const registry = new AgentPtyRegistry('/bin/sh', [], moduleOf(pty))
    const uuid = registry.create('s1', 'silent-exit', '', '/tmp')
    pty.emitExit({})
    const result = await registry.waitFor(uuid, 'never-appears', 1000)
    expect(result).toEqual({ kind: 'exited', needle: 'never-appears', exitCode: null, exitSignal: null })
    expect(registry.snapshot(uuid)).toMatchObject({ exited: true, exitCode: null, exitSignal: null })
  })

  it('reports the same exit from the poll loop when the wait is already running', async () => {
    const pty = fakePty()
    const registry = new AgentPtyRegistry('/bin/sh', [], moduleOf(pty))
    const uuid = registry.create('s1', 'late-exit', '', '/tmp')
    const pending = registry.waitFor(uuid, 'never-appears', 5000)
    setTimeout(() => { pty.emitExit({}) }, 80)
    await expect(pending).resolves.toEqual({ kind: 'exited', needle: 'never-appears', exitCode: null, exitSignal: null })
  })
})

describe('termination signal delivery', () => {
  it('falls back to the default kill when the named signal is rejected', () => {
    const pty = fakePty((signal) => { if (signal !== undefined) throw new Error('unsupported signal') })
    const registry = new AgentPtyRegistry('/bin/sh', [], moduleOf(pty))
    const uuid = registry.create('s1', 'windows-kill', '', '/tmp')
    expect(() => { registry.signal(uuid, 'SIGKILL') }).not.toThrow()
    expect(pty.kill.mock.calls).toEqual([['SIGKILL'], []])
  })

  it('swallows a kill that fails on both attempts', () => {
    const pty = fakePty(() => { throw new Error('process gone') })
    const registry = new AgentPtyRegistry('/bin/sh', [], moduleOf(pty))
    const uuid = registry.create('s1', 'dead-process', '', '/tmp')
    expect(() => { registry.signal(uuid, 'SIGHUP') }).not.toThrow()
    expect(() => { registry.close(uuid) }).not.toThrow()
  })
})

describe('wait poll timer handles', () => {
  it('never calls unref on a numeric timer handle', async () => {
    // A host whose setTimeout returns a plain number (rather than a Node
    // Timeout) still gets a working poll: the guard exists so the handle is
    // never dereferenced blindly.
    const realSetTimeout = globalThis.setTimeout
    const stub = vi.fn((fn: () => void, ms?: number) => { realSetTimeout(fn, ms); return 1 })
    vi.stubGlobal('setTimeout', stub)
    const pty = fakePty()
    const registry = new AgentPtyRegistry('/bin/sh', [], moduleOf(pty))
    try {
      const uuid = registry.create('s1', 'numeric-timers', '', '/tmp')
      await expect(registry.waitFor(uuid, 'never-appears', 150)).resolves.toMatchObject({ kind: 'timeout' })
      expect(stub).toHaveBeenCalled()
    } finally {
      registry.disposeAll()
      vi.unstubAllGlobals()
    }
  })
})
