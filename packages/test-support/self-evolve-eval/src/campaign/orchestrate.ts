/**
 * P1-10 campaign orchestration: the per-task pipeline (workspace prep → per
 * arm agent run → prediction collection → local FAIL_TO_PASS verdict), the
 * resume-safe `results.json` merging, concurrency, and the dry-run plan.
 *
 * This is the light-weight local path (P-B): no Docker, per-task venv, local
 * pytest verdict. The runner never retries a *verdict*; it retries an agent
 * process crash once (infra, not evidence).
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/campaign/orchestrate
 */

import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EvalTask } from '../types.ts'
import { loadTaskManifest } from '../subset.ts'
import {
  indexSwebenchRows,
  normalizeSwebenchRow,
  readManifestRows,
  type SwebenchRow,
} from './manifest.ts'
import { mergeArmOutcome, type CampaignArm, type PartialTaskOutcome } from './merge.ts'
import { renderEvolvedOverlay } from './overlay.ts'
import {
  collectPrediction,
  prepareTaskWorkspace,
  runAgent,
  verifyVerdict,
  type PreparedWorkspace,
} from './workspace.ts'

/** One planned task entry of a campaign run. */
export interface CampaignPlanEntry {
  taskId: string
  repo: string
  baseCommit: string
  arms: CampaignArm[]
}

/**
 * Plan the arm set for every subset task. `both` yields the paired order
 * (baseline first, then evolved) the decision rule assumes.
 *
 * @param tasks - the subset tasks (underlying order preserved).
 * @param armMode - baseline, evolved, or both.
 * @returns the plan entries.
 */
export function planCampaign(tasks: readonly EvalTask[], armMode: CampaignArm | 'both'): CampaignPlanEntry[] {
  const arms: CampaignArm[] = armMode === 'both' ? ['baseline', 'evolved'] : [armMode]
  return tasks.map(task => ({
    taskId: task.instanceId,
    repo: task.repo,
    baseCommit: task.baseCommit,
    arms: [...arms],
  }))
}

/** Options for {@link runCampaign}. */
export interface CampaignOptions {
  manifestPath: string
  subsetPath: string
  resultsPath: string
  statsPath: string
  workDir: string
  armMode: CampaignArm | 'both'
  profile: string
  /** Absolute path to `apps/cli/src/bin.ts`. */
  dshEntry: string
  /** Absolute module specifier for the tsx ESM hook. */
  tsxImport: string
  /**
   * The evolved arm's workspace-verifier build command, with `{python}`
   * replaced by the per-task venv python.
   */
  buildCommandTemplate: string
  pythonVersion: string
  envTool: 'uv' | 'venv'
  concurrency: number
  agentTimeoutMs: number
  verifyTimeoutMs: number
  setupTimeoutMs: number
  installTimeoutMs: number
  taskLimit?: number
  skipExisting: boolean
  keepWork: boolean
  dryRun: boolean
  dshHome?: string
}

/** Summary of one campaign run. */
export interface CampaignRunResult {
  planned: number
  armRuns: number
  passed: number
  failed: number
  infraErrors: number
  skipped: number
  resultsPath: string
  statsPath: string
}

/**
 * Execute one campaign (or print its plan in dry-run mode). Arms settle
 * independently and persist to `resultsPath` after each completion, so a
 * killed run resumes with `--skip-existing`; error-only rows (no boolean) are
 * infra failures that stay retryable and are never silent at scoring time
 * (`validateResults` rejects an incomplete file).
 *
 * @param options - campaign configuration.
 * @returns the run summary.
 */
