/**
 * Terminal registry and dependency edge coverage: the pty quota/zombie/
 * transcript-bound paths of PtyManager, the Windows shell-candidate PATH
 * parsing, node-pty dependency status with a broken cache and unusual
 * layouts, and the AgentPtyRegistry read/signal/wait-for/snapshot edges the
 * behavior specs do not reach. Real ptys are spawned for the lifecycle
 * paths; the signal-name mapping uses the exported snapshot projection.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPtyRegistry, clampDims, snapshotOf, type AgentTerminalHandle } from '../src/agent-pty.ts'
import { defaultShell, PtyManager, shellDisplayName, shellSpawnArgs, type SidebarPty } from '../src/pty-manager.ts'
import {
  buildRepairCommand,
  depsStatus,
  findPluginRoot,
  findProfileDir,
  loadNodePty,
  nodePtyLoadCause,
  resetNodePtyCache,
} from '../src/pty-deps.ts'

/** POSIX test shell (mirrors agent-pty.spec.ts). */
const testShell = (): string => (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')

/** Wait until `poll` returns true, or throw after the deadline. */
async function until(poll: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (poll()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('condition not reached before the deadline')
}

describe('PtyManager quota and lifecycle edges', () => {
  it('lists only the queried session keys', async () => {
    const manager = new PtyManager(testShell(), 3)
    try {
      manager.open('s1', 't1', process.cwd(), 80, 24)
      expect(manager.keysOf('s2')).toEqual([])
      expect(manager.keysOf('s1')).toEqual(['s1:t1'])
    } finally {
      manager.disposeAll()
    }
  })

  it('sweeps non-exited siblings during the zombie pass without touching them', async () => {
    const manager = new PtyManager(testShell(), 3)
    try {
      const first = manager.open('s1', 't1', process.cwd(), 80, 24)
      manager.open('s1', 't2', process.cwd(), 80, 24)
      expect(manager.keysOf('s1')).toHaveLength(2)
      // The second open ran the zombie sweep over the live first handle.
      expect(manager.get(first.key)).toBeDefined()
    } finally {
      manager.disposeAll()
    }
  })

  it('rejects a new tab once the per-session quota is exhausted', async () => {
    const manager = new PtyManager(testShell(), 1)
    try {
      manager.open('s1', 't1', process.cwd(), 80, 24)
      expect(() => manager.open('s1', 't2', process.cwd(), 80, 24)).toThrow(
        expect.objectContaining({ code: 'pty-error' }),
      )
    } finally {
      manager.disposeAll()
    }
  })

  it.skipIf(process.platform === 'win32')('keeps the transcript bounded at ~1 MiB of output', async () => {
    const manager = new PtyManager(testShell(), 1)
    let handle: SidebarPty | undefined
    try {
      handle = manager.open('s-flood', 't1', process.cwd(), 80, 24)
      handle.pty.write('cat /dev/zero\r')
      // Once trimming engages, the transcript stays at or under the bound.
      await until(() => handle !== undefined && handle.transcript.length >= (1 << 20))
      expect(handle.transcript.length).toBeLessThanOrEqual(1 << 20)
    } finally {
      manager.disposeAll()
    }
  })

  it('scheduleClose on an unknown key and disposeAll with a pending timer are safe', async () => {
    const manager = new PtyManager(testShell(), 1)
    expect(() =>{  manager.scheduleClose('ghost:tab', 0) }).not.toThrow()
    const handle = manager.open('s1', 't1', process.cwd(), 80, 24)
    // A pending grace close must be cleared by disposeAll (no dangling timer).
    manager.scheduleClose(handle.key, 60_000)
    manager.disposeAll()
    expect(manager.get(handle.key)).toBeUndefined()
  })
})

describe('defaultShell platform resolution edges', () => {
  it('skips empty PATH entries when probing pwsh candidates (win32)', () => {
    const shell = defaultShell({
      platform: 'win32',
      env: { PATH: 'C:\\one;;C:\\two', ProgramFiles: '', LOCALAPPDATA: '' },
      exists: () => false,
    })
    expect(shell).toBe('powershell.exe')
  })

  it('trims and strips the executable suffix for display names', () => {
    expect(shellDisplayName('C:\\tools\\pwsh.exe')).toBe('pwsh')
    expect(shellDisplayName('/bin/zsh')).toBe('zsh')
    expect(shellSpawnArgs(['--noprofile'])).toEqual(['--noprofile'])
    expect(clampDims(0.4, 5000)).toEqual({ cols: 2, rows: 1024 })
  })
})

describe('node-pty dependency status edges', () => {
  it('reports no cause before the first load attempt', () => {
    resetNodePtyCache()
    expect(nodePtyLoadCause()).toBeUndefined()
    // Leave the real module cached for the rest of the file.
    expect(loadNodePty()).not.toBeNull()
  })

  it('falls back to the plain directory when the module file cannot be resolved', () => {
    const ghost = join(tmpdir(), 'dsh-sidebar-ptydeps-ghost', 'mod.js')
    expect(findPluginRoot(ghost)).toBeNull()
    // DSH_HOME pointed at a fresh tree: no profile root exists there.
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ptydeps-home-'))
    try {
      expect(findProfileDir(ghost)).toBeNull()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('ignores a package.json that is not valid JSON during plugin-root discovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ptydeps-invalid-'))
    try {
      mkdirSync(join(root, 'dist'), { recursive: true })
      writeFileSync(join(root, 'package.json'), '{not json')
      expect(findPluginRoot(join(root, 'dist', 'mod.js'))).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the dsh plugin command when the installer scripts are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ptydeps-noscript-'))
    try {
      const { command, note } = buildRepairCommand({ pluginRoot: root, profileDir: join(root, 'profiles', 'web'), platform: 'darwin' })
      expect(command).toBe('dsh plugin --profile "web" install')
      expect(note).toContain('allowBuilds')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('describes a non-Error load cause and reports a null profile for ghost layouts', () => {
    resetNodePtyCache()
    loadNodePty(() => { throw 'plain string cause' })
    const ghost = join(tmpdir(), 'dsh-sidebar-ptydeps-ghost2', 'mod.js')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-sidebar-ptydeps-home2-'))
    try {
      const status = depsStatus({ fromFile: ghost })
      expect(status).toMatchObject({
        ok: false,
        cause: 'plain string cause',
        profile: null,
        command: 'dsh plugin --profile "web" install',
      })
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      resetNodePtyCache()
      expect(loadNodePty()).not.toBeNull()
    }
  })
})

describe('AgentPtyRegistry snapshot and read edges', () => {
  it('projects exited handles with mapped signal names and null fallbacks', () => {
    const base = { uuid: 'u1', sessionId: 's1', title: 't', command: '', cwd: '/tmp', pty: {} as AgentTerminalHandle['pty'], transcript: '' }
    expect(snapshotOf({ ...base, exited: false })).not.toHaveProperty('exitCode')
    expect(snapshotOf({ ...base, exited: true, exitCode: 0, exitSignal: null })).toEqual({
      uuid: 'u1', title: 't', command: '', exited: true, exitCode: 0, exitSignal: null,
    })
    // An unmapped signal number falls back to its numeric name.
    expect(snapshotOf({ ...base, exited: true, exitSignal: 99 })).toMatchObject({
      exitCode: null, exitSignal: 'signal 99',
    })
    expect(snapshotOf({ ...base, exited: true, exitSignal: 9 })).toMatchObject({ exitSignal: 'SIGKILL' })
  })

  it('resolves snapshots by uuid and refuses exited terminals on send', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'exit-early', 'exit', process.cwd())
      await until(() => registry.get(uuid)!.exited)
      expect(registry.snapshot(uuid)).toMatchObject({ exited: true })
      expect(registry.snapshot('no-such-uuid')).toBeUndefined()
      expect(() =>{  registry.send(uuid, 'more') }).toThrow(
        expect.objectContaining({ code: 'bad-request' }),
      )
      // Reads still work on the retained transcript of an exited terminal.
      expect(registry.read(uuid, 0).lineBegin).toBe(0)
      // Resizing an exited terminal skips the pty call but echoes the dims.
      expect(registry.resize(uuid, 300, 9000)).toEqual({ cols: 300, rows: 1024 })
      // Signaling an exited terminal is a no-op.
      expect(() =>{  registry.signal(uuid, 'SIGTERM') }).not.toThrow()
    } finally {
      registry.disposeAll()
    }
  })

  it('paginates reads with explicit, clamped, and out-of-range offsets', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'pager', 'echo l1\necho l2\necho l3', process.cwd())
      await until(() => registry.get(uuid)!.transcript.includes('l3'))
      const all = registry.read(uuid, undefined, 50)
      expect(all.lineBegin).toBe(0)
      const tail = registry.read(uuid, -1)
      expect(tail.lineEnd).toBe(tail.totalLines)
      const beyond = registry.read(uuid, 10_000, 5)
      expect(beyond.text).toBe('')
      expect(beyond.lineBegin).toBe(beyond.totalLines)
      const zeroCount = registry.read(uuid, 0, 0)
      expect(zeroCount.text.split('\n')).toHaveLength(1)
    } finally {
      registry.disposeAll()
    }
  })

  it.skipIf(process.platform === 'win32')('delivers interactive signals as control bytes and termination signals as kills', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'signalled', 'sleep 30', process.cwd())
      // Give the shell time to start the silent command before signalling.
      await new Promise(resolve => setTimeout(resolve, 300))
      // Interactive signals ride the pty input pipeline (control bytes).
      expect(() =>{  registry.signal(uuid, 'SIGINT') }).not.toThrow()
      expect(() =>{  registry.signal(uuid, 'SIGTSTP') }).not.toThrow()
      // Termination signals ride pty.kill(); delivery must not throw. The
      // observable death uses SIGKILL: POSIX lets an interactive shell
      // discard SIGTERM, so SIGTERM cannot promise the process ends.
      expect(() =>{  registry.signal(uuid, 'SIGTERM') }).not.toThrow()
      registry.signal(uuid, 'SIGKILL')
      await until(() => registry.get(uuid)!.exited)
      expect(registry.snapshot(uuid)).toMatchObject({ exited: true, exitSignal: 'SIGKILL' })
    } finally {
      registry.disposeAll()
    }
  }, 15_000)

  it.skipIf(process.platform === 'win32')('keeps the transcript bounded at ~1 MiB of pty output', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s-flood', 'flood', 'cat /dev/zero', process.cwd())
      await until(() => registry.get(uuid)!.transcript.length >= (1 << 20))
      expect(registry.get(uuid)!.transcript.length).toBeLessThanOrEqual(1 << 20)
    } finally {
      registry.disposeAll()
    }
  })

  it('notifies change subscribers and supports unsubscribe', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      let changes = 0
      const unsubscribe = registry.subscribe(() => { changes += 1 })
      registry.create('s1', 'notify', '', process.cwd())
      expect(changes).toBeGreaterThanOrEqual(1)
      unsubscribe()
      const before = changes
      registry.create('s1', 'notify2', '', process.cwd())
      expect(changes).toBe(before)
    } finally {
      registry.disposeAll()
    }
  })
})

