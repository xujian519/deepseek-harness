/**
 * Input, output, and shared vocabulary of the `validate_specification` checks.
 *
 * Every checker module reads these types; the tool assembly and the pure entry
 * point in `validate-specification.ts` own them.
 */

import type { TechDomain } from './draft-claims.ts'

/** Tool input: the specification fields to validate. */
export type ValidateSpecificationInput = {
  /** Specification full text (markdown, with section headings). */
  text?: string
  /** Invention title (optional; length checked separately). */
  title?: string
  /** Abstract (optional; length / keywords / drawing checked). */
  abstract?: string
  /** Claims full text (optional; used for feature-coverage comparison). */
  claims?: string
  /** Technical domain; "chemical" enables the characterization-data check. */
  tech_domain?: TechDomain
  /** Figure-analysis results (optional); enables figure-mark consistency. */
  figure_analysis?: FigureAnalysisResult[]
  /** Structured claims (optional); enables the independent-claim unity check. */
  claim_units?: ClaimUnitInput[]
  /** Claim-to-embodiment entries (optional); enables the coverage matrix. */
  coverage_entries?: CoverageEntryInput[]
}

/** One claim of the application, split into its preamble and characterizing part. */
export type ClaimUnitInput = {
  /** Claim number as printed in the claims. */
  number: number
  /** Whether the claim is an independent claim; only independent claims enter the unity check. */
  kind: 'independent' | 'dependent'
  /** Preamble, e.g. "一种智能门锁". */
  preamble: string
  /** Characterizing part (after "其特征在于"). */
  characterized?: string
}

/**
 * One claim-to-embodiment entry. Coverage is computed from `features` and
 * `embodiment_refs`; a caller-supplied coverage verdict is not part of the input.
 */
export type CoverageEntryInput = {
  /** Claim identifier of the form `claim_<n>`. */
  claim_id: string
  /** Technical features of that claim. */
  features: string[]
  /** Embodiment passages that support the claim. */
  embodiment_refs: string[]
}

/** One compliance violation. */
export type SpecViolation = {
  rule: string
  severity: 'error' | 'warning'
  section?: string
  message: string
  suggestion?: string
}

/** The canonical validation result. */
export type ValidateSpecificationOutput = {
  passed: boolean
  score: number
  violations: SpecViolation[]
}

/** A numeric range extracted from the specification. */
export type NumericRange = { min: number; max: number; unit: string }

/** One recognized figure component as read by the consistency checker. */
export type FigureComponentRef = {
  /** Reference mark from the figure (Arabic numerals only). */
  refNumber: string
}

/**
 * Minimal figure-analysis result consumed by this checker: `usable` and each
 * component's `refNumber` reconcile figure marks against the drawing-description
 * section, and `figureNumber` (optional) reconciles the abstract figure. Ported
 * from Sati's full `FigureAnalysisResult` (the rest is not needed here).
 */
export type FigureAnalysisResult = {
  /** Figure number of the analyzed drawing; absent for callers that only check marks. */
  figureNumber?: number
  /** Whether the analysis cleared the usable-confidence threshold. */
  usable: boolean
  /** Recognized components with their reference marks. */
  components: FigureComponentRef[]
}

/** Injectable dependencies for the `validate_specification` tool. */
export type ValidateSpecificationDeps = {
  /** Reports whether the RDKit chemistry engine is available for SMILES validation. Defaults to false (RDKit is not bundled in dsh). */
  isRdkitAvailable?: () => boolean
}
