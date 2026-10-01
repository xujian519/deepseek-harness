/**
 * Input identity for the text-scanning tools: what a given evaluation actually read.
 *
 * `rule_check` and `validate_specification` take their text inline, so two callers
 * checking "the same document" can silently hand over different revisions of it —
 * measured on a real case, three teammates re-running one gate passed 12164, 12166
 * and 12177 characters, none of them the 13399-character file on disk, and the
 * verdicts differed exactly where the texts did. Nothing in the result said the
 * inputs differed, so reconciling the three runs took a written comparison table
 * and a human chase.
 *
 * Recording the identity of each text input makes that comparison mechanical: equal
 * identity means the same text was evaluated, and a differing count or digest is
 * visible without re-reading anything.
 * @module @deepseek-ai/dsh-patent-tools/internal/evaluated-input
 */

import { contentHash } from '@deepseek-ai/dsh-patent-core'

/** One text input, as the evaluation that produced a result read it. */
export type EvaluatedText = {
  /** Input field name (`text`, `title`, `abstract`, `claims`). */
  field: string
  /** Characters read (UTF-16 units — the count `String.length` reports). */
  chars: number
  /** Digest of exactly that value; two entries with the same digest read the same text. */
  digest: string
}

/**
 * Output-schema node for one {@link EvaluatedText} entry. Both tools' result schemas
 * declare their `evaluated` array with it, so the two cannot drift apart.
 */
export const EVALUATED_TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string', required: true },
    chars: { type: 'number', required: true },
    digest: { type: 'string', required: true },
  },
} as const

/**
 * Describe the text inputs one evaluation read, in the order given.
 *
 * Only text-bearing fields are described. Structured inputs (`figure_analysis`,
 * `claim_units`, `coverage_entries`) and enum switches are left out: they are
 * constructed per call rather than transcribed from a document, so they carry no
 * revision-drift risk, and a caller that passes different ones is running a
 * different check on purpose.
 * @param fields - input field name → the text this run actually received (omit absent fields).
 * @returns one entry per supplied field; absent fields produce no entry.
 */
export function evaluatedTexts(fields: Record<string, string | undefined>): EvaluatedText[] {
  const evaluated: EvaluatedText[] = []
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined) evaluated.push({ field, chars: value.length, digest: contentHash(value) })
  }
  return evaluated
}

/**
 * Render {@link EvaluatedText} entries into one model-facing line.
 *
 * Callers must keep this line when they transcribe a result into a deliverable: it
 * is what lets a later run show whether it read the same text.
 * @param evaluated - the entries produced by {@link evaluatedTexts}.
 * @returns the rendered `评估输入: …` line, or the empty string when nothing was evaluated.
 */
export function renderEvaluatedTexts(evaluated: readonly EvaluatedText[]): string {
  if (evaluated.length === 0) return ''
  const entries = evaluated.map(entry => `${entry.field} ${entry.chars} 字 · ${entry.digest}`)
  return `评估输入: ${entries.join('；')}`
}
