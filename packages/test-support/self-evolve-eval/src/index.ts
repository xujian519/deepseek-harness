/**
 * The P1-10 offline evaluation scaffold: deterministic subset selection,
 * paired baseline/self-evolve result scoring, the net-win bootstrap interval,
 * and the continue/rollback decision that arms the CI stop switch.
 *
 * This package is dev/test infrastructure, not a runtime plugin: it owns no
 * service, no model-visible surface, and no runtime effects. Real campaign
 * execution (per-task docker images + agent runs + FAIL_TO_PASS validation)
 * requires a keyed environment and is documented in the package README; the
 * scaffold covers everything around it — manifest, subset, scoring, decision,
 * and gate.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval
 */

export * from './subset.ts'
export * from './score.ts'
export * from './decision.ts'
export type {
  ConfidenceInterval,
  EvalDecision,
  EvalResults,
  EvalSummary,
  EvalTask,
  TaskOutcome,
} from './types.ts'
