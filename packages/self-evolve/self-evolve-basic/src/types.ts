/**
 * Vocabulary and configuration defaults for the basic self-evolve provider.
 *
 * The default levels (`L1-skill`, `L2-context`) are narrow enough that a
 * provider-neutral plugin registry can apply them without model-visible side
 * effects: skills register to `ctx.skills`, prompt sections register to
 * `ctx.systemPrompt`, and both dispose cleanly on fiber teardown. L3 and L4
 * levels require dedicated providers with sandbox + approval guards.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic/types
 */

import type { EvolveLevel, EvolveTrigger } from '@deepseek-ai/dsh-self-evolve'

/** Per-trigger rate-limiting policy for the basic provider. */
export type TriggerPolicy = Record<EvolveTrigger, { enabled: boolean; minIntervalMs: number }>

/** Resolved configuration with defaults applied; `proposerTarget`/`validatorTarget` stay optional. */
export interface ResolvedBasicSelfEvolveConfig extends Required<Omit<BasicSelfEvolveConfig, 'proposerTarget' | 'validatorTarget'>> {
  proposerTarget?: { provider: string; model: string }
  validatorTarget?: { provider: string; model: string }
}

/** Public configuration for the basic self-evolve provider. */
export interface BasicSelfEvolveConfig {
  /** Maximum autonomous loops started per session per 24-hour wall-clock window. */
  maxDailyLoopsPerSession?: number
  /** Which triggers this provider will honour. */
  triggers?: TriggerPolicy
  /** Which edit surfaces proposals target; undefined = default L1+L2 only. */
  defaultLevels?: EvolveLevel[]
  /** Minimum occurrence count before a pattern becomes a proposal target. */
  minPatternOccurrences?: number
  /** Maximum number of proposals generated per loop; positive integer. */
  maxProposalsPerLoop?: number
  /** Provider/model target routed for the proposer LLM call; absent => same as session. */
  proposerTarget?: { provider: string; model: string }
  /**
   * Provider/model target routed for the validation LLM judge (P1.4). Absent
   * disables the judge (structural scores only). When set, it MUST differ from
   * `proposerTarget` — load-time validation rejects identical targets so the
   * judge cannot drift with the proposer (Validator 漂移防护).
   */
  validatorTarget?: { provider: string; model: string }
  /**
   * Minimum aggregate confidence for an accepted proposal:
   * `min(deconstructedScores) × heldInRate × heldOutRate`. The weak path
   * (verifier signals or held-out unavailable) caps each missing rate at 0.3,
   * so unverifiable proposals are rejected conservatively instead of
   * committing on trust.
   */
  minAcceptConfidence?: number
  /**
   * Maximum held-out cases searched and replayed per proposal (P1.3).
   */
  maxHeldOutCases?: number
  /**
   * Held-out pass-rate threshold (P1.3): a proposal whose similar-history
   * replays pass at or above this ratio counts as held-out-passed; below it
   * the evidence note marks the surface as failing.
   */
  minHeldOutPassRate?: number
  /**
   * Long-horizon prompt-inflation budget (翁荔挑战 7, P1.9): when the total
   * bytes of live self-evolve-generated L2 sections exceeds this, the pruning
   * job archives the oldest sections (to `$DSH_HOME/self-evolve/l2-archive/`)
   * and disposes their effects until the total is back under the budget.
   */
  maxPromptInflationBytesPerWeek?: number
  /**
   * L4 re-approval cadence (Phase 2, P2.3): an L4 plugin approved by
   * self-evolve more than this many hours ago is forced through human
   * approval again, even when `approveFutureVersions` grants would
   * auto-approve. Cross-proposal reuse of a plugin id always re-approves.
   */
  l4ReapprovalHours?: number
  /**
   * Maximum step reflections per turn (Phase 3, P3.1): a low-budget LLM
   * reflection on a failing step runs at most this many times per turn.
   * Zero disables step reflection entirely.
   */
  maxStepReflectionsPerTurn?: number
  /**
   * Minimum model-reported confidence for a step reflection to reinforce a
   * pattern (Phase 3, P3.1); below this the reflection is dropped.
   */
  reflectionMinConfidence?: number
  /**
   * Per-pattern proposal freeze window (Phase 3, P3.3): after a pattern has
   * been proposed twice, it is skipped for this many hours (diversity
   * collapse guard).
   */
  patternFreezeHours?: number
  /**
   * Per-loop byte budget for LLM calls and search (Phase 3, P3.4): when the
   * accumulated request bytes exceed it, the loop aborts with
   * `budget-exceeded` and closes its bracket with an error.
   */
  maxBudgetCharsPerLoop?: number
  /**
   * Held-In dual verification gate (翁荔挑战 1). When true, proposals are
   * rejected unless BOTH the replay and workspace verifiers pass; the base
   * provider's collectors return `null` until P1.2/P1.3 infrastructure lands,
   * so the gate degrades to the bracket-smoke validator (honest, no fake
   * acceptances are produced by the dual check).
   */
  requireDualVerification?: boolean
  /**
   * Held-In dual-verifier (翁荔挑战 1) tolerance: number of dirty lines the
   * build/dirty-state signal may add to a workspace before marking a replay
   * as dirty-regression. Keeps small formatter jitter from failing the gate.
   */
  maxDirtyLinesAddedPerCommit?: number
}
