/**
 * Paired-result statistics for the P1-10 offline evaluation: summary metrics
 * and the percentile bootstrap confidence interval for the win-rate delta.
 *
 * The campaign is a paired A/B over the same task subset: each task resolves
 * (or fails) under both the baseline harness and the self-evolve-enabled
 * harness. The primary statistic is the paired difference in resolution rate
 * (`winRateDelta`); its 95% confidence interval comes from resampling task
 * differences (bootstrap percentile), seeded so results reproduce.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/score
 */

import type { ConfidenceInterval, EvalResults, EvalSummary, TaskOutcome } from './types.ts'
import { mulberry32 } from './subset.ts'

/** Default bootstrap resamples. */
export const DEFAULT_RESAMPLES = 10_000
/** Default confidence level. */
export const DEFAULT_CONFIDENCE = 0.95

/**
 * Compute the paired summary of one evaluation campaign. Tasks carrying a
 * per-side error (no verdict) count as not passed for that side, keeping the
 * pairing intact; the same verdict quality applies to both sides.
 *
 * @param results - the collected campaign results.
 * @returns the summary statistics.
 */
export function summarize(results: EvalResults): EvalSummary {
  const n = results.tasks.length
  let baselinePassed = 0
  let evolvedPassed = 0
  let wins = 0
  let losses = 0
  for (const task of results.tasks) {
    if (task.baselinePassed) baselinePassed += 1
    if (task.evolvedPassed) evolvedPassed += 1
    if (task.evolvedPassed && !task.baselinePassed) wins += 1
    if (!task.evolvedPassed && task.baselinePassed) losses += 1
  }
  return {
    n,
    wins,
    losses,
    netWin: wins - losses,
    baselineRate: n === 0 ? 0 : baselinePassed / n,
    evolvedRate: n === 0 ? 0 : evolvedPassed / n,
    winRateDelta: n === 0 ? 0 : (evolvedPassed - baselinePassed) / n,
  }
}

/**
 * Percentile bootstrap confidence interval for `winRateDelta` over resampled
 * task differences (paired, with replacement). The 2.5%/97.5% percentiles of
 * the resampled deltas bound the interval; the seed makes any campaign report
 * reproducible.
 *
 * @param results - the collected campaign results.
 * @param options - resample count, confidence level, and PRNG seed.
 * @returns the confidence interval.
 */
export function bootstrapCi(
  results: EvalResults,
  options: { seed?: number; resamples?: number; confidence?: number } = {},
): ConfidenceInterval {
  const resamples = options.resamples ?? DEFAULT_RESAMPLES
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE
  const tasks = results.tasks
  const n = tasks.length
  if (n === 0) return { low: 0, high: 0, resamples, confidence }
  const random = mulberry32(options.seed ?? 0)
  const deltas: number[] = []
  for (let sample = 0; sample < resamples; sample += 1) {
    let passedDiff = 0
    for (let index = 0; index < n; index += 1) {
      // A resampled index is always within bounds (n > 0); the guard only
      // satisfies the indexed-access type without a non-null assertion.
      const task = tasks[Math.floor(random() * n)]
      if (task === undefined) continue
      if (task.evolvedPassed && !task.baselinePassed) passedDiff += 1
      if (!task.evolvedPassed && task.baselinePassed) passedDiff -= 1
    }
    deltas.push(passedDiff / n)
  }
  deltas.sort((a, b) => a - b)
  const tail = (1 - confidence) / 2
  const low = percentile(deltas, tail)
  const high = percentile(deltas, 1 - tail)
  return { low, high, resamples, confidence }
}

/** Linear-interpolated percentile of an ascending sorted list. */
function percentile(sorted: number[], q: number): number {
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) return 0
  if (sorted.length === 1) return first
  const position = q * (sorted.length - 1)
  const base = Math.floor(position)
  const rest = position - base
  const value = sorted[base]
  const next = sorted[base + 1]
  if (value === undefined) return first
  return value + ((next ?? last) - value) * rest
}

/**
 * Wilson score interval for a binomial proportion (reference statistic; the
 * decision uses the bootstrap interval).
 *
 * @param passes - successful observations.
 * @param n - total observations; must be positive.
 * @param confidence - confidence level (default 0.95).
 * @returns the interval bounds.
 */
export function wilsonCi(passes: number, n: number, confidence = DEFAULT_CONFIDENCE): { low: number; high: number } {
  if (n <= 0) throw new Error(`self-evolve-eval: wilsonCi requires a positive n, got ${n}`)
  const z = zForConfidence(confidence)
  const p = passes / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const halfWidth = z * Math.sqrt((p * (1 - p) / n + z2 / (4 * n * n))) / denominator
  return { low: Math.max(0, center - halfWidth), high: Math.min(1, center + halfWidth) }
}

/** Two-sided z for a confidence level (standard normal quantile, few steps of Newton from a table seed). */
function zForConfidence(confidence: number): number {
  const tail = (1 - confidence) / 2
  // Seed from the canonical 90/95/99 z values, refine with Halley's method.
  let z = Math.abs(confidence - 0.95) < 1e-9 ? 1.959964 : 2.0
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const f = normalCdf(-z) - tail
    const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
    if (pdf === 0) break
    z = z - f / pdf
  }
  return z
}

/** Standard normal CDF (Abramowitz–Stegun approximation, |error| < 7.5e-8). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp(-z * z / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z >= 0 ? 1 - p : p
}

/**
 * Validate a parsed results JSON object (CLI input shape) and normalize it
 * to {@link EvalResults}. Throws with a precise message on shape violations —
 * a malformed campaign report must never silently score as zeros.
 *
 * @param raw - the parsed JSON value.
 * @returns the validated results.
 */
export function validateResults(raw: unknown): EvalResults {
  if (typeof raw !== 'object' || raw === null) throw new Error('self-evolve-eval: results must be a JSON object')
  const record = raw as Record<string, unknown>
  const tasks = record.tasks
  if (!Array.isArray(tasks)) throw new Error('self-evolve-eval: results.tasks must be an array')
  const validated: TaskOutcome[] = tasks.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`self-evolve-eval: results.tasks[${index}] must be an object`)
    const task = item as Record<string, unknown>
    if (typeof task.taskId !== 'string' || task.taskId.length === 0) throw new Error(`self-evolve-eval: results.tasks[${index}].taskId must be a non-empty string`)
    if (typeof task.baselinePassed !== 'boolean' || typeof task.evolvedPassed !== 'boolean') {
      throw new Error(`self-evolve-eval: results.tasks[${index}] must carry boolean baselinePassed and evolvedPassed`)
    }
    const outcome: TaskOutcome = {
      taskId: task.taskId,
      baselinePassed: task.baselinePassed,
      evolvedPassed: task.evolvedPassed,
    }
    if (typeof task.baselineError === 'string') outcome.baselineError = task.baselineError
    if (typeof task.evolvedError === 'string') outcome.evolvedError = task.evolvedError
    return outcome
  })
  const seed = typeof record.seed === 'number' ? record.seed : 0
  const subsetSize = typeof record.subsetSize === 'number' ? record.subsetSize : validated.length
  const generatedAt = typeof record.generatedAt === 'number' ? record.generatedAt : Date.now()
  return { seed, subsetSize, generatedAt, tasks: validated }
}
