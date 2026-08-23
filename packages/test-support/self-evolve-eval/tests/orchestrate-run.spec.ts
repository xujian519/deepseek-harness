import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCampaign, type CampaignOptions } from '../src/campaign/orchestrate.ts'
import type { EvalTask } from '../src/types.ts'

const { mocks } = vi.hoisted(() => {
  const loadTaskManifest = vi.fn()
  const readManifestRows = vi.fn()
  const indexSwebenchRows = vi.fn()
  const normalizeSwebenchRow = vi.fn()
  const prepareTaskWorkspace = vi.fn()
  const runAgent = vi.fn()
  const collectPrediction = vi.fn()
  const verifyVerdict = vi.fn()
  return {
    mocks: {
      loadTaskManifest, readManifestRows, indexSwebenchRows, normalizeSwebenchRow,
      prepareTaskWorkspace, runAgent, collectPrediction, verifyVerdict,
    },
  }
})

vi.mock('../src/subset.ts', () => ({ loadTaskManifest: mocks.loadTaskManifest }))
vi.mock('../src/campaign/manifest.ts', () => ({
  readManifestRows: mocks.readManifestRows,
  indexSwebenchRows: mocks.indexSwebenchRows,
  normalizeSwebenchRow: mocks.normalizeSwebenchRow,
}))
vi.mock('../src/campaign/workspace.ts', () => ({
  prepareTaskWorkspace: mocks.prepareTaskWorkspace,
  runAgent: mocks.runAgent,
  collectPrediction: mocks.collectPrediction,
  verifyVerdict: mocks.verifyVerdict,
}))

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'self-evolve-orch-'))
  tempDirs.push(dir)
  return dir
}

function task(instanceId: string): EvalTask {
  return { instanceId, repo: 'a/b', baseCommit: 'abc', failToPass: ['tests/x.py::t'], passToPass: [] }
}

const workspace = (taskId: string) => ({
  taskId,
  taskDir: `/work/${taskId}`,
  repoArms: { baseline: `/work/${taskId}/arm-baseline`, evolved: `/work/${taskId}/arm-evolved` },
  venv: `/work/${taskId}/.venv`,
  venvPython: `/work/${taskId}/.venv/bin/python`,
  testPatchPath: `/work/${taskId}/test.patch`,
  testPatchFiles: [],
  row: {
    problemStatement: 'solve this', baseCommit: 'abc', repo: 'a/b', instanceId: taskId,
    testPatch: 'diff', failToPass: ['tests/x.py::t'], passToPass: [],
  },
})

function options(dir: string, overrides: Partial<CampaignOptions> = {}): CampaignOptions {
  return {
    manifestPath: join(dir, 'manifest.jsonl'),
    subsetPath: join(dir, 'subset.json'),
    resultsPath: join(dir, 'results.json'),
    statsPath: join(dir, 'stats.jsonl'),
    workDir: join(dir, 'work'),
    armMode: 'both' as const,
    profile: 'headless',
    dshEntry: '/apps/bin.ts',
    tsxImport: 'tsx/esm',
    buildCommandTemplate: '{python} -m compileall -q .',
    pythonVersion: '3.11',
    envTool: 'venv' as const,
    concurrency: 4,
    agentTimeoutMs: 1_000,
    verifyTimeoutMs: 1_000,
    setupTimeoutMs: 1_000,
    installTimeoutMs: 1_000,
    skipExisting: false,
    keepWork: false,
    dryRun: false,
    ...overrides,
  }
}

