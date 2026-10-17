/**
 * TRIZ data types: the protocol for the shipped inventive principles,
 * engineering parameters, and separation principles.
 * @module @deepseek-ai/dsh-methodology/types
 */

/** One TRIZ inventive principle from the shipped triz-principles.json asset. */
export interface TrizPrinciple {
  /** Principle number, 1-40. */
  no: number
  /** Principle name. */
  name: string
  /** Principle explanation. */
  description: string
}

/** One of the 39 classic contradiction-matrix engineering parameters. */
export interface TrizParameter {
  /** Parameter number, 1-39. */
  no: number
  /** Human-facing parameter label. */
  label: string
}

/** One of the separation principles used to resolve a physical contradiction. */
export interface TrizSeparation {
  /** Stable identifier, e.g. "space". */
  id: string
  /** Separation principle name. */
  name: string
  /** How to apply the separation. */
  description: string
  /** Observable signals that this separation fits the conflict. */
  signals: string[]
}
