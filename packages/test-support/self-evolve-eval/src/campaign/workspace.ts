/**
 * Task workspace preparation and per-arm execution for the P1-10 offline
 * campaign, light-weight local path (P-B): git checkout at the base commit
 * with the test patch applied, a per-task venv, the agent run through
 * `dsh --profile headless`, prediction collection, and the local
 * FAIL_TO_PASS/PASS_TO_PASS verdict.
 *
 * No Docker is required; the verdict runs the pinned test ids directly in the
 * task venv (the README documents the verdict-vs-official-image caveat).
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/campaign/workspace
 */

import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EvalTask } from '../types.ts'
import type { SwebenchRow } from './manifest.ts'
import type { CampaignArm } from './merge.ts'
import { parseTestPatchFiles } from './patch.ts'

/** Grace period after SIGTERM before a killed process group gets SIGKILL. */
const SIGKILL_GRACE_MS = 10_000

/** Result of one spawned command. */
export interface ExecResult {
  exitCode: number
  seconds: number
  /** True when the timeout fired (the process group was killed). */
  timeout: boolean
  /** Spawn failure message (program not found etc.), or null. */
  spawnError: string | null
}

/** Kill a detached process group (best effort; already-gone groups are fine). */
function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch {
    // The group already ended; its exit event settles the promise.
  }
}

/**
 * Run one command, appending stdout/stderr to `logPath`, killing the whole
 * process group on timeout. `detached: true` gives the child its own group,
 * so the kill reaches every tool/agent descendant.
 *
 * @param program - executable path or name.
 * @param args - argument vector.
 * @param options - cwd, environment overrides, timeout, log file.
 * @returns exit code, elapsed seconds, timeout and spawn-failure facts.
 */
async function exec(
  program: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number; logPath: string },
): Promise<ExecResult> {
  await mkdir(dirname(options.logPath), { recursive: true })
  const logFd = openSync(options.logPath, 'a')
  const started = Date.now()
  try {
    return await new Promise<ExecResult>((resolve): void => {
      const child = spawn(program, [...args], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        detached: true,
        stdio: ['ignore', logFd, logFd],
      })
      let settled = false
      const finish = (exitCode: number | null, timeout: boolean, spawnError: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ exitCode: exitCode ?? 1, seconds: (Date.now() - started) / 1000, timeout, spawnError })
      }
      const timer = setTimeout(() => {
        killProcessGroup(child.pid, 'SIGTERM')
        /* v8 ignore next -- best-effort SIGKILL escalation: the grace period far exceeds any test run's lifetime. */
        const escalation = setTimeout(() => { killProcessGroup(child.pid, 'SIGKILL') }, SIGKILL_GRACE_MS)
        escalation.unref()
        finish(null, true, null)
      }, options.timeoutMs)
      timer.unref()
      child.on('error', (error: Error) => { finish(1, false, error.message) })
      child.on('close', (code) => { finish(code, false, null) })
    })
  } finally {
    closeSync(logFd)
  }
}

/** Result of one captured-command run (stdout held in memory). */
export interface CapturedResult {
  exitCode: number
  output: string
  spawnError: string | null
}

/**
 * Run one command and capture its combined stdout/stderr. Used for the
 * prediction diff, whose text is the collected patch itself.
 */
async function execCapture(
  program: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CapturedResult> {
  return await new Promise<CapturedResult>((resolve): void => {
    const child = spawn(program, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    const finish = (exitCode: number | null, spawnError: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: exitCode ?? 1, output, spawnError })
    }
    const timer = setTimeout(() => {
      killProcessGroup(child.pid, 'SIGTERM')
      /* v8 ignore next -- best-effort SIGKILL escalation: the grace period far exceeds any test run's lifetime. */
      const escalation = setTimeout(() => { killProcessGroup(child.pid, 'SIGKILL') }, SIGKILL_GRACE_MS)
      escalation.unref()
      finish(null, null)
    }, options.timeoutMs)
    timer.unref()
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
    child.on('error', (error: Error) => { finish(1, error.message) })
    child.on('close', (code) => { finish(code, null) })
  })
}

