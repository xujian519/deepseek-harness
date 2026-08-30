/**
 * Shared value primitives for classifying and validating `unknown` inputs at
 * parser and config boundaries: an object guard and a fail-loud positive
 * integer assertion. Pure predicates only — no I/O, no dependency.
 * @module @deepseek-ai/dsh-value
 */

/**
 * Test whether a value is a non-null, non-array object. Class instances,
 * `Map`, `Date`, and `RegExp` all pass: the guard owns the object shape, not
 * the prototype. Arrays and `null` are rejected because callers index them
 * differently than records.
 *
 * @param value The untrusted value to classify.
 * @returns Whether the value behaves as a record of unknown values.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Assert a positive integer (>= 1) and narrow an `unknown` value to `number`.
 *
 * @param label Diagnostic label naming the validated input; the thrown message
 *   reads `${label} must be a positive integer`.
 * @param value The untrusted value to validate.
 * @throws TypeError when `value` is not an integer >= 1.
 */
export function assertPositiveInteger(label: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`)
  }
}

/**
 * Assert a positive finite number (not necessarily an integer) and narrow an
 * `unknown` value to `number`.
 *
 * @param label Diagnostic label naming the validated input; the thrown message
 *   reads `${label} must be a positive finite number`.
 * @param value The untrusted value to validate.
 * @throws TypeError when `value` is not a finite number > 0.
 */
export function assertPositiveFinite(label: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`)
  }
}
