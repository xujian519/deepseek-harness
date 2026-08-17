/**
 * Methodology protocol types: the contract for reasoning-methodology prompt
 * injection and the TRIZ data assets.
 *
 * Ported from Sati's src/methodology/protocol/types.ts. Each component is a
 * pure rule implementation: identify() scores how well the methodology fits a
 * task, execute() produces a structured prompt template (no LLM calls).
 * @module @deepseek-ai/dsh-methodology/types
 */

export type MethodologyCategory = 'analytical' | 'classical' | 'creative' | 'dialectical'

/** Domain tags used for applicability filtering. */
export type MethodologyDomain = 'patent' | 'legal' | 'coding' | 'general'

/** One reasoning task the component scores and renders against. */
export type MethodologyContext = {
  /** The user's task/goal text. */
  goal: string
  /** Lowercased keyword tokens extracted from the goal. */
  keywords: string[]
}

/** The component's rendered output. */
export type MethodologyExecutionResult = {
  /** The structured prompt text to inject. */
  prompt: string
}

/** A registered reasoning methodology (pure rule implementation). */
export interface MethodologyComponent {
  /** Stable identifier, e.g. "five-whys". */
  name: string
  /** One-line description shown to the model. */
  description: string
  category: MethodologyCategory
  /** Domains the methodology applies to. */
  applicableDomains: MethodologyDomain[]
  /** Optional prerequisite component names (informational only). */
  dependencies?: string[]

  /** Match score in [0, 1]: how well this methodology fits the task. */
  identify(context: MethodologyContext): number
  /** Produce the injection prompt for the task. */
  execute(context: MethodologyContext): MethodologyExecutionResult
}

/** One scored component match. */
export type MethodologyMatch = {
  component: MethodologyComponent
  score: number
}

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
  /** Lowercased substring matched against a goal to detect the parameter. */
  match: string
  /** Human-facing parameter label. */
  label: string
}