describe('AgentPtyRegistry waitFor outcomes', () => {
  it('short-circuits on an already-exited terminal (fast path)', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'exiter', 'exit 3', process.cwd())
      await until(() => registry.get(uuid)!.exited)
      const result = await registry.waitFor(uuid, 'never-appears', 1000)
      expect(result).toMatchObject({ kind: 'exited', needle: 'never-appears', exitCode: 3 })
    } finally {
      registry.disposeAll()
    }
  })

  it('finds an existing needle with its line and column without polling', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'marker', 'echo line-a\necho MARK-HERE', process.cwd())
      await until(() => registry.get(uuid)!.transcript.includes('MARK-HERE'))
      const result = await registry.waitFor(uuid, 'MARK-HERE', 1000)
      expect(result.kind).toBe('found')
      if (result.kind !== 'found') return
      expect(result.line).toBeGreaterThanOrEqual(1)
      expect(result.column).toBeGreaterThanOrEqual(0)
    } finally {
      registry.disposeAll()
    }
  })

  it('reports a timeout with the retained line count', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'quiet', '', process.cwd())
      const result = await registry.waitFor(uuid, 'never-appears-xyz', 200)
      expect(result).toEqual({
        kind: 'timeout',
        needle: 'never-appears-xyz',
        timeoutMs: 200,
        totalLines: registry.get(uuid)!.transcript.split('\n').length,
      })
    } finally {
      registry.disposeAll()
    }
  })

  it('aborts the wait by rethrowing the abort reason', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'abortable', '', process.cwd())
      const controller = new AbortController()
      const pending = registry.waitFor(uuid, 'never-appears-xyz', 30_000, controller.signal)
      setTimeout(() =>{  controller.abort() }, 100)
      await expect(pending).rejects.toThrow()
    } finally {
      registry.disposeAll()
    }
  })

  it.skipIf(process.platform === 'win32')('reports an exit that happens while the wait polls', async () => {
    const registry = new AgentPtyRegistry(testShell())
    try {
      const uuid = registry.create('s1', 'late-exit', 'sleep 1', process.cwd())
      const pending = registry.waitFor(uuid, 'never-appears-xyz', 30_000)
      setTimeout(() =>{  registry.signal(uuid, 'SIGKILL') }, 150)
      const result = await pending
      expect(result.kind).toBe('exited')
      if (result.kind !== 'exited') return
      // The kill is reported with the mapped signal name (the raw exit code
      // spelling for a signalled process differs by platform).
      expect(result.exitSignal).toBe('SIGKILL')
    } finally {
      registry.disposeAll()
    }
  })
})
