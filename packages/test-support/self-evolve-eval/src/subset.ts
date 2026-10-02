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
      failToPass: decodeTestIds('FAIL_TO_PASS', row.FAIL_TO_PASS ?? row.failToPass),
      passToPass: decodeTestIds('PASS_TO_PASS', row.PASS_TO_PASS ?? row.passToPass),
    })
  }
  return tasks
}

/**
 * Decode a SWE-bench test-id field into its ids. The dataset ships
 * `FAIL_TO_PASS` and `PASS_TO_PASS` as JSON-encoded strings — `datasets`
 * types both as `Value('string')` — while a subset file carries real arrays.
 * Both decode to the same ids.
 *
 * A value that is neither form fails loud. Returning `[]` instead would let
 * the campaign run `pytest` with no test ids and record the arm as a settled
 * failed verdict, turning a manifest-shape mistake into a scored result. An
 * absent field carries no ids and reads as empty;
 * {@link selectSubset} refuses a subset whose tasks all end up that way.
 *
 * @param field - dataset field name, for the failure message.
 * @param value - the raw field value.
 * @returns the string ids the field carries.
 */
export function decodeTestIds(field: string, value: unknown): string[] {
  if (value === undefined || value === null) return []
  let decoded: unknown = value
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value) as unknown
    } catch (cause) {
      throw new Error(`self-evolve-eval: ${field} is not valid JSON: ${String(cause)}`, { cause })
    }
  }
  if (!Array.isArray(decoded)) {
    throw new Error(`self-evolve-eval: ${field} must be a JSON array string or an array, got ${typeof value}`)
  }
  return decoded.filter((item): item is string => typeof item === 'string')
}

/** First string-valued field among `keys`, in order; undefined when none is. */
function rowField(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

/**
 * Deterministically select a subset of `count` tasks. Tasks are sorted by
 * instance id first (input order never influences the result), then shuffled
 * with the seeded PRNG; the first `count` tasks of the shuffle are the
 * subset. Tests and reproducibility depend on the stable sort.
 *
 * Every selected task must carry at least one `failToPass` id: the verdict
 * runs exactly those ids, so an empty list leaves the campaign with no test to
 * execute and scores both arms as failed.
 *
 * @param tasks - the normalized task list.
 * @param seed - sampling seed; the campaign records it with the results.
 * @param count - subset size (default 60). Clamped to the task list length.
 * @returns the selected subset, in shuffled order.
 * @throws when a selected task has no `failToPass` id.
 */
export function selectSubset(tasks: EvalTask[], seed: number, count = DEFAULT_SUBSET_SIZE): EvalTask[] {
  const sorted = [...tasks].sort((a, b) => a.instanceId.localeCompare(b.instanceId))
  if (sorted.length <= count) return assertScorable(sorted)
  const random = mulberry32(seed)
  // Fisher-Yates shuffle of the sorted list.
  for (let index = sorted.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1))
    const current = sorted[index]
    const swapTarget = sorted[swapWith]
    /* v8 ignore next -- noUncheckedIndexedAccess: swapWith is within [0, index+1) and index < length, so both are defined. */
    if (current === undefined || swapTarget === undefined) continue
    sorted[index] = swapTarget
    sorted[swapWith] = current
  }
  return assertScorable(sorted.slice(0, count))
}

/**
 * Reject a subset carrying a task with no `failToPass` id. The verdict runs
 * exactly those ids, so such a task leaves the campaign with no test to run.
 *
 * @param selected - the chosen subset.
 * @returns `selected` unchanged when every task is scorable.
 * @throws when a selected task has no `failToPass` id.
 */
function assertScorable(selected: EvalTask[]): EvalTask[] {
  const untestable = selected.find(task => task.failToPass.length === 0)
  if (untestable !== undefined) {
    throw new Error(`self-evolve-eval: ${untestable.instanceId} has no FAIL_TO_PASS ids; the subset cannot be scored`)
  }
  return selected
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
    /* v8 ignore next -- a '['-prefixed value always parses to an array, so the empty fallback is unreachable. */
    return Array.isArray(parsed) ? normalizeSwebenchInstances(parsed) : []
  }
  const rows: unknown[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    rows.push(JSON.parse(line))
  }
  return normalizeSwebenchInstances(rows)
}