export async function runCampaign(options: CampaignOptions): Promise<CampaignRunResult> {
  const subsetTasks = await loadTaskManifest(options.subsetPath)
  const planned = planCampaign(subsetTasks, options.armMode)
  const chosen = options.taskLimit === undefined ? planned : planned.slice(0, options.taskLimit)
  const armRunsTotal = chosen.reduce((sum, entry) => sum + entry.arms.length, 0)

  if (options.dryRun) {
    console.log(`self-evolve-eval campaign (dry run): ${chosen.length} task(s), ${armRunsTotal} arm run(s)`)
    console.log(`  workdir: ${options.workDir}`)
    console.log(`  dsh entry: ${options.dshEntry} (profile: ${options.profile})`)
    console.log(`  baseline: node --import ${options.tsxImport} ${options.dshEntry} --profile ${options.profile} "<problem_statement>"`)
    console.log(`  evolved:  above + --patch <taskDir>/evolved-overlay.yml (build: ${options.buildCommandTemplate})`)
    console.log(`  env tool: ${options.envTool}${options.envTool === 'uv' ? ' (uv must be installed)' : ' (python3 -m venv)'}`)
    for (const entry of chosen.slice(0, 5)) {
      console.log(`  - ${entry.taskId} ${entry.repo}@${entry.baseCommit}`)
    }
    return {
      planned: chosen.length, armRuns: armRunsTotal, passed: 0, failed: 0, infraErrors: 0, skipped: 0,
      resultsPath: options.resultsPath, statsPath: options.statsPath,
    }
  }

  const rowIndex = indexSwebenchRows(await readManifestRows(options.manifestPath))
  await mkdir(options.workDir, { recursive: true })
  await mkdir(dirname(options.resultsPath), { recursive: true })
  const results = await loadResults(options.resultsPath)
  let tasks = results.tasks
  let passed = 0
  let failed = 0
  let infraErrors = 0
  let skipped = 0

  const persist = async (): Promise<void> => {
    await saveResults(options.resultsPath, { ...results, generatedAt: Date.now(), tasks })
  }
  const recordStats = async (entry: string): Promise<void> => {
    await appendFile(options.statsPath, `${entry}\n`, 'utf8')
  }

  await runPool(chosen, options.concurrency, async (entry): Promise<void> => {
    const { taskId, arms } = entry
    const rawRow = rowIndex.get(taskId)
    if (rawRow === undefined) {
      infraErrors += 1
      tasks = foldInfraFailure(tasks, taskId, arms, 'manifest: missing instance row')
      await persist()
      return
    }
    const row = normalizeSwebenchRow(rawRow)
    if (row === null) {
      infraErrors += 1
      tasks = foldInfraFailure(tasks, taskId, arms, 'manifest: incomplete row (needs repo/base_commit/problem_statement/test_patch)')
      await persist()
      return
    }

    let workspace: PreparedWorkspace
    try {
      workspace = await prepareTaskWorkspace({
        workDir: options.workDir, task: entryTask(entry, row), row, pythonVersion: options.pythonVersion,
        envTool: options.envTool, setupTimeoutMs: options.setupTimeoutMs, installTimeoutMs: options.installTimeoutMs,
        logPath: join(options.workDir, entry.taskId, 'setup.log'),
      })
    } catch (error) {
      infraErrors += 1
      const detail = `env: ${errorMessage(error)}`
      tasks = foldInfraFailure(tasks, taskId, arms, detail)
      await persist()
      await recordStats(statLine(Date.now(), taskId, arms[0] ?? 'baseline', 'env', false, 0, null, detail))
      return
    }

    for (const arm of arms) {
      if (options.skipExisting && settledFor(tasks, taskId, arm)) {
        skipped += 1
        continue
      }
      const result = await runArm(workspace, arm, options)
      if (result.passed) passed += 1
      else failed += 1
      tasks = mergeArmOutcome(tasks, taskId, arm, result.passed, result.error)
      await persist()
      await recordStats(
        statLine(Date.now(), taskId, arm, 'verdict', result.passed, result.seconds ?? 0, result.exitCode ?? null, result.error ?? ''),
      )
    }

    if (!options.keepWork && arms.every(arm => settledFor(tasks, taskId, arm))) {
      await rm(workspace.taskDir, { recursive: true, force: true })
    }
  })

  return {
    planned: chosen.length, armRuns: armRunsTotal, passed, failed, infraErrors, skipped,
    resultsPath: options.resultsPath, statsPath: options.statsPath,
  }
}

/** One arm run's outcome for the orchestration. */
interface ArmOutcome {
  passed: boolean
  error?: string
  seconds?: number
  exitCode?: number
}

/**
 * Agent run → prediction → verdict for one arm. A dsh process crash (non-zero
 * exit) is retried once — infra, not evidence; a verdict failure is final.
 */
