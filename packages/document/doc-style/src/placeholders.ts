/**
 * The placeholder vocabulary the document pipeline shares. The template fill
 * side reports what substitution left behind, and the quality gate rejects
 * those same residuals; both read this one definition instead of restating the
 * pattern, so a change to the form cannot land on only one side.
 *
 * Two forms live here. {@link placeholderBracePattern} is the fillable one: a
 * `{{name}}` the caller substitutes by name, so the render side and the gate
 * must agree on exactly which braces are placeholders. {@link residualPlaceholderPatterns}
 * adds the markers no variable fills — `[TBD]`, `Lorem ipsum`, `待补充` — that
 * an unfinished draft carries and the gate rejects.
 * @module @deepseek-ai/dsh-doc-style/placeholders
 */

/**
 * The marker strings an unfinished draft leaves behind, grouped by the form
 * they take. They are data rather than expression source, so documentation and
 * skill text can enumerate the same list the gate enforces.
 */
export const PLACEHOLDER_MARKERS = {
  /** Bracketed uppercase markers, matched case-insensitively. */
  bracketed: ['TBD', 'TODO', 'REPLACE', 'PLACEHOLDER', 'XXX'],
  /** The Latin filler that stands in for unwritten prose, matched case-insensitively. */
  latin: ['lorem ipsum'],
  /** Chinese markers saying the text is yet to be written. */
  chinese: ['待补充', '待填写', '此处填写'],
} as const

/**
 * The unfilled double-brace placeholder: any non-empty run between `{{` and
 * `}}` that holds neither a brace nor a newline, at most 80 characters. A name
 * may be CJK or carry surrounding spaces (`{{ case_id }}`); a consumer trims it
 * before matching a variable name.
 *
 * A caller owns the returned expression's `lastIndex`, so each call returns a
 * fresh one rather than sharing a stateful instance across scan sites.
 * @returns a new global, Unicode regular expression matching one placeholder.
 */
export function placeholderBracePattern(): RegExp {
  return /\{\{[^{}\n]{1,80}\}\}/gu
}

/**
 * Every residual-placeholder form the gate rejects, in report order: the
 * fillable braces first, then the bracketed, Latin, and Chinese markers.
 *
 * Each expression is fresh: a caller owns its `lastIndex`.
 * @returns one global expression per form.
 */
export function residualPlaceholderPatterns(): readonly RegExp[] {
  return [
    placeholderBracePattern(),
    new RegExp(`\\[(?:${alternation(PLACEHOLDER_MARKERS.bracketed)})\\]`, 'giu'),
    new RegExp(alternation(PLACEHOLDER_MARKERS.latin), 'giu'),
    new RegExp(alternation(PLACEHOLDER_MARKERS.chinese), 'gu'),
  ]
}

/**
 * One group of literal words as a regular-expression alternation.
 * @param words - the literals; none is a pattern.
 * @returns their alternation, with each literal escaped.
 */
function alternation(words: readonly string[]): string {
  return words.map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')
}
