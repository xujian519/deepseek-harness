import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectPrediction, prepareTaskWorkspace, runAgent, verifyVerdict, type PreparedWorkspace } from '../src/campaign/workspace.ts'
import type { SwebenchRow } from '../src/campaign/manifest.ts'
import type { EvalTask } from '../src/types.ts'

type SpawnPlan = {
  code?: number
  spawnError?: string
  hang?: boolean
  pid?: number | undefined
  stdout?: string
  stderr?: string
  closeAfterError?: boolean
}

const { spawnMock, setPlan } = vi.hoisted(() => {
  const queue: SpawnPlan[] = []
  const emitter = () => {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    return {
      on(name: string, fn: (...args: unknown[]) => void) {
        const arr = handlers.get(name) ?? []
        arr.push(fn)
        handlers.set(name, arr)
        return this
      },
      emit(name: string, ...args: unknown[]) {
        for (const fn of handlers.get(name) ?? []) fn(...args)
      },
    }
  }
  const spawnMock = vi.fn((_program: string, _args: readonly string[], _opts: unknown) => {
    const plan = queue.shift() ?? {}
    const child = emitter() as unknown as {
      pid: number | undefined
      stdout: ReturnType<typeof emitter>
      stderr: ReturnType<typeof emitter>
      on(name: string, fn: (...args: unknown[]) => void): unknown
      emit(name: string, ...args: unknown[]): void
    }
    child.pid = plan.pid
    child.stdout = emitter()
    child.stderr = emitter()
    queueMicrotask(() => {
      if (plan.stdout !== undefined) child.stdout.emit('data', Buffer.from(plan.stdout))
      if (plan.stderr !== undefined) child.stderr.emit('data', Buffer.from(plan.stderr))
      if (plan.spawnError !== undefined) {
        child.emit('error', new Error(plan.spawnError))
        if (plan.closeAfterError === true) child.emit('close', 0)
      } else if (plan.hang !== true) {
        child.emit('close', plan.code ?? 0)
      }
    })
    return child
  })
  const setPlan = (plans: Array<number | SpawnPlan>) => {
    queue.length = 0
    for (const plan of plans) queue.push(typeof plan === 'number' ? { code: plan } : plan)
  }
  return { spawnMock, setPlan }
})

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

const task: EvalTask = { instanceId: 't-1', repo: 'a/b', baseCommit: 'abc', failToPass: [], passToPass: [] }

function row(overrides: Partial<SwebenchRow> = {}): SwebenchRow {
  return {
    instanceId: 't-1',
    repo: 'a/b',
    baseCommit: 'abc',
    problemStatement: 'problem',
    testPatch: 'diff --git a/tests/x.py b/tests/x.py',
    failToPass: [],
    passToPass: [],
    ...overrides,
  }
}

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'self-evolve-spawn-'))
  tempDirs.push(dir)
  return dir
}

function workspace(repo: string, overrides: Partial<PreparedWorkspace> = {}): PreparedWorkspace {
  return {
    taskId: 't-1',
    taskDir: '/tmp/task',
    repoBase: repo,
    repoArms: { baseline: repo, evolved: repo },
    venv: '/tmp/.venv',
    venvPython: '/tmp/.venv/bin/python',
    testPatchPath: '/tmp/task/test.patch',
    testPatchFiles: [],
    row: row(),
    ...overrides,
  }
}

const PREPARE_OPTIONS = {
  workDir: '/tmp/work',
  task,
  row: row(),
  pythonVersion: '3.11',
  envTool: 'venv' as const,
  setupTimeoutMs: 1_000,
  installTimeoutMs: 1_000,
  logPath: '/tmp/setup.log',
}