/** One task's prepared local environment. */
export interface PreparedWorkspace {
  taskId: string
  taskDir: string
  /** The shared base checkout (venv install runs here). */
  repoBase: string
  /** One independent checkout per arm (the agent never sees the other arm). */
  repoArms: Record<CampaignArm, string>
  venv: string
  venvPython: string
  testPatchPath: string
  /** Files the test_patch touches; agent edits to these are excluded from predictions. */
  testPatchFiles: string[]
  row: SwebenchRow
}

/** Options for {@link prepareTaskWorkspace}. */
export interface PrepareTaskOptions {
  workDir: string
  task: EvalTask
  row: SwebenchRow
  pythonVersion: string
  envTool: 'uv' | 'venv'
  setupTimeoutMs: number
  installTimeoutMs: number
  logPath: string
}

/**
 * Prepare one task's local environment: clone the repo and check out the
 * base commit, create an independent arm checkout per side with the test
 * patch applied, provision the shared venv, and run the dataset `install`
 * command. Throws with a diagnostic on any step failure.
 *
 * @param options - task, raw row, toolchain, and timeouts.
 * @returns the prepared workspace.
 */
export async function prepareTaskWorkspace(options: PrepareTaskOptions): Promise<PreparedWorkspace> {
  const { workDir, task, row, pythonVersion, envTool, setupTimeoutMs, installTimeoutMs, logPath } = options
  const taskDir = join(workDir, task.instanceId)
  await mkdir(taskDir, { recursive: true })
  const repoBase = join(taskDir, 'repo')
  const repoArms: Record<CampaignArm, string> = {
    baseline: join(taskDir, 'arm-baseline'),
    evolved: join(taskDir, 'arm-evolved'),
  }
  const venv = join(taskDir, '.venv')
  const testPatchPath = join(taskDir, 'test.patch')
  const testPatchFiles = parseTestPatchFiles(row.testPatch)
  await writeFile(testPatchPath, row.testPatch)

  if (envTool === 'uv') {
    const venvResult = await exec('uv', ['venv', '--python', pythonVersion, '--seed', venv], {
      cwd: taskDir, timeoutMs: setupTimeoutMs, logPath,
    })
    if (venvResult.spawnError !== null) {
      throw new Error(`uv venv failed (${venvResult.spawnError}); install uv or pass --env-tool venv`)
    }
    if (venvResult.exitCode !== 0) throw new Error(`uv venv exited ${venvResult.exitCode}`)
  } else {
    const venvResult = await exec('python3', ['-m', 'venv', venv], { cwd: taskDir, timeoutMs: setupTimeoutMs, logPath })
    if (venvResult.exitCode !== 0) throw new Error(`python3 -m venv exited ${venvResult.exitCode}`)
  }

  const cloneUrl = `https://github.com/${row.repo}.git`
  const cloneResult = await exec('git', ['clone', '--quiet', '--no-tags', cloneUrl, repoBase], {
    cwd: taskDir, timeoutMs: setupTimeoutMs, logPath,
  })
  if (cloneResult.exitCode !== 0) throw new Error(`clone ${row.repo} exited ${cloneResult.exitCode}`)
  const checkoutResult = await exec('git', ['checkout', '--quiet', row.baseCommit], {
    cwd: repoBase, timeoutMs: setupTimeoutMs, logPath,
  })
  if (checkoutResult.exitCode !== 0) throw new Error(`checkout ${row.baseCommit} exited ${checkoutResult.exitCode}`)

  for (const arm of ['baseline', 'evolved'] as const) {
    const armDir = repoArms[arm]
    const cloneArm = await exec('git', ['clone', '--quiet', '--local', repoBase, armDir], {
      cwd: taskDir, timeoutMs: setupTimeoutMs, logPath,
    })
    if (cloneArm.exitCode !== 0) throw new Error(`clone ${arm} arm exited ${cloneArm.exitCode}`)
    const checkoutArm = await exec('git', ['checkout', '--quiet', row.baseCommit], {
      cwd: armDir, timeoutMs: setupTimeoutMs, logPath,
    })
    if (checkoutArm.exitCode !== 0) throw new Error(`checkout ${arm} arm exited ${checkoutArm.exitCode}`)
    const applyTest = await exec('git', ['apply', '--whitespace=nowarn', testPatchPath], {
      cwd: armDir, timeoutMs: setupTimeoutMs, logPath,
    })
    if (applyTest.exitCode !== 0) throw new Error(`test_patch did not apply on the ${arm} arm`)
  }

  if (row.install !== undefined) {
    const installResult = await exec('bash', ['-lc', row.install], {
      cwd: repoBase,
      env: {
        /* v8 ignore next -- a test/CI environment always sets PATH, so the empty fallback is unreachable. */
        PATH: `${venv}/bin:${process.env.PATH ?? ''}`,
        VIRTUAL_ENV: venv,
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
      },
      timeoutMs: installTimeoutMs,
      logPath,
    })
    if (installResult.exitCode !== 0) throw new Error(`install command exited ${installResult.exitCode}`)
  }

  return {
    taskId: task.instanceId,
    taskDir,
    repoBase,
    repoArms,
    venv,
    venvPython: join(venv, 'bin', 'python'),
    testPatchPath,
    testPatchFiles,
    row,
  }
}

