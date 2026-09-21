/**
 * The model-facing writing-pattern section: the stable instruction prose plus
 * the compiled `<writing_skills>` block of the patterns this deployment injects.
 * @module @deepseek-ai/dsh-writing-patterns/prompt
 */

/** Name of the system-prompt section this package contributes. */
export const WRITING_PATTERNS_SECTION_NAME = 'writing-patterns:skills'

/**
 * Stable system-prompt prose: what the injected block is, and when the model
 * should reach for the tool instead of reading it.
 */
export const WRITING_PATTERNS_PROMPT_TEXT = [
  'The <writing_skills> block below lists the writing patterns of this deployment for patent drafting and office-action replies; each pattern names one drafting situation with its ordered steps and the rules to follow or avoid.',
  'When the case at hand is not covered by those patterns, call query_writing_patterns with the case category, the case features, or search keywords to retrieve the patterns that match it.',
].join('\n\n')

/**
 * The section text: the instruction prose, then the compiled patterns when the
 * deployment injects any.
 *
 * The compiled block is fenced so the section reads as instruction prose plus
 * one quoted data block: a bare multi-line XML run would parse as a prose
 * paragraph of the prompt itself, which both obscures where the data starts and
 * violates the one-physical-line-per-paragraph convention for prompt text.
 * @param skills - the compiled `<writing_skills>` block, or `''` for none.
 * @returns the section text.
 */
export function renderWritingSkillsSection(skills: string): string {
  return skills === '' ? WRITING_PATTERNS_PROMPT_TEXT : `${WRITING_PATTERNS_PROMPT_TEXT}\n\n\`\`\`xml\n${skills}\n\`\`\``
}
