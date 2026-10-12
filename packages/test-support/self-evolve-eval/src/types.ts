/**
 * Evaluation vocabulary for the P1-10 offline self-evolve assessment: task
 * manifests, paired outcomes, summary statistics, and the recorded
 * continue/rollback decision.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/types
 */

/** One SWE-bench-style task instance, normalized from the dataset manifest. */
export interface EvalTask {
  /** SWE-bench instance id, e.g. `django__django-12345`. */
  instanceId: string
  /** GitHub repository slug, e.g. `django/django`. */
  repo: string
  /** Base commit the task starts from. */
  baseCommit: string
  /** Test ids that must change from fail to pass (the solve target). */
  failToPass: string[]
  /** Test ids that must keep passing. */
  passToPass: string[]
}

/** Paired outcome of one task under the baseline and self-evolve runs. */
export interface TaskOutcome {
  /** The task's `instanceId`. */
  taskId: string
  /** Whether the baseline run resolved the task (FAIL_TO_PASS green). */
  baselinePassed: boolean
  /** Whether the self-evolve-enabled run resolved the task. */
  evolvedPassed: boolean
  /** Baseline failure detail when the run could not produce a verdict. */
  baselineError?: string
  /** Self-evolve failure detail when the run could not produce a verdict. */
  evolvedError?: string
}

/** Collected paired results of one evaluation campaign. */
export interface EvalResults {
  /** Subset seed the campaign used, for reproduction. */
  seed: number
  /** Subset size the campaign targeted. */
  subsetSize: number
  /** Wall-clock generation time (epoch ms). */
  generatedAt: number
  /**
   * Digest of the evaluated subset, when the campaign recorded one. Repeated
   * decisions against the same digest must declare their reuse count so the
   * significance level can be tightened.
   */
  subsetDigest?: string
  /** Per-task paired outcomes, one entry per task. */
  tasks: TaskOutcome[]
}

/** Summary statistics of a paired evaluation. */
export interface EvalSummary {
  /** Number of paired tasks. */
  n: number
  /** Tasks resolved by the self-evolve run but not by baseline (positive). */
  wins: number
  /** Tasks resolved by baseline but not by self-evolve (negative). */
  losses: number
  /** Wins minus losses. */
  netWin: number
  /** Baseline resolution rate (0–1). */
  baselineRate: number
  /** Self-evolve resolution rate (0–1). */
  evolvedRate: number
  /** Evolved rate minus baseline rate (0–1 range). */
  winRateDelta: number
}

/** Confidence interval for `winRateDelta` (percentile bootstrap). */
export interface ConfidenceInterval {
  low: number
  high: number
  /** Resamples used. */
  resamples: number
  /** Confidence level used. */
  confidence: number
}

/** Exact McNemar test outcome over a paired design's discordant pairs. */
export interface McnemarResult {
  /** Two-sided exact p-value under the null hypothesis of no effect. */
  pValue: number
  /** Discordant pairs (`wins + losses`); 0 means the test carries no information. */
  discordant: number
}

/**
 * Recorded continue/rollback decision (the CI stop-switch payload).
 * `verify-self-evolve-eval` reads only `recommended`; the remaining fields
 * exist so a decision can be audited and its criterion version identified.
 */
export interface EvalDecision {
  /**
   * Version of the decision rule. Bump when the rule changes: records produced
   * under different versions are not comparable.
   */
  criterionVersion: number
  /** Decision timestamp (epoch ms). */
  settledAt: number
  /** Summary the decision was computed from. */
  summary: EvalSummary
  /** Descriptive bootstrap interval for `winRateDelta`; reported, not gating. */
  ci: ConfidenceInterval
  /** Exact McNemar test over the discordant pairs. */
  mcnemar: McnemarResult
  /** Significance level actually applied, after any reuse adjustment. */
  alpha: number
  /** Pre-registered minimum absolute win-rate delta required to continue. */
  minEffect: number
  /** Prior decisions recorded against the same subset digest. */
  priorReuses: number
  /** Digest of the evaluated subset, when the campaign recorded one. */
  subsetDigest?: string
  /** True when the confidence interval spans zero (randomness cannot be excluded). */
  crossesZero: boolean
  /** `continue` only on significant, materially large positive evidence. */
  recommended: 'continue' | 'rollback'
}
