/**
 * Self-evolve capability seam (`ctx.selfEvolve`): providers implement the
 * three-stage evolution loop; consumers start runs or observe lifecycle events.
 *
 * A single provider registers at a time (like `ctx.compaction`). The base
 * `self-evolve-basic` provider hooks into `turn/end` for idle-pressure
 * triggering and uses the projection-based weakness miner; higher-level
 * providers may extend it with L4 harness-level validation.
 *
 * @module @deepseek-ai/dsh-self-evolve
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  EvolveLevel,
  EvolveTrigger,
  FailurePattern,
  SelfEvolveAgentContext,
  SelfEvolveResult,
} from './types.ts'
import type { SelfEvolveRunId } from './brand.ts'

export type { SelfEvolveResult, FailurePattern, EvolveProposal, EvolveLevel, EvolveTrigger, SelfEvolveAgentContext } from './types.ts'
export { SelfEvolveRunId, FailurePatternId, EvolveProposalId } from './brand.ts'
export { failurePatternsProjectionDefinition, FAILURE_PATTERNS_PROJECTION_KEY, extractText, parseShellMarkers } from './failure-projection.ts'
export type { FailurePatternsState, ShellFailureMark } from './failure-projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registered self-evolve service — one provider per context. */
    selfEvolve: SelfEvolveEngine
  }

  interface Events {
    /**
     * An evolution loop started. Paired with `self-evolve-loop/end`.
     * @param info - run identity and the trigger that initiated the loop.
     * @mode emit
     */
    'self-evolve-loop/start'(info: { runId: SelfEvolveRunId; trigger: EvolveTrigger }): void
    /**
     * An evolution loop settled. Every `start` event emits exactly one end
     * event, including cancelled runs and rejected proposals.
     * @param info - run identity and the loop error, when the loop failed.
     * @mode emit
     */
    'self-evolve-loop/end'(info: { runId: SelfEvolveRunId; error?: string }): void
  }
}

/**
 * Abstract self-evolve service. Implementations own trigger policy, rate
 * limiting, verifier grounding, the proposal model route, and held-in/held-out
 * regression execution. A successful run commits its proposals through the
 * target seam for each level (skill register, systemPrompt.section, workflow
 * engine, dynamicCordisRunner).
 *
 * Load exactly one implementation per context; later providers shadow earlier
 * ones so the base provider can be swapped for L4 harness-safe variants.
 */
export abstract class SelfEvolveEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'selfEvolve')
  }

  /**
   * Consider running an evolution loop for an explicit trigger. Idle and
   * pressure triggers are rate-limited by the implementation; `user-command`
   * always initiates a loop (subject to approval defaults). Return `null` when
   * the policy decides no run is needed. `runMaintenance` on the agent owns
   * idle-gating; callers do not double-check it.
   *
   * @param agent Owner session and maintenance runner; also supplies the
   *              routed provider/model target so proposals use the same route.
   * @param trigger Why this call is asking for a run.
   * @param signal Cancels the loop as early as possible; cancellation records
   *               a `self-evolve/end` error rather than leaving the log open.
   * @param levels Restrict the edit surfaces this loop may propose against.
   *               Defaults to `['L1-skill', 'L2-context']` for safety.
   * @returns the loop result, or `null` when policy decides no run is needed.
   */
  abstract evolveIfNeeded(
    agent: SelfEvolveAgentContext,
    trigger: EvolveTrigger,
    signal: AbortSignal,
    levels?: EvolveLevel[],
  ): Promise<SelfEvolveResult | null>

  /**
   * Explicitly run an evolution loop now, regardless of pressure policy.
   * Enforces the same approval and validation gates as an idle loop.
   *
   * @param agent Owner session and maintenance runner.
   * @param signal Cancels the loop as early as possible.
   * @param levels Restrict the edit surfaces this loop may propose against.
   * @returns the loop result.
   */
  abstract evolveNow(
    agent: SelfEvolveAgentContext,
    signal: AbortSignal,
    levels?: EvolveLevel[],
  ): Promise<SelfEvolveResult>

  /**
   * Read the latest projected failure-pattern state for a session, or the
   * empty state if the projection has not folded yet. Implementations may
   * return a stale view; callers do not rely on synchronous freshness.
   *
   * @param sessionId - opaque session identity.
   * @returns ranked failure patterns for the session.
   */
  abstract readPatterns(sessionId: string): Promise<FailurePattern[]>
}
