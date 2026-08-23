/**
 * Deterministic subset selection for the P1-10 offline evaluation (PR11/P1-14).
 *
 * A campaign needs a reproducible evaluation set: `selectSubset` shuffles a
 * normalized task manifesto with a seeded PRNG, so the same manifest + seed
 * always yields the same subset and results are comparable across runs.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/subset
 */

import { readFile } from 'node:fs/promises'
import type { EvalTask } from './types.ts'

/** Number of tasks the P1-10 campaign targets. */
export const DEFAULT_SUBSET_SIZE = 60

/**
 * Seedable sampling PRNG (mulberry32). Exported so selectors and bootstrap
 * resampling share one deterministic source.
 * @param seed - 32-bit unsigned seed.
 * @returns a function producing uniform floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

/**
 * Normalize raw SWE-bench dataset rows (the exported JSONL fields
 * `instance_id`, `repo`, `base_commit`, `FAIL_TO_PASS`, `PASS_TO_PASS`) into
 * {@link EvalTask}s. Also accepts the camelCase {@link EvalTask} shape a
 * `subset` run writes, so a campaign can plan from its own subset file.
 * Rows missing an instance id are dropped; a missing repo or base commit
 * fails loud because a campaign cannot reproduce the task without them.
 * The snake_case field wins when both shapes are present (raw manifest).
 *
 * @param rows - parsed manifest rows or subset tasks.
 * @returns the normalized tasks, preserving input order.
 */
export function normalizeSwebenchInstances(rows: unknown[]): EvalTask[] {
  const tasks: EvalTask[] = []
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const instanceId = rowField(row, ['instance_id', 'instanceId'])
    if (instanceId === undefined || instanceId.length === 0) continue
    const repo = rowField(row, ['repo'])
    const baseCommit = rowField(row, ['base_commit', 'baseCommit'])
    if (repo === undefined || baseCommit === undefined) {
      throw new Error(`self-evolve-eval: instance ${instanceId} is missing repo or base_commit`)
    }
    tasks.push({
      instanceId,
      repo,
      baseCommit,
      failToPass: asStringArray(row.FAIL_TO_PASS ?? row.failToPass),
      passToPass: asStringArray(row.PASS_TO_PASS ?? row.passToPass),
    })
  }
  return tasks
}

/** First string-valued field among `keys`, in order; undefined when none is. */
function rowField(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * Deterministically select a subset of `count` tasks. Tasks are sorted by
 * instance id first (input order never influences the result), then shuffled
 * with the seeded PRNG; the first `count` tasks of the shuffle are the
 * subset. Tests and reproducibility depend on the stable sort.
 *
 * @param tasks - the normalized task list.
 * @param seed - sampling seed; the campaign records it with the results.
 * @param count - subset size (default 60). Clamped to the task list length.
 * @returns the selected subset, in shuffled order.
 */
export function selectSubset(tasks: EvalTask[], seed: number, count = DEFAULT_SUBSET_SIZE): EvalTask[] {
  const sorted = [...tasks].sort((a, b) => a.instanceId.localeCompare(b.instanceId))
  if (sorted.length <= count) return sorted
  const random = mulberry32(seed)
  // Fisher-Yates shuffle of the sorted list.
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1))
    const current = sorted[index]
    const swapTarget = sorted[swapWith]
    if (current === undefined || swapTarget === undefined) continue
    sorted[index] = swapTarget
    sorted[swapWith] = current
  }
  return sorted.slice(0, count)
}

/**
 * Load a JSON or JSONL task manifest (the normalized {@link EvalTask} shape,
 * or raw SWE-bench rows accepted by {@link normalizeSwebenchInstances}).
 *
 * @param path - manifest file path.
 * @returns the normalized tasks.
 */
export async function loadTaskManifest(path: string): Promise<EvalTask[]> {
  const text = await readFile(path, 'utf8')
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed) ? normalizeSwebenchInstances(parsed) : []
  }
  const rows: unknown[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    rows.push(JSON.parse(line))
  }
  return normalizeSwebenchInstances(rows)
}
