/**
 * Function plugin registering `query_writing_patterns` and the writing-pattern
 * system-prompt section over the pattern corpus packaged with this plugin.
 *
 * The corpus is read and validated at plugin load, so a missing or invalid
 * asset fails the deployment instead of leaving the model with an empty
 * pattern library or a section that silently drops patterns.
 * @module @deepseek-ai/dsh-writing-patterns
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadPatternStore, type PatternStore } from './pattern-store.ts'
import { renderWritingSkillsSection, WRITING_PATTERNS_SECTION_NAME } from './prompt.ts'
import { compileWritingSkills } from './skill-compiler.ts'
import { createQueryWritingPatternsTool } from './tool/query-writing-patterns.ts'
import { PATTERN_CATEGORIES, type PatternCategory, type WritingPattern } from './types.ts'

// Public library API: the pattern corpus, its lexical selection, the compiled
// skill text, the quality evaluation, and the tool factory.
export { PATTERN_FILE_SUFFIX, patternDir } from './asset-location.ts'
export {
  loadPatternCorpus,
  loadPatternStore,
  parsePatternFile,
  PatternStore,
  patternKeywords,
  type PatternMatchSpec,
  type PatternSearchSpec,
} from './pattern-store.ts'
export { compileWritingSkills, escapeXmlText } from './skill-compiler.ts'
export { evaluateQuality, type QualityDimensions, type QualityEvaluation } from './quality-evaluator.ts'
export {
  renderWritingSkillsSection,
  WRITING_PATTERNS_PROMPT_TEXT,
  WRITING_PATTERNS_SECTION_NAME,
} from './prompt.ts'
export {
  createQueryWritingPatternsTool,
  renderQueryWritingPatterns,
  type QueryWritingPatternsInput,
  type QueryWritingPatternsMode,
  type QueryWritingPatternsOutput,
  type QueryWritingPatternsToolOptions,
  type WritingPatternView,
} from './tool/query-writing-patterns.ts'
export {
  DEFAULT_PATTERN_QUALITY,
  isPatternCategory,
  PATTERN_CATEGORIES,
  PATTERN_CATEGORY_LABELS,
  PatternAssetError,
  WritingPatternError,
  type PatternCategory,
  type PatternExample,
  type PatternPrinciple,
  type PatternStep,
  type WritingPattern,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'writing-patterns'

/** Services the plugin requires before registration. */
export const inject = ['tools', 'systemPrompt']

/** Result cap applied when a call omits its own limit; the Go source capped a match at 5. */
const DEFAULT_MATCH_LIMIT = 5

/** Position of the injected section, next to the patent-domain TRIZ section at 111. */
const DEFAULT_SECTION_ORDER = 112

/** Model-facing writing-pattern plugin configuration. */
export interface Config {
  /** Directory holding the pattern YAML files; defaults to the packaged corpus. */
  patternDir?: string
  /** Result cap applied when a `query_writing_patterns` call omits its own limit. */
  matchLimit?: number
  /** Register the always-on writing-patterns system-prompt section. Defaults to true. */
  registerSection?: boolean
  /** Categories whose patterns the section injects; an empty list injects the guidance alone. */
  sectionCategories?: PatternCategory[]
  /** Position of the injected section in the assembled system prompt. */
  sectionOrder?: number
}

/** Schemastery configuration: corpus override, result cap, and section policy. */
export const Config: z<Config> = z.object({
  patternDir: z.string(),
  matchLimit: z.natural().min(1).default(DEFAULT_MATCH_LIMIT),
  registerSection: z.boolean().default(true),
  sectionCategories: z.array(z.union(PATTERN_CATEGORIES)).default([...PATTERN_CATEGORIES]),
  sectionOrder: z.natural().default(DEFAULT_SECTION_ORDER),
})

/**
 * Register the query_writing_patterns tool and, by default, the
 * writing-patterns section carrying the compiled patterns.
 * @param ctx - registrant context carrying the tool registry and system prompt.
 * @param config - corpus location, result cap, and section policy.
 * @throws PatternAssetError when the configured corpus cannot be loaded.
 */
export function apply(ctx: Context, config: Config): void {
  const store = loadPatternStore(config.patternDir)
  ctx.tools.register(createQueryWritingPatternsTool({
    store,
    matchLimit: config.matchLimit ?? DEFAULT_MATCH_LIMIT,
  }))
  if (config.registerSection === false) return
  const patterns = sectionPatterns(store, config.sectionCategories ?? PATTERN_CATEGORIES)
  ctx.systemPrompt.section({
    name: WRITING_PATTERNS_SECTION_NAME,
    order: config.sectionOrder ?? DEFAULT_SECTION_ORDER,
    text: renderWritingSkillsSection(compileWritingSkills(patterns)),
  })
}

/**
 * Patterns the section injects: the requested categories in the given order,
 * each in id order, with a pattern tagged by two requested categories listed once.
 * @param store - the loaded corpus.
 * @param categories - the categories to inject.
 * @returns the patterns in injection order.
 */
function sectionPatterns(store: PatternStore, categories: readonly PatternCategory[]): readonly WritingPattern[] {
  const seen = new Set<string>()
  const patterns: WritingPattern[] = []
  for (const category of categories) {
    for (const pattern of store.byCategory(category)) {
      if (seen.has(pattern.id)) continue
      seen.add(pattern.id)
      patterns.push(pattern)
    }
  }
  return patterns
}
