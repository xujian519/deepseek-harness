/**
 * Patent tool error, ported from Sati's `SatiToolRuntimeError` (renamed per dsh
 * conventions). An Error subclass carrying a stable code so callers can route
 * failures without matching on prose. The code set mirrors the Sati tool protocol
 * so ported tools keep their failure taxonomy.
 * @module @deepseek-ai/dsh-patent-tools/error
 */

/** Stable error codes the patent tools raise, matching Sati's tool protocol. */
export type PatentToolErrorCode =
  | 'tool_not_found'
  | 'invalid_tool_input'
  | 'permission_denied'
  | 'permission_cancelled'
  | 'permission_required'
  | 'tool_execution_failed'
  | 'tool_aborted'
  | 'tool_timeout'
  | 'tool_output_schema_mismatch'
  | 'result_too_large'
  | 'path_not_allowed'
  | 'file_not_found'
  | 'file_not_observed'
  | 'file_stale_version'
  | 'file_conflict'
  | 'unsupported_tool'
  | 'model_cannot_accept_image'
  | 'setup_required'
  | 'plan_mode_violation'
  | 'ask_mode_violation'

/**
 * A patent tool failure. The message is stable, model-visible prose; the code is
 * the stable programmatic discriminator and `details` carries structured
 * context (tool name, patent number, error code from an upstream source, etc.).
 */
export class PatentToolError extends Error {
  readonly code: PatentToolErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: PatentToolErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'PatentToolError'
    this.code = code
    this.details = details
  }
}
