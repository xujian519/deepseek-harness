/** Reject test skips beyond the count recorded for this platform, so a silently skipped path turns the gate red. */

import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baselinePath = 'scripts/test-skip-baseline.json'
const defaultReportPath = 'vitest-report.json'

/** Cases one platform's recorded test run reported and skipped. */
export interface SkipBudget {
  /** Cases the run reported. */
  cases: number
  /** Cases the run skipped. */
  skipped: number
}

/** Recorded skip budgets, keyed by `process.platform`. */
export type SkipBaseline = Record<string, SkipBudget>

/** One test file's skipped cases. */
export interface SkippedFile {
  /** Repository-relative path with forward slashes. */
  file: string
  /** Cases this file skipped. */
  skipped: number
}

/** One run's skip inventory. */
export interface SkipReport {
  /** Cases the run reported. */
  cases: number
  /** Cases the run skipped. */
  skipped: number
  /** Files with at least one skipped case, most skipped first. */
  files: SkippedFile[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function toRepoPath(name: string, repoRoot: string): string {
  return (isAbsolute(name) ? relative(repoRoot, name) : name).replaceAll('\\', '/')
}

function readBaseline(repoRoot: string): SkipBaseline {
  const value: unknown = JSON.parse(readFileSync(resolve(repoRoot, baselinePath), 'utf8'))
  if (!isRecord(value)) throw new Error('verify-test-skips: baseline must be a platform-to-budget object')
  const baseline: SkipBaseline = {}
  for (const [platform, budget] of Object.entries(value)) {
    if (platform === '' || !isRecord(budget) || !isCount(budget.cases) || !isCount(budget.skipped)
      || budget.skipped > budget.cases) {
      throw new Error(`verify-test-skips: invalid baseline budget for ${platform}`)
    }
    baseline[platform] = { cases: budget.cases, skipped: budget.skipped }
  }
  return baseline
}

/**
 * Read one vitest JSON report into its skip inventory.
 *
 * Files whose cases all skip still appear here; the inventory is what makes a silent skip legible.
 * @param reportPath - path to a `--reporter=json --outputFile` report.
 * @param repoRoot - root that absolute report file names are made relative to.
 * @returns reported totals and the files with at least one skipped case.
 * @throws when the report is missing, malformed, or names no test result.
 */
export function readSkipReport(reportPath: string, repoRoot: string): SkipReport {
  const value: unknown = JSON.parse(readFileSync(reportPath, 'utf8'))
  if (!isRecord(value)) throw new Error('verify-test-skips: report must be a JSON object')
  if (!isCount(value.numTotalTests) || !isCount(value.numPendingTests)) {
    throw new Error('verify-test-skips: report is missing numTotalTests or numPendingTests')
  }
  if (!Array.isArray(value.testResults) || value.testResults.length === 0) {
    throw new Error('verify-test-skips: report names no test result; the skip inventory would be empty')
  }
  const files: SkippedFile[] = []
  for (const result of value.testResults) {
    if (!isRecord(result) || typeof result.name !== 'string') {
      throw new Error('verify-test-skips: report test result is missing a file name')
    }
    const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : []
    const skipped = assertions.filter(entry => isRecord(entry) && (entry.status === 'skipped' || entry.status === 'pending')).length
    if (skipped > 0) files.push({ file: toRepoPath(result.name, repoRoot), skipped })
  }
  files.sort((left, right) => right.skipped - left.skipped || left.file.localeCompare(right.file))
  return { cases: value.numTotalTests, skipped: value.numPendingTests, files }
}

function formatInventory(files: readonly SkippedFile[]): string {
  return files.map(entry => `  ${String(entry.skipped).padStart(4)}  ${entry.file}`).join('\n')
}

/**
 * Enforce the skip budget recorded for the current platform.
 *
 * The platform's recorded count is a ceiling, not a forecast: skips vary by platform because each
 * one runs the suites the others cannot, so a budget is recorded per platform rather than shared.
 * @param repoRoot - repository root holding the baseline.
 * @param reportPath - vitest JSON report to read.
 * @param update - rewrite this platform's budget from the run instead of comparing against it.
 * @returns the observed skip count.
 * @throws when the platform is unrecorded, the report is unusable, or skips exceed the budget.
 */
export function verifyTestSkips(repoRoot: string, reportPath: string, update = false): number {
  const report = readSkipReport(reportPath, repoRoot)
  const baseline = readBaseline(repoRoot)
  const platform = process.platform
  if (update) {
    baseline[platform] = { cases: report.cases, skipped: report.skipped }
    writeFileSync(resolve(repoRoot, baselinePath),
      `${JSON.stringify(Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`)
    return report.skipped
  }
  const budget = baseline[platform]
  if (budget === undefined) {
    throw new Error(`verify-test-skips: ${platform} has no recorded budget. Record this run with`
      + ' pnpm run verify-test-skips -- --report <path> --update, and say why each skip below is acceptable.\n'
      + `  this run: ${String(report.skipped)} skipped of ${String(report.cases)}\n${formatInventory(report.files)}`)
  }
  if (report.skipped > budget.skipped) {
    throw new Error(`verify-test-skips: ${platform} skipped ${String(report.skipped - budget.skipped)} case(s) more`
      + ` than the recorded ${String(budget.skipped)}. A skip is not a pass: give the path a signal (a fixture,`
      + ' a cheaper assertion, or CI-time dependencies) or record the budget deliberately with --update.\n'
      + formatInventory(report.files))
  }
  if (report.skipped < budget.skipped) {
    console.log(`verify-test-skips: ${platform} skipped ${String(report.skipped)}, below the recorded`
      + ` ${String(budget.skipped)}; tighten the budget with --update.`)
  }
  return report.skipped
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  try {
    const args = process.argv.slice(2)
    let reportPath = defaultReportPath
    let update = false
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--update') update = true
      else if (args[index] === '--report' && args[index + 1] !== undefined) {
        reportPath = args[index + 1] as string
        index += 1
      } else throw new Error('Usage: pnpm run verify-test-skips [--report <path>] [--update]')
    }
    const skipped = verifyTestSkips(root, resolve(root, reportPath), update)
    console.log(`verify-test-skips: ${String(skipped)} skipped case(s) within the ${process.platform} budget.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