async function runArm(
  workspace: PreparedWorkspace,
  arm: CampaignArm,
  options: CampaignOptions,
): Promise<ArmOutcome> {
  const taskId = workspace.taskId
  const taskDir = join(options.workDir, taskId)
  const logDir = join(taskDir, 'logs')
  await mkdir(logDir, { recursive: true })
  let overlayPath: string | undefined
  if (arm === 'evolved') {
    overlayPath = join(taskDir, 'evolved-overlay.yml')
    const buildCommand = options.buildCommandTemplate.replaceAll('{python}', workspace.venvPython)
    await writeFile(overlayPath, renderEvolvedOverlay({ buildCommand }))
  }
  const agentLog = join(logDir, `${arm}-agent.log`)
  const started = Date.now()
  const agentOptions = {
    workspace, arm, taskText: workspace.row.problemStatement, profile: options.profile,
    dshEntry: options.dshEntry, tsxImport: options.tsxImport,
    timeoutMs: options.agentTimeoutMs, logPath: agentLog,
    ...(overlayPath === undefined ? {} : { overlayPath }),
    ...(options.dshHome === undefined ? {} : { dshHome: options.dshHome }),
  }
  const first = await runAgent(agentOptions)
  let agentRun = first
  if (first.exitCode !== 0) {
    agentRun = await runAgent(agentOptions)
  }
  const seconds = (Date.now() - started) / 1000
  if (agentRun.spawnError !== null) return { passed: false, error: `agent spawn failed: ${agentRun.spawnError}`, seconds, exitCode: agentRun.exitCode }
  if (agentRun.exitCode !== 0) {
    const extra = agentRun.timeout ? ' (agent timeout)' : ''
    return { passed: false, error: `agent exited ${agentRun.exitCode}${extra} after retry`, seconds, exitCode: agentRun.exitCode }
  }
  const predictionPath = join(taskDir, `prediction-${arm}.patch`)
  let prediction: string | null
  try {
    prediction = await collectPrediction(workspace, arm, predictionPath)
  } catch (error) {
    return { passed: false, error: `prediction collection failed: ${errorMessage(error)}`, seconds }
  }
  if (prediction === null) return { passed: false, error: 'no prediction (empty diff)', seconds, exitCode: 0 }
  const verdict = await verifyVerdict(
    workspace, arm, prediction, options.verifyTimeoutMs, join(logDir, `${arm}-verify.log`),
  )
  return verdict.passed
    ? { passed: true, seconds, exitCode: 0 }
    : { passed: false, error: verdict.detail, seconds, exitCode: 0 }
}

/** Recover the EvalTask view of a plan entry (subset fields + raw row verdict fields). */
function entryTask(entry: CampaignPlanEntry, row: SwebenchRow): EvalTask {
  return {
    instanceId: entry.taskId,
    repo: entry.repo,
    baseCommit: entry.baseCommit,
    failToPass: row.failToPass,
    passToPass: row.passToPass,
  }
}

/** Mark every requested arm with an infra failure (retryable error row). */
function foldInfraFailure(
  tasks: PartialTaskOutcome[],
  taskId: string,
  arms: readonly CampaignArm[],
  detail: string,
): PartialTaskOutcome[] {
  let updated = tasks
  for (const arm of arms) updated = mergeArmOutcome(updated, taskId, arm, undefined, detail)
  return updated
}

/** Whether the arm already has a settled boolean verdict. */
function settledFor(tasks: readonly PartialTaskOutcome[], taskId: string, arm: CampaignArm): boolean {
  const row = tasks.find(candidate => candidate.taskId === taskId)
  if (row === undefined) return false
  return arm === 'baseline' ? row.baselinePassed !== undefined : row.evolvedPassed !== undefined
}

/** The raw results file shape on disk (arms may be open mid-campaign). */
interface RawResultsFile {
  seed?: number
  subsetSize?: number
  generatedAt?: number
  tasks: PartialTaskOutcome[]
}

async function loadResults(path: string): Promise<RawResultsFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { tasks: [] }
  }
  const parsed = JSON.parse(text) as Record<string, unknown>
  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.filter(isPartialTaskOutcome)
    : []
  return {
    ...(typeof parsed.seed === 'number' ? { seed: parsed.seed } : {}),
    ...(typeof parsed.subsetSize === 'number' ? { subsetSize: parsed.subsetSize } : {}),
    ...(typeof parsed.generatedAt === 'number' ? { generatedAt: parsed.generatedAt } : {}),
    tasks,
  }
}

function isPartialTaskOutcome(value: unknown): value is PartialTaskOutcome {
  return typeof value === 'object' && value !== null
    && typeof (value as Record<string, unknown>).taskId === 'string'
}

async function saveResults(path: string, results: RawResultsFile): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(results, null, 2)}\n`)
  await rename(tmp, path)
}

/** One campaign-stats JSONL line. */
function statLine(
  ts: number,
  taskId: string,
  arm: CampaignArm,
  stage: string,
  ok: boolean,
  seconds: number,
  exitCode: number | null,
  detail: string,
): string {
  return JSON.stringify({
    ts, taskId, arm, stage, ok, seconds: Math.round(seconds), ...(exitCode === null ? {} : { exitCode }), detail,
  })
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      if (item === undefined) continue
      await worker(item)
    }
  })
  await Promise.all(workers)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
