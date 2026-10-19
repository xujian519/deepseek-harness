/**
 * `scoreboard.yaml` persistence and aggregation rules for one benchmark.
 *
 * The scoreboard is an append-only YAML list of {@link ScoreboardEntry} rows,
 * one per evaluation or candidate round, keyed by agent-state snapshot version.
 * Aggregation mirrors penguin-harness bookkeeping: scores are case-run means
 * rounded to two decimals, costs to six decimals (means ignore absent values),
 * and durations to integer milliseconds.
 *
 * @module @deepseek-ai/dsh-self-evolve-benchmark/scoreboard
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { BenchmarkId } from './brand.ts'
import type { CaseAggregate, CaseRunRecord, ScoreboardEntry } from './types.ts'

/** File name of the per-benchmark scoreboard. */
export const SCOREBOARD_FILENAME = 'scoreboard.yaml'

/** Relative directory under the data root that holds benchmarks. */
export const BENCHMARK_ROOT = 'benchmarks'

/**
 * Absolute path of a benchmark's scoreboard.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns Absolute path of the scoreboard file.
 */
export function scoreboardPath(baseDir: string, benchmarkId: BenchmarkId): string {
  return join(baseDir, BENCHMARK_ROOT, benchmarkId, SCOREBOARD_FILENAME)
}

/**
 * Round a score to two decimals.
 *
 * @param value Raw score.
 * @returns Score rounded to two decimals.
 */
export function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Round a cost to six decimals.
 *
 * @param value Raw cost.
 * @returns Cost rounded to six decimals.
 */
export function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Arithmetic mean; `NaN` for an empty list.
 *
 * @param values Numbers to average.
 * @returns Mean of `values`, or `NaN` when empty.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Aggregate one case's runs: means with the rounding rules above; cost/duration
 * absent when no run reported one.
 *
 * @param runs The case's run records.
 * @returns Aggregated means, omitting cost and duration when no run reported them.
 */
export function aggregateRuns(runs: CaseRunRecord[]): Omit<CaseAggregate, 'caseId' | 'runs'> {
  const costs = runs.flatMap(run => (run.cost === undefined ? [] : [run.cost]))
  const durations = runs.flatMap(run => (run.durationMs === undefined ? [] : [run.durationMs]))
  const aggregate: Omit<CaseAggregate, 'caseId' | 'runs'> = { score: roundScore(mean(runs.map(run => run.score))) }
  if (costs.length > 0) aggregate.cost = roundCost(mean(costs))
  if (durations.length > 0) aggregate.durationMs = Math.round(mean(durations))
  return aggregate
}

/**
 * Read the scoreboard for a benchmark. A missing scoreboard reads as an empty
 * list; a malformed or non-list document is a loud error, never a silent reset.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @returns Persisted entries, oldest first.
 */
export async function readScoreboard(baseDir: string, benchmarkId: BenchmarkId): Promise<ScoreboardEntry[]> {
  const path = scoreboardPath(baseDir, benchmarkId)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const parsed = (parseYaml(raw) ?? []) as unknown
  if (!Array.isArray(parsed)) throw new Error(`scoreboard: expected a YAML list, got ${typeof parsed}`)
  return parsed as ScoreboardEntry[]
}

/**
 * Append one entry to the scoreboard, preserving history.
 *
 * The read-modify-write cycle runs under the scoreboard's writer lock and
 * commits through an atomic rename, so two concurrent rounds both persist:
 * a plain read-then-write loses whichever entry was written first, and a
 * reader of a half-written document sees a parse error.
 *
 * @param baseDir Data root for benchmark stores.
 * @param benchmarkId Benchmark id.
 * @param entry Entry to append.
 */
export async function appendScoreboard(baseDir: string, benchmarkId: BenchmarkId, entry: ScoreboardEntry): Promise<void> {
  const path = scoreboardPath(baseDir, benchmarkId)
  await mkdir(dirname(path), { recursive: true })
  await withFileLock(path, async () => {
    const entries = await readScoreboard(baseDir, benchmarkId)
    entries.push(entry)
    await writeFileAtomic(path, stringifyYaml(entries), { mode: 0o600 })
  }, { waitMs: 30_000 })
}
