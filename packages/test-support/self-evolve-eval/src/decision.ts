/**
 * Continue/rollback decision for the P1-10 evaluation and the CI stop switch
 * (spec rollback condition: a confidence interval crossing zero means
 * randomness cannot be excluded, so the self-evolve default must be disabled).
 *
 * The decision is a small durable JSON record. `verify-self-evolve-eval` (the
 * repo gate) fails when the recorded recommendation is `rollback`, so the
 * "auto-stop switch" is mechanical: once an evaluation reports no net evidence,
 * CI turns red until the maintainers act on the record.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/decision
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EvalDecision, EvalResults } from './types.ts'
import { bootstrapCi, summarize } from './score.ts'

/**
 * Decide from a campaign's paired results (spec P1-10): `continue` only when
 * the bootstrap 95% interval of the win-rate delta lies strictly above zero;
 * `rollback` when it crosses zero (randomness cannot be excluded) or lies at
 * or below zero (harm evidence). The summary, interval, and recommendation
 * are all recorded so the decision is auditable.
 *
 * @param results - the collected campaign results.
 * @param options - bootstrap seed/resamples/confidence (seed recorded in the decision via `summary`).
 * @returns the recorded decision.
 */
export function decide(
  results: EvalResults,
  options: { seed?: number; resamples?: number; confidence?: number } = {},
): EvalDecision {
  const summary = summarize(results)
  const ci = bootstrapCi(results, options)
  const crossesZero = ci.low <= 0 && ci.high >= 0
  const recommended: EvalDecision['recommended'] = ci.low > 0 ? 'continue' : 'rollback'
  return { settledAt: Date.now(), summary, ci, crossesZero, recommended }
}

/**
 * Write a decision record to disk, creating the parent directory. The record
 * is the gate's payload, so a failed write must fail loud.
 *
 * @param path - decision file path.
 * @param decision - the decision to persist.
 */
export async function recordDecision(path: string, decision: EvalDecision): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(decision, null, 2)}\n`)
}

/**
 * Read a decision record; null when the file is absent (no campaign settled
 * yet).
 *
 * @param path - decision file path.
 * @returns the parsed decision, or null.
 */
export async function readDecision(path: string): Promise<EvalDecision | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (typeof parsed.recommended !== 'string' || typeof parsed.ci !== 'object' || parsed.ci === null) {
    throw new Error(`self-evolve-eval: malformed decision record at ${path}`)
  }
  return parsed as unknown as EvalDecision
}
