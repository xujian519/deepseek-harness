/**
 * Shared MiniMax transport helpers: credential resolution, request headers,
 * JSON parsing, and failure classification. The video and speech providers use
 * the same credential reference and error vocabulary, so a key rotation or a
 * failure-code fix reaches both capabilities.
 * @module @deepseek-ai/dsh-experimental-video-mode/minimax-common
 */

import { MediaFailure } from './types.ts'

/** Minimal fetch surface both MiniMax providers need; tests inject a stub. */
export type MiniMaxFetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Settings subset that names a MiniMax credential. */
export interface MiniMaxCredentialSettings {
  /** Direct bearer API key; empty when the deployment names a credential ref instead. */
  readonly apiKey: string
  /** Credential reference resolved per request through `ctx.credentials`. */
  readonly apiKeyEnv?: string
}

/** Resolves one credential reference through the host service. */
export type MiniMaxKeyResolver = (ref: string) => Promise<string | undefined>

/**
 * Resolve the bearer key for one operation. A configured credential reference
 * is read again every time so a rotated key reaches the next call without a
 * process restart.
 * @param settings - provider settings carrying the direct key or reference.
 * @param resolveApiKey - credential resolver; omitted reads the process environment.
 * @returns the non-empty key.
 * @throws {@link MediaFailure} `MEDIA_PROVIDER_UNAVAILABLE` when the reference is unset.
 */
export async function resolveMiniMaxKey(
  settings: MiniMaxCredentialSettings,
  resolveApiKey?: MiniMaxKeyResolver,
): Promise<string> {
  const ref = settings.apiKeyEnv
  if (ref !== undefined) {
    const value = resolveApiKey === undefined
      ? process.env[ref]
      : await resolveApiKey(ref)
    if (value !== undefined && value.length > 0) return value
    throw new MediaFailure(
      `MiniMax credential ${ref} is not set; store it or export ${ref} before generating media`,
      'MEDIA_PROVIDER_UNAVAILABLE',
    )
  }
  if (settings.apiKey.length > 0) return settings.apiKey
  throw new MediaFailure(
    'MiniMax has no API key; set MINIMAX_API_KEY or configure minimax.apiKeyEnv',
    'MEDIA_PROVIDER_UNAVAILABLE',
  )
}

/**
 * Build authorization and content headers for one MiniMax call.
 * @param apiKey - resolved bearer key.
 * @returns the request headers.
 */
export function minimaxJsonHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  }
}

/**
 * Map an HTTP status to a stable media failure code.
 * @param status - HTTP status from a MiniMax endpoint.
 * @returns the failure code.
 */
export function failureCodeFor(status: number): 'MEDIA_REQUEST_INVALID' | 'MEDIA_BUDGET_EXCEEDED' | 'MEDIA_TASK_FAILED' {
  if (status === 400 || status === 422) return 'MEDIA_REQUEST_INVALID'
  if (status === 402) return 'MEDIA_BUDGET_EXCEEDED'
  return 'MEDIA_TASK_FAILED'
}

/**
 * Read the provider's error message from an OpenAI-style or legacy body.
 * @param text - response text.
 * @param fallback - message used when the body carries none.
 * @returns a human-readable rejection reason.
 */
export function rejectionMessage(text: string, fallback: string): string {
  const body = parseJson(text)
  if (isRecord(body)) {
    if (isRecord(body.error) && typeof body.error.message === 'string') return body.error.message
    if (isRecord(body.base_resp) && typeof body.base_resp.status_msg === 'string') return body.base_resp.status_msg
  }
  return text.trim().length === 0 ? fallback : text.trim()
}

/**
 * Parse JSON without throwing on a non-JSON body.
 * @param text - response text.
 * @returns the parsed value, or undefined when the body is not JSON.
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Narrow a parsed JSON value to an object.
 * @param value - parsed JSON value.
 * @returns whether the value is a non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read an error message from an unknown thrown value.
 * @param error - caught value.
 * @returns a diagnostic string.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
