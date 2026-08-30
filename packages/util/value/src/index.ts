/**
 * Shared value primitives for classifying, validating, and freezing `unknown`
 * inputs at parser and config boundaries: object guards, fail-loud positive
 * number assertions, filesystem errno tests, and a cycle-safe deep freeze.
 * Pure predicates and pure operations only — no I/O, no dependency.
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

/**
 * Test whether a value is a plain data object: a non-array object whose
 * prototype is `Object.prototype` or `null`. Primitives, `null`, arrays, and
 * class instances are rejected.
 *
 * @param value The untrusted value to classify.
 * @returns Whether the value is a plain object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Test whether a caught error reports Node's ENOENT code: the target path does
 * not exist. Only real `Error` instances qualify, so every other failure —
 * including a non-error lookalike carrying `code` — surfaces to the caller.
 *
 * @param error The caught value from a filesystem call.
 * @returns Whether the error means absence.
 */
export function isENOENT(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Test whether a caught error reports Node's EEXIST code: an exclusive create
 * found an existing target. Only real `Error` instances qualify, so every
 * other failure surfaces to the caller.
 *
 * @param error The caught value from a filesystem call.
 * @returns Whether the error means the target already exists.
 */
export function isEEXIST(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/**
 * Deep-freeze a value in place with an iterative traversal, guarding cycles,
 * so later mutation throws without imposing a JavaScript call-stack depth cap.
 * {@link AbortSignal} objects are deliberately skipped because they are a
 * live cancellation channel and freezing one breaks abort.
 *
 * @param value The value to freeze in place.
 * @returns The same value, frozen.
 */
export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>()
  const pending: (
    | { kind: 'visit'; node: unknown }
    | { kind: 'property'; source: Record<string, unknown>; key: string }
  )[] = [{ kind: 'visit', node: value }]
  while (pending.length > 0) {
    const task = pending.pop()
    /* v8 ignore next -- the loop condition guarantees one pending task. */
    if (task === undefined) continue
    if (task.kind === 'property') {
      pending.push({ kind: 'visit', node: task.source[task.key] })
      continue
    }
    const node = task.node
    if (node === null || typeof node !== 'object') continue
    if (node instanceof AbortSignal) continue
    if (seen.has(node)) continue
    seen.add(node)
    Object.freeze(node)
    const keys = Object.keys(node)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      /* v8 ignore next -- the loop is bounded by the captured key count. */
      if (key === undefined) continue
      pending.push({ kind: 'property', source: node as Record<string, unknown>, key })
    }
  }
  return value
}
