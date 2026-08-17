/**
 * Literature tool error, ported from Sati's `SatiToolRuntimeError` (renamed per dsh
 * conventions). An Error subclass carrying a stable code so callers can route failures
 * without matching on prose.
 * @module @deepseek-ai/dsh-tool-literature/error
 */

/** Stable error codes the literature tools raise. */
export type LiteratureToolErrorCode =
  | 'invalid_tool_input'
  | 'tool_execution_failed'

/**
 * A literature tool failure. The message is stable, model-visible prose; the code is the
 * stable programmatic discriminator.
 */
export class LiteratureToolError extends Error {
  readonly code: LiteratureToolErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: LiteratureToolErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'LiteratureToolError'
    this.code = code
    this.details = details
  }
}
