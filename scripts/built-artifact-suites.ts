/**
 * Discover the suites that skip themselves when a `pnpm run build` product is
 * missing.
 *
 * Those suites carry no signal in a lane that does not build, and their skips
 * are silent. `--list` prints them for the CI lane that builds first, and
 * `--report` reads a vitest JSON report to print each one's executed pass count
 * and warn about the ones that still reported no pass.
 *
 * @module dsh-scripts/built-artifact-suites
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root, derived from this module's location. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories holding test sources. */
const TEST_ROOTS: readonly string[] = ['apps', 'packages']

/** Build products a guard can name: identifiers, artifact words, or file names. */
const ARTIFACT_TOKENS = /built|artifact|bundle|preload|packed|dshBin|lib\/bin/i

/** Guard forms that select on the host platform or a recorded run instead of a build product. */
const NON_ARTIFACT_GUARDS = /process\.(platform|env)|MODE\s*[!=]==?\s*'record'/i

/** Test file extensions admitted into the lane. */
const TEST_FILE = /\.(spec|e2e)\.(ts|tsx)$/

/** One `skipIf(` guard text. */
function skipGuards(source: string): string[] {
  const guards: string[] = []
  for (let index = source.indexOf('skipIf('); index !== -1; index = source.indexOf('skipIf(', index + 1)) {
    let depth = 0
    let cursor = index + 'skipIf'.length
    const start = cursor + 1
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor]
      if (character === '(') depth += 1
      else if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    guards.push(source.slice(start, cursor))
  }
  return guards
}

/** Identifiers that choose `describe.skip` over `describe` in a conditional suite. */
const CONDITIONAL_SKIP_GUARD = /([A-Za-z_$][\w$]*)\s*\?\s*describe\s*:\s*describe\.skip/g

/**
 * Decide whether one test file belongs to the built-artifact lane.
 * @internal
 * A `skipIf` guard admits the file when it names a build product; the file name
 * admits it when the file also carries a guard that is not a platform, env, or
 * record-mode selection. A suite chosen by `(<ident> ? describe : describe.skip)`
 * admits the file when that identifier names a build product.
 * @param file - repo-relative test file path.
 * @param source - the file's text.
 * @returns true when a build product gates the whole file or one of its cases.
 */
export function isBuiltArtifactSuite(file: string, source: string): boolean {
  const guards = skipGuards(source)
  if (guards.some(guard => ARTIFACT_TOKENS.test(guard))) return true
  for (const match of source.matchAll(CONDITIONAL_SKIP_GUARD)) {
    if (ARTIFACT_TOKENS.test(match[1] ?? '')) return true
  }
  if (guards.length === 0) return false
  return ARTIFACT_TOKENS.test(file) && guards.some(guard => !NON_ARTIFACT_GUARDS.test(guard))
}

/**
 * List the built-artifact suites.
 * @param root - repo root to walk.
 * @returns repo-relative suite paths, sorted.
 */
export function discoverBuiltArtifactSuites(root: string): string[] {
  const found: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git') continue
        visit(path)
        continue
      }
      if (!TEST_FILE.test(entry.name)) continue
      const file = relative(root, path)
      if (isBuiltArtifactSuite(file, readFileSync(path, 'utf8'))) found.push(file)
    }
  }
  for (const testRoot of TEST_ROOTS) visit(join(root, testRoot))
  return found.sort()
}

/** One file entry of a vitest JSON report. */
export interface VitestReportFile {
  name: string
  assertionResults: { status: string }[]
}

/** Executed pass count for one discovered suite, with the warning it earns. */
export interface BuiltSuiteRun {
  /** Repo-relative suite path. */
  suite: string
  /** Passing cases the lane executed; undefined when the lane never ran the suite. */
  passed: number | undefined
  /** Reason the lane printed a workflow warning, when it printed one. */
  warning?: string
}

/**
 * Summarize one vitest JSON report against the discovered suites.
 * @param suites - repo-relative built-artifact suites.
 * @param reportFiles - files of a vitest JSON report.
 * @returns one entry per suite, in the given order.
 */
export function summarizeBuiltArtifactSuiteRuns(
  suites: readonly string[],
  reportFiles: readonly VitestReportFile[],
): BuiltSuiteRun[] {
  const at = (name: string): string => {
    const resolved = resolve(ROOT, name)
    return relative(ROOT, resolved)
  }
  const executed = new Map<string, number>()
  for (const file of reportFiles) {
    const passed = file.assertionResults.filter(result => result.status === 'passed').length
    executed.set(at(file.name), (executed.get(at(file.name)) ?? 0) + passed)
  }
  return suites.map((suite) => {
    const passed = executed.get(suite)
    if (passed === undefined) return { suite, passed, warning: `${suite} is a built-artifact suite but the lane never ran it` }
    if (passed === 0) return { suite, passed, warning: `${suite} reported no passing case in this lane; its build product is still missing` }
    return { suite, passed }
  })
}

/**
 * Print each discovered suite's executed pass count and warn about the ones that ran nothing.
 * @param reportPath - path to a vitest JSON report.
 * @returns process exit code (always 0: the lane warns instead of failing on a platform skip).
 */
function report(reportPath: string): number {
  const reportFiles = (JSON.parse(readFileSync(reportPath, 'utf8')) as { testResults: VitestReportFile[] }).testResults
  for (const run of summarizeBuiltArtifactSuiteRuns(discoverBuiltArtifactSuites(ROOT), reportFiles)) {
    if (run.warning !== undefined) {
      process.stdout.write(`::warning::${run.warning}\n`)
      continue
    }
    process.stdout.write(`${run.suite}: ${String(run.passed)} passed\n`)
  }
  return 0
}

/* v8 ignore start -- CLI entry: discovery and reporting are covered by scripts/built-artifact-suites.spec.ts. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportAt = process.argv.indexOf('--report')
  if (reportAt !== -1) process.exitCode = report(process.argv[reportAt + 1] ?? '')
  else for (const suite of discoverBuiltArtifactSuites(ROOT)) process.stdout.write(`${suite}\n`)
}
/* v8 ignore stop */