describe('prepareTaskWorkspace', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('prepares a venv task: base checkout, arm checkouts, and test patch', async () => {
    const dir = await tempDir()
    setPlan([0, 0, 0, 0, 0, 0, 0, 0, 0])
    const ws = await prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir, row: row(), logPath: join(dir, 'setup.log') })
    expect(ws.taskId).toBe('t-1')
    expect(ws.repoArms.baseline).toContain('arm-baseline')
    expect(ws.repoArms.evolved).toContain('arm-evolved')
    expect(ws.venvPython).toContain('.venv/bin/python')
  })

  it('runs the dataset install command when the row declares it', async () => {
    const dir = await tempDir()
    setPlan([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const ws = await prepareTaskWorkspace({
      ...PREPARE_OPTIONS, workDir: dir, row: row({ install: 'pip install -e .' }), logPath: join(dir, 'setup.log'),
    })
    expect(ws.taskId).toBe('t-1')
  })

  it('prepares a uv task end to end', async () => {
    const dir = await tempDir()
    setPlan([0, 0, 0, 0, 0, 0, 0, 0, 0])
    const ws = await prepareTaskWorkspace({ ...PREPARE_OPTIONS, envTool: 'uv', workDir: dir })
    expect(ws.taskId).toBe('t-1')
  })

  it('fails loud when the venv spawn itself fails', async () => {
    const dir = await tempDir()
    setPlan([{ spawnError: 'no uv', closeAfterError: true }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, envTool: 'uv', workDir: dir })).rejects.toThrow(/uv venv failed/)
  })

  it('fails loud when python3 -m venv exits non-zero', async () => {
    const dir = await tempDir()
    setPlan([{ code: 1 }, { code: 0 }, { code: 0 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/python3 -m venv exited 1/)
  })

  it('fails loud when uv venv exits non-zero', async () => {
    const dir = await tempDir()
    setPlan([{ code: 2 }, { code: 0 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, envTool: 'uv', workDir: dir })).rejects.toThrow(/uv venv exited 2/)
  })

  it('fails loud on a clone failure and a base checkout failure', async () => {
    const dir = await tempDir()
    setPlan([{ code: 0 }, { code: 1 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/clone a\/b exited 1/)
    setPlan([{ code: 0 }, { code: 0 }, { code: 3 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/checkout abc exited 3/)
  })

  it('fails loud on a baseline arm clone, checkout, and test-patch apply failure', async () => {
    const dir = await tempDir()
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 4 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/clone baseline arm exited 4/)
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 5 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/checkout baseline arm exited 5/)
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 6 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/test_patch did not apply on the baseline arm/)
  })

  it('fails loud on an evolved arm clone failure and an install failure', async () => {
    const dir = await tempDir()
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 7 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, workDir: dir })).rejects.toThrow(/clone evolved arm exited 7/)
    setPlan([
      { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 },
      { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 8 },
    ])
    await expect(prepareTaskWorkspace({
      ...PREPARE_OPTIONS, workDir: dir, row: row({ install: 'pip install -e .' }),
    })).rejects.toThrow(/install command exited 8/)
  })

  it('times out a hanging venv step and escalates the kill', async () => {
    const dir = await tempDir()
    setPlan([{ hang: true, pid: 424_242 }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, setupTimeoutMs: 20, workDir: dir }))
      .rejects.toThrow(/python3 -m venv exited 1/)
  })

  it('handles a missing child pid at kill time', async () => {
    const dir = await tempDir()
    setPlan([{ hang: true, pid: undefined }])
    await expect(prepareTaskWorkspace({ ...PREPARE_OPTIONS, setupTimeoutMs: 20, workDir: dir }))
      .rejects.toThrow(/python3 -m venv exited 1/)
  })
})

describe('runAgent', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('spawns the dsh source entry with the profile and no overlay', async () => {
    setPlan([{ code: 0 }])
    const ws = workspace('/repo')
    await runAgent({
      workspace: ws, arm: 'baseline', taskText: 'solve', profile: 'headless',
      dshEntry: '/apps/bin.ts', tsxImport: 'tsx/esm', timeoutMs: 100, logPath: '/tmp/agent.log',
    })
    const args = spawnMock.mock.calls.at(-1)?.[1] as readonly string[]
    expect(args).toContain('--profile')
    expect(args).toContain('/apps/bin.ts')
    expect(args).toContain('solve')
    expect(args).not.toContain('--patch')
  })

  it('adds the overlay and DSH_HOME for an evolved run', async () => {
    setPlan([{ code: 0 }])
    const ws = workspace('/repo')
    const result = await runAgent({
      workspace: ws, arm: 'evolved', taskText: 'solve', profile: 'headless',
      dshEntry: '/apps/bin.ts', tsxImport: 'tsx/esm', overlayPath: '/evolved.yml', dshHome: '/home',
      timeoutMs: 100, logPath: '/tmp/agent.log',
    })
    const args = spawnMock.mock.calls.at(-1)?.[1] as readonly string[]
    expect(args).toContain('--patch')
    expect(args).toContain('/evolved.yml')
    expect(result.exitCode).toBe(0)
  })
})

