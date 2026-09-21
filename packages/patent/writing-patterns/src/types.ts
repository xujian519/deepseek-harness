/**
 * Writing-pattern vocabulary: the record the pattern corpus is written in, its
 * closed category set, and the package's error types.
 *
 * Ported from the MIT-licensed Go project `Mady/domains/writing` (pattern_types.go);
 * the JSON/YAML tags there are the field names here.
 * @module @deepseek-ai/dsh-writing-patterns/types
 */

/** One ordered step of a writing pattern. */
export type PatternStep = {
  /** Position in the pattern, as authored (1-based in the shipped corpus). */
  order: number
  name: string
  instruction: string
  /** Worked example for this step. */
  example?: string
}

/** One worked example attached to a pattern. */
export type PatternExample = {
  context?: string
  text: string
  note?: string
}

/** One rule to follow or avoid, optionally with its worked example. */
export type PatternPrinciple = {
  rule: string
  example?: string
}

/**
 * The pattern categories. Mirrors the `PatternCategory` constants of the Go
 * source (`pattern_store.go` / `pattern_types.go`); the set is closed because
 * the tool schema selects a category by enum.
 */
export const PATTERN_CATEGORIES = [
  'oa_inventiveness',
  'oa_novelty',
  'oa_clarity',
  'claim_drafting',
  'spec_drafting',
  'disclosure',
  'invalidation',
  'ipc_strategy',
  'embodiment',
] as const

/** One category of the closed {@link PATTERN_CATEGORIES} set. */
export type PatternCategory = (typeof PATTERN_CATEGORIES)[number]

/** Display name per category, used in reports and the schema description. */
export const PATTERN_CATEGORY_LABELS: Readonly<Record<PatternCategory, string>> = {
  oa_inventiveness: 'OA 答复-创造性',
  oa_novelty: 'OA 答复-新颖性',
  oa_clarity: 'OA 答复-不清楚',
  claim_drafting: '权利要求撰写',
  spec_drafting: '说明书撰写',
  disclosure: '技术交底书',
  invalidation: '无效请求',
  ipc_strategy: 'IPC 策略',
  embodiment: '具体实施方式',
}

/**
 * Whether a value is a known pattern category.
 * @param value - the value to test.
 * @returns true when the value is one of {@link PATTERN_CATEGORIES}.
 */
export function isPatternCategory(value: unknown): value is PatternCategory {
  return typeof value === 'string' && (PATTERN_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Quality of a pattern that carries none of its own. Carried over from the Go
 * source, which defaults a missing or non-positive `quality` to 0.8.
 */
export const DEFAULT_PATTERN_QUALITY = 0.8

/**
 * An applicable writing pattern: how one drafting or reply situation is
 * written, as ordered steps plus the rules to follow and avoid.
 */
export type WritingPattern = {
  /** Stable id, unique across the loaded corpus. */
  id: string
  name: string
  category: PatternCategory
  /** Free-text refinement inside the category, e.g. `background` under spec drafting. */
  subCategory?: string
  /** One-sentence statement of the pattern's core idea. */
  summary: string
  /** When this pattern applies. */
  context?: string
  steps: readonly PatternStep[]
  examples: readonly PatternExample[]
  dos: readonly PatternPrinciple[]
  donts: readonly PatternPrinciple[]
  /** Where the pattern was distilled from. */
  sourceRef?: string
  /** Relevance weight in `(0, 1]`, multiplying a search hit. */
  quality: number
  version?: number
}

/** Base class for every error this package raises. */
export class WritingPatternError extends Error {
  /**
   * @param message - what went wrong.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WritingPatternError'
  }
}

/** A pattern asset cannot be read, parsed, or validated. */
export class PatternAssetError extends WritingPatternError {
  /** Directory or file the failure came from. */
  readonly source: string

  /**
   * @param source - the pattern directory or file that failed.
   * @param message - what is wrong with the asset.
   */
  constructor(source: string, message: string) {
    super(`${source}: ${message}`)
    this.name = 'PatternAssetError'
    this.source = source
  }
}
