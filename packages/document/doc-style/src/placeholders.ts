/**
 * The placeholder vocabulary the document pipeline shares. The template fill
 * side reports what substitution left behind, and the quality gate rejects
 * those same residuals; both read this one definition instead of restating the
 * pattern, so a change to the form cannot land on only one side.
 * @module @deepseek-ai/dsh-doc-style/placeholders
 */

/**
 * The unfilled double-brace placeholder: any non-empty run between `{{` and
 * `}}` that holds neither a brace nor a newline, at most 80 characters.
 *
 * A caller owns the returned expression's `lastIndex`, so each call returns a
 * fresh one rather than sharing a stateful instance across scan sites.
 * @returns a new global, Unicode regular expression matching one placeholder.
 */
export function placeholderBracePattern(): RegExp {
  return /\{\{[^{}\n]{1,80}\}\}/gu
}
