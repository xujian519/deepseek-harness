/**
 * Shared output schema and Markdown rendering for model-visible warning lists.
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/tool-output
 */

/** JSON schema for a required list of model-visible warnings. */
export const WARNINGS_SCHEMA = {
  type: 'array',
  required: true,
  items: { type: 'string' },
} as const

/**
 * Render a warning list as a Markdown section.
 * @param warnings - model-visible warnings.
 * @param heading - heading text used when the list is non-empty.
 * @returns a blank separator, the heading, and one bullet per warning; empty when there are none.
 */
export function warningSection(warnings: readonly string[], heading = '警告'): string[] {
  if (warnings.length === 0) return []
  return ['', `## ${heading}`, ...warnings.map(warning => `- ${warning}`)]
}
