/**
 * Self-evolve vocabulary: result types, failure pattern identifiers, and the
 * `self-evolve/*` durable session events.
 *
 * Three-stage evolution loop:
 *   1. Weakness mining — fold the session event stream into verifier-grounded
 *      failure patterns via the `failure-patterns` session projection unit.
 *   2. Harness proposal — generate a bounded edit over L1 (skills), L2
 *      (context/prompt sections), L3 (workflows), or L4 (dynamic cordis
 *      packages). Each proposal produces an immutable candidate identity.
 *   3. Proposal validation — run held-in + held-out regression. Candidates
 *      that regress held-out metrics are rejected; accepted candidates
 *      commit their effect through the owning seam (skill register, preset
 *      recompose, workflow install, or cordis_run + guarded approval).
 *
 * @module @deepseek-ai/dsh-self-evolve/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import { SelfEvolveRunId } from './brand.ts'

export type { SelfEvolveRunId }

/** The four harness edit surfaces, ordered from narrowest to widest blast radius. */
export type EvolveLevel = 'L1-skill' | 'L2-context' | 'L3-workflow' | 'L4-harness'

/** Trigger classification for an autonomous or explicit evolution run. */
export type EvolveTrigger = 'idle-maintenance' | 'pressure' | 'user-command' | 'validation-retry'

/** Stable classification of one verifier-grounded failure pattern. */
export interface FailurePattern {
  /** Opaque stable identifier for this pattern class. */
  patternId: string
  /**
   * Verifier layer that grounded this pattern. Weak tiers lift the
   * `minPatternOccurrences` threshold so poorly-grounded signals do not
   * trigger early proposals.
   */
  verifierTier: 'tool-runtime' | 'subprocess-exit' | 'llm-provider' | 'agent-loop'
  /**
   * Stable signature computed from the verifier-layer causal state, not the
   * human-readable summary. Two events with the same `(level, verifierTier,
   * causalSignature)` collapse to one pattern even if their free-form
   * summaries drift.
   */
  causalSignature: string
  /** The level whose edit surface is expected to address this failure. */
  level: EvolveLevel
  /** Short verifier-grounded summary; visible to the proposer model. */
  summary: string
  /** The durable event seqs in the owning session that exemplify the failure. */
  supportingSeqs: number[]
  /** Number of distinct occurrences this pattern describes within this session. */
  occurrences: number
  /** Structured verifier metadata; schema is owner-specific per level. */
  verifierMeta: Record<string, unknown>
}

/** Durable view used as the `SessionProjectionMap['failure-patterns']` contract. */
export interface FailurePatternsProjection {
  readonly patterns: Record<string, FailurePattern>
  readonly discoveryOrder: string[]
  readonly lastMinedSeq: number
}

/** One immutable proposal as produced by the harness-proposal stage. */
export interface EvolveProposal {
  /** Opaque stable identity minted by the registry when the proposal is defined. */
  proposalId: string
  /** The owning run this proposal was generated within. */
  runId: SelfEvolveRunId
  /** The level and edit surface this proposal targets. */
  level: EvolveLevel
  /** Human-readable name; model-minted. */
  name: string
  /** One-sentence purpose statement. */
  purpose: string
  /** The pattern ids this proposal was generated to address. */
  addressesPatternIds: string[]
  /** Optional preliminary validation record retained before the formal validator runs. */
  preliminaryValidation?: Extract<ProposalValidationOutcome, { kind: 'accepted' }>
  /** Level-specific serialized candidate. */
  candidate:
    | { kind: 'L1-skill'; skillName: string; content: string; whenToUse?: string }
    | { kind: 'L2-context'; sectionName: string; sectionText: string; order: number; estimatedBytes: number }
    | { kind: 'L3-workflow'; scriptName: string; scriptBody: string }
    | {
      kind: 'L4-harness'
      pluginIdPrefix: string
      hostCode?: string
      clientCode?: string
    }
}

/** Result of a single proposal validation attempt. */
export type ProposalValidationOutcome =
  | {
    kind: 'accepted'
    heldInPassed: number
    heldOutPassed: number
    regressions: []
    /** Per-dimension structural scores, 0–1. `confidence` combines them. */
    deconstructedScores: ValidationScores
    /**
     * Aggregate confidence in this acceptance: min(deconstructedScores.*) ×
     * heldInRate × heldOutRate. Gating threshold lives on the provider config.
     */
    confidence: number
    /**
     * Durable replay evidence produced by the validator: one row per held-in
     * case, one row per held-out query. Downstream propose stages read these
     * as few-shot diagnostics.
     */
    replayEvidence: ReplayEvidence[]
    /** Proposal-level repair hint for the next round; empty when clean. */
    nextRoundSuggestion: string
  }
  | {
    kind: 'rejected'
    reason:
      | 'held-in-failed'
      | 'held-out-regression'
      | 'apply-failed'
      | 'approval-denied'
      | 'rate-limited'
      | 'low-confidence'
    heldInPassed?: number
    heldOutPassed?: number
    regressions: string[]
    diagnostic: string
    /** Per-dimension structural scores, 0–1. Scores may be partial when rejected early. */
    deconstructedScores?: Partial<ValidationScores>
    /** Aggregate confidence; usually below threshold when kind='rejected'. */
    confidence?: number
    /** Durable replay evidence produced before rejection. */
    replayEvidence?: ReplayEvidence[]
    /** Concrete repair hint for the next proposal cycle; required for rejected. */
    nextRoundSuggestion: string
  }

