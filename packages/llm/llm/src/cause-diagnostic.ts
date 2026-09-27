/**
 * Cause-chain diagnostics for failures whose public code is too coarse to act on.
 * @module @deepseek-ai/dsh-llm/cause-diagnostic
 */

/** Longest diagnostic retained, in characters. */
const MAX_DIAGNOSTIC_LENGTH = 200

/** Deepest cause link examined, bounding a cyclic or pathologically nested chain. */
const MAX_CAUSE_DEPTH = 8

/**
 * Summarize the first coded platform error reachable through `value`'s cause chain.
 *
 * A `TRANSPORT` failure built around a wire error names neither the socket error
 * behind it nor whether DNS, TLS, or the peer ended the connection. Only a
 * string `code` set on a cause's own data property qualifies: that code is the
 * platform's own stable token (`ECONNRESET`, `UND_ERR_SOCKET`). A link carrying
 * none is skipped, which drops a harness wrapper's restated message along with
 * any error whose code lives on its prototype or behind a getter.
 *
 * @param value - thrown value wrapped as an LLM failure's cause.
 * @returns `"CODE: message"` collapsed to one bounded line, or undefined when the
 *   chain holds no coded cause.
 */
export function causeDiagnostic(value: unknown): string | undefined {
  let current: unknown = value
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null; depth += 1) {
    const diagnostic = codedCause(current)
    if (diagnostic !== undefined) return diagnostic
    current = ownValue(current, 'cause')
  }
  return undefined
}

/** Render one coded error, or undefined when this link carries no usable code. */
function codedCause(error: object): string | undefined {
  const code = ownValue(error, 'code')
  if (typeof code !== 'string' || code.length === 0) return undefined
  const message = ownValue(error, 'message')
  const text = typeof message === 'string' ? message.replace(/\s+/gu, ' ').trim() : ''
  return bounded(text.length === 0 ? code : `${code}: ${text}`)
}

/** Read one own data property, treating an accessor or hostile reflection as absent. */
function ownValue(target: object, property: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(target, property)
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  } catch (_hostileCauseReflection) {
    return undefined
  }
}

/** Keep a diagnostic to one line of bounded length. */
function bounded(text: string): string {
  return text.length <= MAX_DIAGNOSTIC_LENGTH ? text : `${text.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`
}
