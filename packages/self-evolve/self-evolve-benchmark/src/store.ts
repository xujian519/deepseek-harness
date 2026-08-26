/**
 * Benchmark on-disk layout under the data root:
 *
 * ```
 * <baseDir>/benchmarks/<id>/
 * ├── benchmark_config.yaml   # { title }
 * └── <caseId>/
 *     ├── statement           # public task text — the only input a target agent sees
 *     └── rubric              # private scoring standard — physically a different file
 * ```
 *
 * The statement and rubric of a case are separate files, so a consumer that
 * reads only the public surface can never pick up the scoring standard by
 * accident.
 *
 * @module @deepseek-ai/dsh-self-evolve-benchmark/store
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { BoundBenchmark, CaseSpec } from './types.ts'

/** File name of the public case task text. */
export const STATEMENT_FILENAME = 'statement'

/** File name of the private case scoring standard. */
export const RUBRIC_FILENAME = 'rubric'

/** File name of the per-benchmark title document. */
export const CONFIG_FILENAME = 'benchmark_config.yaml'

/**
 * Absolute path of the benchmarks root under a data root.
 *
 * @param baseDir Data root for benchmark stores.
 * @returns Absolute path of the benchmarks root.
 */
export function benchmarkRoot(baseDir: string): string {
  return join(baseDir, 'benchmarks')
}

/**
 * Absolute path of one benchmark's directory.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns Absolute path of the benchmark directory.
 */
export function benchmarkDir(baseDir: string, benchmarkId: string): string {
  return join(benchmarkRoot(baseDir), benchmarkId)
}

/**
 * Absolute path of one case's directory.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @param caseId Case id.
 * @returns Absolute path of the case directory.
 */
export function caseDir(baseDir: string, benchmarkId: string, caseId: string): string {
  return join(benchmarkDir(baseDir, benchmarkId), caseId)
}

/**
 * Absolute path of a case's public statement file.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @param caseId Case id.
 * @returns Absolute path of the statement file.
 */
export function statementPath(baseDir: string, benchmarkId: string, caseId: string): string {
  return join(caseDir(baseDir, benchmarkId, caseId), STATEMENT_FILENAME)
}

/**
 * Absolute path of a case's private rubric file.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @param caseId Case id.
 * @returns Absolute path of the rubric file.
 */
export function rubricPath(baseDir: string, benchmarkId: string, caseId: string): string {
  return join(caseDir(baseDir, benchmarkId, caseId), RUBRIC_FILENAME)
}

/**
 * Absolute path of a benchmark's title document.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns Absolute path of the title document.
 */
export function benchmarkConfigPath(baseDir: string, benchmarkId: string): string {
  return join(benchmarkDir(baseDir, benchmarkId), CONFIG_FILENAME)
}

/**
 * Create the benchmark directory and its title document. Idempotent; an
 * existing benchmark keeps its title (callers re-writing the same title see
 * no change).
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @param title Benchmark title.
 */
export async function ensureBenchmark(baseDir: string, benchmarkId: string, title: string): Promise<void> {
  await mkdir(benchmarkDir(baseDir, benchmarkId), { recursive: true })
  await writeFile(benchmarkConfigPath(baseDir, benchmarkId), stringifyYaml({ title }), 'utf8')
}

/**
 * Read the benchmark title; a missing document defaults to the benchmark id.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns The title, or the benchmark id when no title is recorded.
 */
export async function readBenchmarkTitle(baseDir: string, benchmarkId: string): Promise<string> {
  let raw: string
  try {
    raw = await readFile(benchmarkConfigPath(baseDir, benchmarkId), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return benchmarkId
    throw error
  }
  const parsed = parseYaml(raw) as { title?: unknown } | null
  return typeof parsed?.title === 'string' ? parsed.title : benchmarkId
}

/**
 * Write one case's statement and optional rubric, creating the case directory.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @param caseId Case id.
 * @param spec Statement text and optional rubric text.
 */
export async function writeCase(
  baseDir: string,
  benchmarkId: string,
  caseId: string,
  spec: { statement: string; rubric?: string },
): Promise<void> {
  await mkdir(caseDir(baseDir, benchmarkId, caseId), { recursive: true })
  await writeFile(statementPath(baseDir, benchmarkId, caseId), spec.statement, 'utf8')
  if (spec.rubric !== undefined) {
    await writeFile(rubricPath(baseDir, benchmarkId, caseId), spec.rubric, 'utf8')
  }
}

/**
 * List case ids for a benchmark in lexical order; a missing benchmark lists none.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns Case ids in lexical order.
 */
export async function listCaseIds(baseDir: string, benchmarkId: string): Promise<string[]> {
  const dir = benchmarkDir(baseDir, benchmarkId)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

/**
 * Load a benchmark's title and case set. A missing benchmark directory is a
 * loud error (call `ensureBenchmark` first); a case missing its statement file
 * is also loud, because a case without a task cannot be scored.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns The benchmark title and its bound case set.
 */
export async function loadBenchmark(baseDir: string, benchmarkId: string): Promise<BoundBenchmark> {
  const title = await readBenchmarkTitle(baseDir, benchmarkId)
  const caseIds = await listCaseIds(baseDir, benchmarkId)
  const cases: CaseSpec[] = []
  for (const caseId of caseIds) {
    const statement = await readFile(statementPath(baseDir, benchmarkId, caseId), 'utf8')
    const spec: CaseSpec = { caseId, statement }
    try {
      spec.rubric = await readFile(rubricPath(baseDir, benchmarkId, caseId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    cases.push(spec)
  }
  if (caseIds.length === 0) {
    // A benchmark with no cases cannot produce a score; fail before evaluation
    // starts rather than emitting a NaN entry.
    throw new Error(`benchmark "${benchmarkId}" has no cases under ${benchmarkDir(baseDir, benchmarkId)}`)
  }
  return { id: benchmarkId, title, cases }
}
