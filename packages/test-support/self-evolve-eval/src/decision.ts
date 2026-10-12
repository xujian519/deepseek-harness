/**
 * Continue/rollback decision for the P1-10 evaluation and the CI stop switch.
 *
 * The rule is a two-sided exact McNemar test over the discordant pairs plus a
 * pre-registered minimum effect: `continue` requires both a p-value below the
 * significance level and an observed win-rate delta at or above `minEffect`.
 * A 60-task subset carries too little power for a percentile bootstrap over
 * paired binary outcomes to serve as the gate, and "the interval excludes
 * zero" would admit effects far too small to matter.
 *
 * Reusing one fixed subset for repeated adaptive decisions inflates the
 * false-promotion rate, so every declared reuse tightens the level by
 * `alpha / (reuses + 1)`. The decision is a small durable JSON record;
 * `verify-self-evolve-eval` (the repo gate) fails when `recommended` is
 * `rollback`, so the stop switch stays mechanical.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/decision
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EvalDecision, EvalResults } from './types.ts'
import { bootstrapCi, mcnemarExact, summarize } from './score.ts'

/**
 * Version of the rule {@link decide} implements. Bump it when the rule
 * changes: a record produced under another version is not comparable, and
 * {@link readDecision} refuses it rather than letting the gate act on a
 * stale verdict.
 */
export const DECISION_CRITERION_VERSION = 2
/** Default two-sided significance level, before reuse adjustment. */
export const DEFAULT_ALPHA = 0.05
/** Default pre-registered minimum absolute win-rate delta. */
export const DEFAULT_MIN_EFFECT = 0.05

/** Inputs for {@link decide}. */
export interface DecideOptions {
  /** Bootstrap seed (recorded via `summary`; the rule itself does not resample). */
  seed?: number
  /** Bootstrap resamples for the descriptive interval. */
  resamples?: number
  /** Confidence level for the descriptive interval. */
  confidence?: number
  /** Two-sided significance level before reuse adjustment (default 0.05). */
  alpha?: number
  /** Minimum absolute win-rate delta required to continue (default 0.05). */
  minEffect?: number
  /** Prior decisions recorded against the same subset digest (default 0). */
  priorReuses?: number
  /** Digest of the evaluated subset; falls back to `results.subsetDigest`. */
  subsetDigest?: string
}

/**
 * Decide from a campaign's paired results: `continue` only when the exact
 * McNemar test rejects the null hypothesis at the (reuse-adjusted) level AND
 * the observed win-rate delta reaches the pre-registered minimum effect;
 * `rollback` otherwise. The summary, descriptive interval, test result, and
 * applied thresholds are all recorded so the decision is auditable.
 *
 * @param results - the collected campaign results.
 * @param options - significance level, minimum effect, reuse count, and
 *   descriptive-interval settings.
 * @returns the recorded decision.
 */
export function decide(results: EvalResults, options: DecideOptions = {}): EvalDecision {
  const summary = summarize(results)
  const ci = bootstrapCi(results, options)
  const mcnemar = mcnemarExact(summary.wins, summary.losses)
  const minEffect = options.minEffect ?? DEFAULT_MIN_EFFECT
  const priorReuses = options.priorReuses ?? 0
  const alpha = (options.alpha ?? DEFAULT_ALPHA) / (priorReuses + 1)
  const significant = mcnemar.pValue < alpha
  const material = summary.winRateDelta >= minEffect
  const crossesZero = ci.low <= 0 && ci.high >= 0
  const decision: EvalDecision = {
    criterionVersion: DECISION_CRITERION_VERSION,
    settledAt: Date.now(),
    summary,
    ci,
    mcnemar,
    alpha,
    minEffect,
    priorReuses,
    crossesZero,
    recommended: significant && material ? 'continue' : 'rollback',
  }
  const subsetDigest = options.subsetDigest ?? results.subsetDigest
  if (subsetDigest !== undefined) decision.subsetDigest = subsetDigest
  return decision
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
 * yet). A record from another criterion version is refused instead of being
 * acted on: the gate would otherwise enforce a rule that no longer applies.
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
  if (parsed.criterionVersion !== DECISION_CRITERION_VERSION) {
    throw new Error(
      `self-evolve-eval: decision record at ${path} uses criterion version `
      + `${String(parsed.criterionVersion)}; this build implements ${DECISION_CRITERION_VERSION}. Re-run the evaluation to record a comparable decision.`,
    )
  }
  return parsed as unknown as EvalDecision
}
