/**
 * Run the built-artifact suites in a lane that built first.
 *
 * The unit lane intentionally runs an unbuilt tree, so every suite that needs a
 * `pnpm run build` product skipped itself with no signal. This runner executes
 * exactly the suites `built-artifact-suites.ts` discovers, keeps vitest's JSON
 * report, and prints each suite's executed pass count plus a workflow warning
 * for a suite that still ran nothing.
 *
 * Suites are partitioned by the vitest project that owns them, because one
 * config never collects all three: `*.spec.ts` belongs to the unit config,
 * `*.e2e.ts` to the real-API e2e config (which the fork does not run), and
 * `*.expected.e2e.ts` to the owner-local expected-output config.
 *
 * @module dsh-scripts/run-built-artifact-suites
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBuiltArtifactSuites, summarizeBuiltArtifactSuiteRuns, type VitestReportFile } from './built-artifact-suites.ts'

/** Repo root, derived from this module's location. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The lane's runner budget, matching the fork's slow 2-core unit lane. */
const TEST_TIMEOUT_MS = 30_000

/** Suite families, named by the vitest project that collects them. */
export const SUITE_FAMILIES = ['spec', 'e2e', 'expected'] as const

/** One suite family. */
export type SuiteFamily = typeof SUITE_FAMILIES[number]

/**
 * Classify one discovered suite by the config that collects it.
 * @param file - repo-relative suite path.
 * @returns the family owning the suite.
 */
export function familyOf(file: string): SuiteFamily {
  if (file.endsWith('.expected.e2e.ts')) return 'expected'
  return file.endsWith('.e2e.ts') ? 'e2e' : 'spec'
}

/**
 * Locate the workspace vitest bin, falling back to `PATH`.
 * @returns an executable name usable by `spawnSync`.
 */
function vitestExecutable(): string {
  const name = process.platform === 'win32' ? 'vitest.cmd' : 'vitest'
  const workspaceBin = join(ROOT, 'node_modules', '.bin', name)
  return existsSync(workspaceBin) ? workspaceBin : name
}

/**
 * Run one family and print its suites' pass counts.
 * @param family - family to run.
 * @param suites - repo-relative suites of that family.
 * @returns vitest's exit code for the family.
 */
function runFamily(family: SuiteFamily, suites: readonly string[]): number {
  const reportDir = mkdtempSync(join(tmpdir(), `dsh-built-${family}-`))
  const reportPath = join(reportDir, 'report.json')
  try {
    const result = spawnSync(vitestExecutable(), [
      'run',
      ...family === 'spec' ? [] : ['--config', `vitest.${family}.config.ts`],
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${reportPath}`,
      `--testTimeout=${String(TEST_TIMEOUT_MS)}`,
      `--hookTimeout=${String(TEST_TIMEOUT_MS)}`,
      ...suites,
    ], { cwd: ROOT, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    const reportFiles = (JSON.parse(readFileSync(reportPath, 'utf8')) as { testResults: VitestReportFile[] }).testResults
    for (const run of summarizeBuiltArtifactSuiteRuns(suites, reportFiles)) {
      if (run.warning !== undefined) process.stdout.write(`::warning::${run.warning}\n`)
      else process.stdout.write(`${run.suite}: ${String(run.passed)} passed\n`)
    }
    return result.status ?? 1
  } finally {
    rmSync(reportDir, { recursive: true, force: true })
  }
}

/**
 * Run the requested families of discovered suites.
 * @param families - families to run, in the given order.
 * @returns the highest vitest exit code across the families.
 */
export function runBuiltArtifactSuites(families: readonly SuiteFamily[]): number {
  const discovered = discoverBuiltArtifactSuites(ROOT)
  if (discovered.length === 0) {
    process.stderr.write('run-built-artifact-suites: discovery found no suite; refusing to run an empty lane\n')
    return 1
  }
  let exitCode = 0
  for (const family of families) {
    const suites = discovered.filter(file => familyOf(file) === family)
    if (suites.length === 0) continue
    process.stdout.write(`run-built-artifact-suites: ${family} family (${String(suites.length)} suite(s))\n`)
    exitCode = Math.max(exitCode, runFamily(family, suites))
  }
  return exitCode
}

/* v8 ignore start -- CLI entry: discovery, classification, and summarization are covered by scripts/built-artifact-suites.spec.ts. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requested: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index - 1] === '--family') requested.push(...(process.argv[index] ?? '').split(','))
  }
  const unknown = requested.filter(value => !SUITE_FAMILIES.includes(value as SuiteFamily))
  if (unknown.length > 0) {
    process.stderr.write(`run-built-artifact-suites: unknown --family ${unknown.join(', ')}; expected ${SUITE_FAMILIES.join(', ')}\n`)
    process.exitCode = 1
  } else {
    process.exitCode = runBuiltArtifactSuites(requested.length === 0 ? [...SUITE_FAMILIES] : requested as SuiteFamily[])
  }
}
/* v8 ignore stop */