describe('collectPrediction', () => {
  it('fails loud when git add exits non-zero', async () => {
    const dir = await tempDir()
    setPlan([{ code: 2 }])
    await expect(collectPrediction(workspace('/repo'), 'baseline', join(dir, 'pred.patch'))).rejects.toThrow(/git add exited 2/)
  })

  it('fails loud when the cached diff exits non-zero', async () => {
    const dir = await tempDir()
    setPlan([{ code: 0 }, { code: 3, stdout: '--- a/x\n+++ b/x\n' }])
    await expect(collectPrediction(workspace('/repo'), 'baseline', join(dir, 'pred.patch'))).rejects.toThrow(/git diff exited 3/)
  })

  it('fails loud when the cached diff spawn fails after emitting stderr', async () => {
    const dir = await tempDir()
    setPlan([{ code: 0 }, { spawnError: 'boom', stderr: 'trace\n', closeAfterError: true }])
    await expect(collectPrediction(workspace('/repo'), 'baseline', join(dir, 'pred.patch'))).rejects.toThrow(/git diff exited 1/)
  })

  it('returns null for an empty diff and writes the patch for a non-empty one', async () => {
    const dir = await tempDir()
    const predictionPath = join(dir, 'pred.patch')
    setPlan([{ code: 0 }, { code: 0, stdout: '' }])
    expect(await collectPrediction(workspace('/repo'), 'baseline', predictionPath)).toBeNull()

    setPlan([{ code: 0 }, { code: 0, stdout: 'diff --git a/x.py b/x.py\n' }])
    expect(await collectPrediction(workspace('/repo'), 'baseline', predictionPath)).toBe(predictionPath)
    const text = await readFile(predictionPath, 'utf8')
    expect(text).toContain('diff --git')
  })

  it('fails loud when the cached diff times out', async () => {
    const dir = await tempDir()
    setPlan([{ code: 0 }, { hang: true }])
    await expect(collectPrediction(workspace('/repo'), 'baseline', join(dir, 'pred.patch'), 20))
      .rejects.toThrow(/git diff exited 1/)
  })
})

describe('verifyVerdict', () => {
  it('reports a reset, clean, or re-apply failure as a failed verdict with detail', async () => {
    const dir = await tempDir()
    const logPath = join(dir, 'verify.log')
    const ws = workspace('/repo', { row: row({ baseCommit: 'abc' }), testPatchPath: join(dir, 'test.patch') })
    setPlan([{ code: 1 }])
    let verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict).toEqual({ passed: false, detail: 'git reset exited 1' })

    setPlan([{ code: 0 }, { code: 2 }])
    verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict.detail).toBe('git clean exited 2')

    setPlan([{ code: 0 }, { code: 0 }, { code: 3 }])
    verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict.detail).toBe('test_patch re-apply exited 3')

    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 4 }])
    verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict.detail).toBe('prediction patch did not apply after reset')
  })

  it('passes on a green pytest and reports a timeout / non-zero pytest', async () => {
    const dir = await tempDir()
    const logPath = join(dir, 'verify.log')
    const ws = workspace('/repo', { row: row({ failToPass: ['tests/x.py::t'] }), testPatchPath: join(dir, 'test.patch') })
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }])
    let verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict.passed).toBe(true)

    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 5 }])
    verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict).toMatchObject({ passed: false })
    expect(verdict.detail).toContain('pytest exited 5')
  })

  it('truncates a long verify log tail on failure', async () => {
    const dir = await tempDir()
    const logPath = join(dir, 'verify-long.log')
    await writeFile(logPath, 'x'.repeat(500))
    const ws = workspace('/repo', { row: row({ failToPass: ['tests/x.py::t'] }), testPatchPath: join(dir, 'test.patch') })
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { code: 5 }])
    const verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 1_000, logPath)
    expect(verdict).toMatchObject({ passed: false })
    expect(verdict.detail).toContain('pytest exited 5')
  })

  it('reports a pytest timeout when the test run hangs', async () => {
    const dir = await tempDir()
    const logPath = join(dir, 'verify.log')
    const ws = workspace('/repo', { row: row({ failToPass: ['tests/x.py::t'] }), testPatchPath: join(dir, 'test.patch') })
    setPlan([{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0 }, { hang: true }])
    const verdict = await verifyVerdict(ws, 'baseline', '/pred.patch', 20, logPath)
    expect(verdict).toEqual({ passed: false, detail: 'verify timeout after 20ms' })
  })
})

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
