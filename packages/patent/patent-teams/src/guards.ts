/**
 * String guards shared by the durable-state reader and its invariant companion.
 * The two modules validate the same records from opposite sides of the write:
 * `state.ts` reads a persisted team file, `invariant.ts` reads a logged event
 * payload, and both must agree on which fields carry a usable string.
 * @module @deepseek-ai/dsh-patent-teams/guards
 */

/**
 * Whether a field is a string other than the empty one. Surrounding whitespace
 * is accepted, because the writer stores names verbatim and only the empty
 * string marks an unusable value here.
 * @param value - untrusted field from a persisted record or a logged payload.
 * @returns whether the value is a string with at least one character.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Whether a field is a string carrying at least one non-whitespace character.
 * Distinct from {@link isNonEmptyString}: a name of only spaces reads as absent
 * here, which is what the persisted-record readers require.
 * @param value - untrusted field from a persisted record.
 * @returns whether the value is a string whose trimmed form is not empty.
 */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Whether a field is absent or a string.
 * @param value - untrusted field from a persisted record or a logged payload.
 * @returns whether the value is `undefined` or a string.
 */
export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}