/** Options for {@link runAgent}. */
export interface AgentRunOptions {
  workspace: PreparedWorkspace
  arm: CampaignArm
  taskText: string
  profile: string
  /** Absolute path to `apps/cli/src/bin.ts` (the dsh source entry). */
  dshEntry: string
  /** Absolute module specifier for the tsx ESM hook (`node --import <this>`). */
  tsxImport: string
  /** Evolved-arm overlay (the built-in dsh `--patch` overlay path), or none. */
  overlayPath?: string
  timeoutMs: number
  logPath: string
  dshHome?: string
}

/**
 * Run one agent arm: `node --import tsx/esm <dshEntry> --profile <profile>
 * [--patch <overlay>] "<taskText>"` with the arm checkout as cwd. The agent
 * sees a fresh checkout (base commit + test patch) and no other arm's edits.
 *
 * @param options - agent run configuration.
 * @returns the dsh process result (exit 0 = loop completed, 1 = terminal error).
 */
export async function runAgent(options: AgentRunOptions): Promise<ExecResult> {
  const args = ['--import', options.tsxImport, options.dshEntry, '--profile', options.profile]
  if (options.overlayPath !== undefined) args.push('--patch', options.overlayPath)
  args.push(options.taskText)
  return exec(process.execPath, args, {
    cwd: options.workspace.repoArms[options.arm],
    env: {
      DSH_TELEMETRY_DISABLED: '1',
      ...(options.dshHome === undefined ? {} : { DSH_HOME: options.dshHome }),
    },
    timeoutMs: options.timeoutMs,
    logPath: options.logPath,
  })
}

/**
 * Collect the agent's prediction patch (staged work tree diff, excluding
 * `.dsh/` and every test file the test patch owns). Returns the patch file
 * path, or null when the working tree carries no change.
 *
 * @param workspace - the prepared task environment.
 * @param arm - which arm's checkout to inspect.
 * @param predictionPath - where to write the collected patch.
 * @param timeoutMs - git subprocess wall-clock cap (default 120s; injectable for tests).
 * @returns the prediction patch path, or null for an empty diff.
 */
