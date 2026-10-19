/**
 * Result-cap normalization shared by the knowledge tools. SQLite rejects a
 * fractional `LIMIT` operand, so a model-supplied decimal is truncated before
 * clamping instead of reaching the query.
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/query-limit
 */

/**
 * Normalize a model-supplied result cap.
 * @param value - the requested cap, if the model sent one.
 * @param fallback - cap used when the parameter is omitted or not finite.
 * @param max - largest cap the tool accepts.
 * @returns an integer in `[1, max]`.
 */
export function resolveResultLimit(value: number | undefined, fallback = 5, max = 10): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), max)
}
