/**
 * SWE-bench dataset row handling for the P1-10 offline campaign: load the raw
 * exported manifest rows and index them by instance id. The subset scafold
 * keeps only six fields, so the campaign needs the raw rows for
 * `problem_statement`, `test_patch`, and `install`.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/campaign/manifest
 */

import { readFile } from 'node:fs/promises'
import { isRecord } from '@deepseek-ai/dsh-value'

/** The raw manifest row fields the campaign consumes. */
export interface SwebenchRow {
  instanceId: string
  repo: string
  baseCommit: string
  problemStatement: string
  /** The test_patch text (applied to the base checkout for both arms). */
  testPatch: string
  /** The environment install command (run once per task into the venv). */
  install?: string
  failToPass: string[]
  passToPass: string[]
}

/** Read a JSON or JSONL manifest into raw row objects (input order kept).
 *
 * @param path - manifest file path.
 * @returns the raw row objects in file order.
 */
export async function readManifestRows(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8')
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown
    /* v8 ignore next -- a '['-prefixed value always parses to an array, so the empty fallback is unreachable. */
    return Array.isArray(parsed) ? parsed.filter(isRecord) : []
  }
  const rows: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    const parsed = JSON.parse(line) as unknown
    if (isRecord(parsed)) rows.push(parsed)
  }
  return rows
}

/**
 * Index raw rows by `instance_id`. Rows without one are dropped; a duplicate
 * id keeps the last occurrence. Callers must fail loud when a subset task id
 * is absent from the map — a campaign cannot run a task without its raw row.
 *
 * @param rows - raw manifest rows.
 * @returns instance id → row map.
 */
export function indexSwebenchRows(rows: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const id = row.instance_id
    if (typeof id === 'string' && id.length > 0) index.set(id, row)
  }
  return index
}

/**
 * Normalize one raw row for the campaign; returns null when the row cannot be
 * executed (missing `instance_id`, `repo`, `base_commit`, `problem_statement`,
 * or `test_patch` — a campaign with no tests to run has no verdict).
 *
 * @param raw - the raw dataset row.
 * @returns the normalized row, or null.
 */
export function normalizeSwebenchRow(raw: Record<string, unknown>): SwebenchRow | null {
  const instanceId = str(raw.instance_id)
  const repo = str(raw.repo)
  const baseCommit = str(raw.base_commit)
  const problemStatement = str(raw.problem_statement)
  const testPatch = str(raw.test_patch)
  if (instanceId === null || repo === null || baseCommit === null || problemStatement === null || testPatch === null) {
    return null
  }
  const install = str(raw.install)
  return {
    instanceId,
    repo,
    baseCommit,
    problemStatement,
    testPatch,
    ...(install === null ? {} : { install }),
    failToPass: strArray(raw.FAIL_TO_PASS),
    passToPass: strArray(raw.PASS_TO_PASS),
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
