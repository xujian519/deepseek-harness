import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque stable identity for one completed or in-progress self-evolve run. */
export type SelfEvolveRunId = Branded<'SelfEvolveRunId'>

/**
 * Brand an implementation-minted self-evolve run identity.
 * @param id - opaque run identity.
 * @returns the same string, branded; no validation is performed.
 */
export function SelfEvolveRunId(id: string): SelfEvolveRunId {
  return id as SelfEvolveRunId
}

/** Opaque stable identifier for one verifier-grounded failure pattern class. */
export type FailurePatternId = Branded<'FailurePatternId'>

/**
 * Brand an implementation-minted failure-pattern identity.
 * @param id - opaque pattern identity.
 * @returns the same string, branded; no validation is performed.
 */
export function FailurePatternId(id: string): FailurePatternId {
  return id as FailurePatternId
}

/** Opaque stable identifier for one immutable harness proposal. */
export type EvolveProposalId = Branded<'EvolveProposalId'>

/**
 * Brand an implementation-minted proposal identity.
 * @param id - opaque proposal identity.
 * @returns the same string, branded; no validation is performed.
 */
export function EvolveProposalId(id: string): EvolveProposalId {
  return id as EvolveProposalId
}