export async function collectPrediction(
  workspace: PreparedWorkspace,
  arm: CampaignArm,
  predictionPath: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  const repo = workspace.repoArms[arm]
  const stage = await exec('git', ['add', '-A', '--', ':(exclude).dsh'], {
    cwd: repo, timeoutMs, logPath: predictionPath,
  })
  if (stage.exitCode !== 0) throw new Error(`git add exited ${stage.exitCode}`)
  const excludes = [':(exclude).dsh', ...workspace.testPatchFiles.map(file => `:(exclude)${file}`)]
  const diff = await execCapture('git', ['diff', '--cached', '--', ...excludes], { cwd: repo, timeoutMs })
  if (diff.exitCode !== 0) throw new Error(`git diff exited ${diff.exitCode}`)
  if (diff.output.trim().length === 0) return null
  await writeFile(predictionPath, diff.output)
  return predictionPath
}

/** One arm's final verdict. */
export interface Verdict {
  passed: boolean
  detail: string
}

/**
 * Verify one arm: reset the checkout to a pristine base, re-apply the test
 * patch and the prediction, then run the pinned FAIL_TO_PASS and PASS_TO_PASS
 * ids with `python -m pytest`. A nonzero pytest exit (including the timeout
 * kill) is a failed verdict; an un-appliable prediction is a failed verdict
 * too (the agent edited files a clean patch cannot reproduce).
 *
 * @param workspace - the prepared task environment.
 * @param arm - which arm's checkout to verify.
 * @param predictionPath - the collected prediction patch.
 * @param timeoutMs - pytest wall-clock cap.
 * @param logPath - pytest log file.
 * @returns the verdict and a short detail (log tail on failure).
 */
export async function verifyVerdict(
  workspace: PreparedWorkspace,
  arm: CampaignArm,
  predictionPath: string,
  timeoutMs: number,
  logPath: string,
): Promise<Verdict> {
  const repo = workspace.repoArms[arm]
  const base = workspace.row.baseCommit
  const reset = await exec('git', ['reset', '--hard', '--quiet', base], { cwd: repo, timeoutMs: 120_000, logPath })
  if (reset.exitCode !== 0) return { passed: false, detail: `git reset exited ${reset.exitCode}` }
  const clean = await exec('git', ['clean', '-fdx', '--quiet'], { cwd: repo, timeoutMs: 120_000, logPath })
  if (clean.exitCode !== 0) return { passed: false, detail: `git clean exited ${clean.exitCode}` }
  const applyTest = await exec('git', ['apply', '--whitespace=nowarn', workspace.testPatchPath], {
    cwd: repo, timeoutMs: 120_000, logPath,
  })
  if (applyTest.exitCode !== 0) return { passed: false, detail: `test_patch re-apply exited ${applyTest.exitCode}` }
  const applyPrediction = await exec('git', ['apply', predictionPath], { cwd: repo, timeoutMs: 120_000, logPath })
  if (applyPrediction.exitCode !== 0) return { passed: false, detail: 'prediction patch did not apply after reset' }

  const ids = [...workspace.row.failToPass, ...workspace.row.passToPass]
  const test = await exec(workspace.venvPython, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...ids], {
    cwd: repo,
    env: {
      /* v8 ignore next -- a test/CI environment always sets PATH, so the empty fallback is unreachable. */
      PATH: `${workspace.venv}/bin:${process.env.PATH ?? ''}`,
      VIRTUAL_ENV: workspace.venv,
      PYTHONUNBUFFERED: '1',
    },
    timeoutMs,
    logPath,
  })
  if (test.exitCode === 0) return { passed: true, detail: `FAIL_TO_PASS/PASS_TO_PASS green in ${Math.round(test.seconds)}s` }
  if (test.timeout) return { passed: false, detail: `verify timeout after ${timeoutMs}ms` }
  return { passed: false, detail: `pytest exited ${test.exitCode}; ${await tailOf(logPath, 400)}` }
}

/** Last `maxChars` of a file, or an empty string when unreadable. */
async function tailOf(path: string, maxChars: number): Promise<string> {
  try {
    const text = await readFile(path, 'utf8')
    return text.length > maxChars ? text.slice(-maxChars) : text
  } catch {
    /* v8 ignore next -- an unreadable log yields an empty detail; the verify path always creates the file. */
    return ''
  }
}
