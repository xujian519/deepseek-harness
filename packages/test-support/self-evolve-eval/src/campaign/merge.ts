/**
 * Results-row merging for the P1-10 offline campaign: fold one arm's outcome
 * into the paired `results.json` row set, resume-safe (a boolean field is
 * terminal for its arm; an error-only row stays retryable).
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/campaign/merge
 */

/** The two arms of a paired campaign run. */
export type CampaignArm = 'baseline' | 'evolved'

/**
 * One results row while a campaign is in flight. The run arm owns its
 * boolean; the other arm's field is absent until its own run settles. A row
 * with `error` and no boolean is an infra failure to retry; a row with both
 * marks a settled (possibly failed) verdict.
 */
export interface PartialTaskOutcome {
  taskId: string
  baselinePassed?: boolean
  evolvedPassed?: boolean
  baselineError?: string
  evolvedError?: string
}

/**
 * Fold one arm's verdict into a row set. Rows are addressed by `taskId`;
 * an unknown id appends the row with the other arm still open. `passed` is
 * authoritative when given (`error` then only annotates it); an error without
 * `passed` keeps the arm retryable.
 *
 * @param rows - the current row set (immutable input).
 * @param taskId - the task's instance id.
 * @param arm - the arm the verdict belongs to.
 * @param passed - the arm verdict; omitted for infra-only failures.
 * @param error - optional machine-readable failure detail.
 * @returns a new row set with the arm folded in.
 */
export function mergeArmOutcome(
  rows: readonly PartialTaskOutcome[],
  taskId: string,
  arm: CampaignArm,
  passed?: boolean,
  error?: string,
): PartialTaskOutcome[] {
  const existing = rows.find(row => row.taskId === taskId)
  const base: PartialTaskOutcome = existing ?? { taskId }
  const updated: PartialTaskOutcome = { ...base }
  if (passed !== undefined) {
    updated[arm === 'baseline' ? 'baselinePassed' : 'evolvedPassed'] = passed
  }
  if (error !== undefined) {
    updated[arm === 'baseline' ? 'baselineError' : 'evolvedError'] = error
  }
  if (existing === undefined) return [...rows, updated]
  return rows.map(row => (row === existing ? updated : row))
}