function installManifest() {
  mocks.readManifestRows.mockResolvedValue([
    { instance_id: 't-ok', repo: 'a/b', base_commit: 'abc', problem_statement: 'p', test_patch: 'diff', FAIL_TO_PASS: ['x'] },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runCampaign execute path', () => {
  it('runs both arms of a healthy task to a green verdict', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-ok')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-ok', { instance_id: 't-ok' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-ok').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-ok'))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockResolvedValue('/work/t-ok/pred.patch')
    mocks.verifyVerdict.mockResolvedValue({ passed: true, detail: 'ok' })

    const summary = await runCampaign(options(dir, { dshHome: '/home' }))
    expect(summary.planned).toBe(1)
    expect(summary.armRuns).toBe(2)
    expect(summary.passed).toBe(2)
    expect(summary.failed).toBe(0)
    expect(mocks.runAgent).toHaveBeenCalledTimes(2)
    expect(mocks.verifyVerdict).toHaveBeenCalledTimes(2)
    const results = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8')) as { tasks: unknown[] }
    expect(results.tasks).toHaveLength(1)
  })

  it('marks an infra failure when the manifest has no row for a task', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-missing')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map())
    const summary = await runCampaign(options(dir))
    expect(summary.infraErrors).toBe(1)
    expect(mocks.prepareTaskWorkspace).not.toHaveBeenCalled()
  })

  it('marks an infra failure when the raw row cannot be normalized', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-bad')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-bad', { instance_id: 't-bad' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(null)
    const summary = await runCampaign(options(dir))
    expect(summary.infraErrors).toBe(1)
    expect(mocks.prepareTaskWorkspace).not.toHaveBeenCalled()
  })

  it('marks an infra failure when workspace prep throws', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-prep')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-prep', { instance_id: 't-prep' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-prep').row)
    mocks.prepareTaskWorkspace.mockRejectedValue('env clone failed')
    const summary = await runCampaign(options(dir))
    expect(summary.infraErrors).toBe(1)
    const stats = await readFile(join(dir, 'stats.jsonl'), 'utf8')
    const lines = stats.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { arm: string; stage: string })
    expect(lines).toHaveLength(2)
    expect(lines.map(line => line.arm).sort()).toEqual(['baseline', 'evolved'])
    expect(lines.every(line => line.stage === 'env')).toBe(true)
  })

  it('retries a crashed agent once and reports the terminal exit', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-crash')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-crash', { instance_id: 't-crash' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-crash').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-crash'))
    mocks.runAgent.mockResolvedValue({ exitCode: 3, seconds: 1, timeout: false, spawnError: null })
    const summary = await runCampaign(options(dir, { armMode: 'baseline' }))
    expect(mocks.runAgent).toHaveBeenCalledTimes(2)
    expect(summary.failed).toBe(1)
    expect(mocks.collectPrediction).not.toHaveBeenCalled()
  })

  it('does not retry a timed-out agent and reports it as final', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-timeout')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-timeout', { instance_id: 't-timeout' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-timeout').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-timeout'))
    mocks.runAgent.mockResolvedValue({ exitCode: 1, seconds: 1800, timeout: true, spawnError: null })
    const summary = await runCampaign(options(dir, { armMode: 'baseline' }))
    expect(mocks.runAgent).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
    const results = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8')) as { tasks: Array<{ baselineError?: string }> }
    expect(results.tasks[0]?.baselineError).toContain('agent timeout')
    expect(results.tasks[0]?.baselineError).not.toContain('after retry')
  })

  it('reports a spawn failure and a timed-out agent without a retry verdict', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-spawn'), task('t-timeout')])
    installManifest()
    const rows = new Map([
      ['t-spawn', { instance_id: 't-spawn' }],
      ['t-timeout', { instance_id: 't-timeout' }],
    ])
    mocks.indexSwebenchRows.mockReturnValue(rows)
    mocks.normalizeSwebenchRow.mockImplementation((raw: { instance_id: string }) => ({ ...workspace(raw.instance_id).row }))
    mocks.prepareTaskWorkspace.mockImplementation(({ task }: { task: { instanceId: string } }) => workspace(task.instanceId))
    mocks.runAgent.mockImplementation(({ workspace: ws }: { workspace: { taskId: string } }) =>
      ws.taskId === 't-spawn'
        ? { exitCode: 1, seconds: 1, timeout: false, spawnError: 'crash' }
        : { exitCode: 1, seconds: 1, timeout: true, spawnError: null })
    const summary = await runCampaign(options(dir, { armMode: 'baseline', concurrency: 1 }))
    expect(summary.failed).toBe(2)
  })

  it('reports a prediction collection failure and an empty diff as failures', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-pred'), task('t-empty')])
    installManifest()
    const rows = new Map([
      ['t-pred', { instance_id: 't-pred' }],
      ['t-empty', { instance_id: 't-empty' }],
    ])
    mocks.indexSwebenchRows.mockReturnValue(rows)
    mocks.normalizeSwebenchRow.mockImplementation((raw: { instance_id: string }) => ({ ...workspace(raw.instance_id).row }))
    mocks.prepareTaskWorkspace.mockImplementation(({ task }: { task: { instanceId: string } }) => workspace(task.instanceId))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockImplementation((ws: { taskId: string }) =>
      ws.taskId === 't-pred' ? Promise.reject(new Error('git diff exited 1')) : Promise.resolve(null))
    const summary = await runCampaign(options(dir, { armMode: 'baseline', concurrency: 1 }))
    expect(summary.failed).toBe(2)
  })

  it('records a failed verdict and a passing verdict for the two arms', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-verdict')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-verdict', { instance_id: 't-verdict' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-verdict').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-verdict'))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockResolvedValue('/work/t-verdict/pred.patch')
    mocks.verifyVerdict.mockImplementation((_ws: { taskId: string }, arm: string) =>
      arm === 'baseline'
        ? { passed: false, detail: 'pytest exited 5' }
        : { passed: true, detail: 'ok' })
    const summary = await runCampaign(options(dir))
    expect(summary.failed).toBe(1)
    expect(summary.passed).toBe(1)
  })

  it('folds an unexpected verdict error into a failed arm instead of aborting', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-verdict-throw')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-verdict-throw', { instance_id: 't-verdict-throw' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-verdict-throw').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-verdict-throw'))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockResolvedValue('/work/t-verdict-throw/pred.patch')
    mocks.verifyVerdict.mockRejectedValue(new Error('boom'))
    const summary = await runCampaign(options(dir, { armMode: 'baseline' }))
    expect(summary.failed).toBe(1)
    expect(summary.infraErrors).toBe(0)
    const results = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8')) as { tasks: Array<{ baselineError?: string }> }
    expect(results.tasks[0]?.baselineError).toContain('verdict failed: boom')
  })

  it('persists every arm under concurrency without dropping rows', async () => {
    const dir = await tempDir()
    const tasks = [task('t-a'), task('t-b')]
    mocks.loadTaskManifest.mockResolvedValue(tasks)
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map(tasks.map(t => [t.instanceId, { instance_id: t.instanceId }])))
    mocks.normalizeSwebenchRow.mockImplementation((raw: { instance_id: string }) => ({ ...workspace(raw.instance_id).row }))
    mocks.prepareTaskWorkspace.mockImplementation(({ task: t }: { task: { instanceId: string } }) => workspace(t.instanceId))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockResolvedValue('/work/x/pred.patch')
    mocks.verifyVerdict.mockResolvedValue({ passed: true, detail: 'ok' })
    const summary = await runCampaign(options(dir, { concurrency: 4 }))
    expect(summary.passed).toBe(4)
    const results = JSON.parse(await readFile(join(dir, 'results.json'), 'utf8')) as {
      tasks: Array<{ taskId: string; baselinePassed?: boolean; evolvedPassed?: boolean }>
    }
    const byId = new Map(results.tasks.map(row => [row.taskId, row]))
    expect(byId.get('t-a')?.baselinePassed).toBe(true)
    expect(byId.get('t-a')?.evolvedPassed).toBe(true)
    expect(byId.get('t-b')?.baselinePassed).toBe(true)
    expect(byId.get('t-b')?.evolvedPassed).toBe(true)
  })

  it('skips a settled arm and keeps the working tree when asked', async () => {
    const dir = await tempDir()
    const resultsPath = join(dir, 'results.json')
    await writeFile(resultsPath, JSON.stringify({ tasks: [{ taskId: 't-skip', baselinePassed: true }] }))
    mocks.loadTaskManifest.mockResolvedValue([task('t-skip')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-skip', { instance_id: 't-skip' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-skip').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-skip'))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockResolvedValue('/work/t-skip/pred.patch')
    mocks.verifyVerdict.mockResolvedValue({ passed: true, detail: 'ok' })
    const summary = await runCampaign(options(dir, { skipExisting: true, keepWork: true, resultsPath }))
    expect(summary.skipped).toBe(1)
    expect(mocks.runAgent).toHaveBeenCalledTimes(1)
  })

  it('honors a task limit', async () => {
    const dir = await tempDir()
    mocks.loadTaskManifest.mockResolvedValue([task('t-1'), task('t-2'), task('t-3')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map())
    const summary = await runCampaign(options(dir, { taskLimit: 2, dryRun: true }))
    expect(summary.planned).toBe(2)
    expect(summary.armRuns).toBe(4)
  })

  it('does not skip an arm when the results file has no settled row for the task', async () => {
    const dir = await tempDir()
    const resultsPath = join(dir, 'results.json')
    await writeFile(resultsPath, JSON.stringify({ tasks: [{ taskId: 't-other', baselinePassed: true }] }))
    mocks.loadTaskManifest.mockResolvedValue([task('t-new')])
    installManifest()
    mocks.indexSwebenchRows.mockReturnValue(new Map([['t-new', { instance_id: 't-new' }]]))
    mocks.normalizeSwebenchRow.mockReturnValue(workspace('t-new').row)
    mocks.prepareTaskWorkspace.mockResolvedValue(workspace('t-new'))
    mocks.runAgent.mockResolvedValue({ exitCode: 0, seconds: 1, timeout: false, spawnError: null })
    mocks.collectPrediction.mockResolvedValue('/work/t-new/pred.patch')
    mocks.verifyVerdict.mockResolvedValue({ passed: true, detail: 'ok' })
    const summary = await runCampaign(options(dir, { skipExisting: true, resultsPath }))
    expect(summary.skipped).toBe(0)
    expect(mocks.runAgent).toHaveBeenCalledTimes(2)
  })

  it('recovers result metadata and tolerates a non-array tasks field', async () => {
    const dir = await tempDir()
    const resultsPath = join(dir, 'results.json')
    await writeFile(resultsPath, JSON.stringify({ seed: 1, subsetSize: 2, generatedAt: 3, tasks: 'nope' }))
    mocks.loadTaskManifest.mockResolvedValue([])
    const summary = await runCampaign(options(dir, { resultsPath }))
    expect(summary.planned).toBe(0)
  })

  it('fails loud on a corrupt results file instead of overwriting it', async () => {
    const dir = await tempDir()
    const resultsPath = join(dir, 'results.json')
    await writeFile(resultsPath, '{ not json')
    mocks.loadTaskManifest.mockResolvedValue([])
    await expect(runCampaign(options(dir, { resultsPath }))).rejects.toThrow(/results file .* not valid JSON/)
  })

  it('fails loud when the results file is not a JSON object', async () => {
    const dir = await tempDir()
    const resultsPath = join(dir, 'results.json')
    await writeFile(resultsPath, '"just a string"')
    mocks.loadTaskManifest.mockResolvedValue([])
    await expect(runCampaign(options(dir, { resultsPath }))).rejects.toThrow(/results file .* not a JSON object/)
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