/** Fixed-dimension structural scores produced by the LLM judge (P1.4). */
export interface ValidationScores {
  /** Does the candidate activate only on the intended failure class? */
  activatesWhenCorrect: number
  /** Is the candidate's wording unambiguous and self-contained? */
  clarity: number
  /** No observed regressions on held-in/held-out surfaces. */
  noRegressionIntroduced: number
  /** Safety check: does the candidate avoid suggesting destructive or over-broad edits? */
  safety: number
}

/** One durable replay unit produced during validation. */
export interface ReplayEvidence {
  /** `held-in` for supporting-seq replay, `held-out` for cross-session probe. */
  kind: 'held-in' | 'held-out'
  /** The pattern ids this replay was meant to cover. */
  coversPatternIds: string[]
  /** Whether the specific replay case was considered passing. */
  passed: boolean
  /** Verifier-grounded observation: exit code, error name, or other plain signal. */
  verifierSignal?: string
  /** Free-form model-facing diagnostic; always paired with a machine signal above. */
  note?: string
}

/** Successful commit of an accepted proposal. */
export interface EvolveCommit {
  /** The proposal that was committed. */
  proposal: EvolveProposal
  /** Validation outcome; always `accepted` for a commit. */
  validation: Extract<ProposalValidationOutcome, { kind: 'accepted' }>
  /** Session-level surface seq or durable event seq produced by the commit. */
  commitSeq: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Emitted when the agent loop records a failed model request. The
     * `error.code` drives the `llm-provider` tier's causal signature (Gate
     * SIG-4); `statusCode` is the provider's HTTP status when available.
     */
    'agent/request-error': {
      provider?: unknown
      model?: unknown
      statusCode?: unknown
      error?: unknown
    }
    /**
     * Marks the start of a single self-evolve loop — weakness mining, proposal,
     * validation, and optional commit. Log-only; holds the run lock until
     * `self-evolve/end`.
     */
    'self-evolve/start': {
      runId: SelfEvolveRunId
      sessionId: SessionId
      trigger: EvolveTrigger
      startedAt: number
      /** Levels this loop is allowed to target. */
      levels: EvolveLevel[]
      /** Pattern ids this loop will attempt to address; pinned for replay. */
      targeting: string[]
    }
    /**
     * Records the folded failure-pattern set produced by weakness mining for
     * this run. The snapshot is reconstructable from the projection unit plus
     * preceding session events; this event pins its durable identity.
     */
    'self-evolve/mined': {
      runId: SelfEvolveRunId
      patterns: FailurePattern[]
      /** Pattern ids that this run will attempt to address, in priority order. */
      targeting: string[]
    }
    /**
     * Records an immutable proposal definition produced by the harness-proposal
     * stage. Defined proposals are candidates; only a `self-evolve/commit`
     * event changes runtime behavior.
     */
    'self-evolve/proposed': {
      runId: SelfEvolveRunId
      proposal: EvolveProposal
    }
    /**
     * Records the validation outcome for one proposal. Rejected proposals do
     * not produce a matching commit event; the diagnostic here is the durable
     * record of why.
     */
    'self-evolve/validated': {
      runId: SelfEvolveRunId
      proposalId: string
      outcome: ProposalValidationOutcome
    }
    /**
     * Records a successful proposal commit: the proposal's effect has been
     * applied to the runtime through its owning seam, and the validation
     * outcome was `accepted`.
     */
    'self-evolve/commit': {
      runId: SelfEvolveRunId
      commit: EvolveCommit
    }
    /**
     * A low-budget step reflection (Phase 3, P3.1) reinforced an existing
     * failure pattern with high confidence: the projection folds it as extra
     * evidence (occurrences +1, supporting seq added). The pattern must
     * already exist — reflections never mint verifier-ungrounded patterns.
     */
    'self-evolve/reflection': {
      turn: number
      step: number
      patternId: string
      /** Model-reported confidence in the attribution, 0–1. */
      confidence: number
      /** One-sentence repair suggestion from the reflection. */
      suggestion: string
    }
    /**
     * Marks the end of a self-evolve loop — releases the run lock. `error`
     * records an unsuccessful loop; absent on clean termination.
     */
    'self-evolve/end': {
      runId: SelfEvolveRunId
      committedProposalIds: string[]
      error?: string
      endedAt: number
    }
  }
}

/** Aggregate result of a completed evolution loop. */
export interface SelfEvolveResult {
  /** Shared run identity. */
  runId: SelfEvolveRunId
  /** Trigger that initiated this run. */
  trigger: EvolveTrigger
  /** The mined pattern set targeted by this run. */
  patterns: FailurePattern[]
  /** All proposals generated during this run, in definition order. */
  proposals: EvolveProposal[]
  /** Commits performed by this run, in commit order. */
  commits: EvolveCommit[]
  /** Durable seq of the run's `self-evolve/start` event. */
  startSeq: number
  /** Durable seq of the run's `self-evolve/end` event. */
  endSeq: number
}

/** Minimal agent context the seam requires to start a maintenance run. */
export interface SelfEvolveAgentContext {
  sessionId: SessionId
  options: { provider?: string; model?: string }
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Failure-pattern projection: verifier-grounded weaknesses discovered by
     * incremental folding over the session log (SIG / §2.1).
     */
    'failure-patterns': FailurePatternsProjection
  }
}
