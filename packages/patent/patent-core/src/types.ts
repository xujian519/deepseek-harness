/**
 * Patent-domain model port: the canonical LLM-call vocabulary the patent engines
 * use, plus the StageProvider the workflow atoms consume. The dsh-llm adapter
 * mapping (createLlmModelPort) lives in ./model-port.ts.
 * @module @deepseek-ai/dsh-patent-core/types
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/** One canonical model request the patent engines issue. */
export interface PatentModelRequest {
  /** The message list to send, in patent-domain canonical form. */
  messages: PatentModelMessage[]
  /**
   * Per-call temperature override; the port maps it into the harness
   * GenerateOptions. Absent leaves the route's default (or the port's fixed
   * option) in force.
   */
  temperature?: number
  /**
   * Requested JSON-schema shape for the model output. The harness LLM
   * vocabulary has no structured-output wire field today, so ports treat it
   * as advisory: enforcement is prompt-level and post-parse validation by the
   * consuming atom. Declared so a port can detect and surface the limitation
   * instead of silently claiming wire enforcement.
   */
  schema?: unknown
}

/** One patent-domain canonical message. */
export interface PatentModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /**
   * Durable image references sent with the message; only user messages carry
   * images. The refs point into the harness attachment store, so the port
   * maps them straight into image content blocks and the provider path
   * (normalization, per-route policy, upload/encode) stays the session one.
   */
  images?: readonly ImageAttachmentRef[]
}

/** One streamed canonical model event. */
export type PatentModelEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } }

/**
 * The patent-domain LLM port: an async iterable of canonical events for one request.
 * Implementations adapt the harness LlmRuntime.stream vocabulary (P2.1).
 */
export interface PatentModelPort {
  stream(request: PatentModelRequest, signal?: AbortSignal): AsyncIterable<PatentModelEvent>
}

/** One search hit the workflow atoms' search stage consumes. */
export interface StageSearchHit {
  /** Hit title (falls back to the patent number when the source omits one). */
  title: string
  /** Abstract snippet, when the source returns one. */
  snippet?: string
  /** Detail-page URL, when the source returns one. */
  url?: string
}

/**
 * The stage external-capability injection point the workflow host provides.
 * Builtin handlers degrade (return _error) rather than throw when a required
 * capability is missing, so a run stays batch-safe.
 */
export interface StageProvider {
  /** Case context id (may contain a {caseId} placeholder). */
  caseId?: string
  /**
   * String-based LLM call. When provided it takes precedence over the streaming
   * port (test injection and the simple string seam). The optional signal
   * propagates cancellation to the underlying call when the seam honors it.
   */
  callLLM?: (
    prompt: string,
    opts?: { jsonSchema?: unknown; temperature?: number },
    signal?: AbortSignal,
  ) => Promise<string>
  /**
   * Streaming patent-domain model port. The atoms builtin/llm.ts bridges this
   * into the string call used by the LLM-dependent handlers when callLLM is absent.
   */
  llm?: PatentModelPort
  /**
   * Search one query and map source hits to the stage-hit vocabulary.
   * @param query - the patent query (keyword or boolean expression).
   * @param opts - optional stage options; currently only the hit cap.
   * @returns the mapped hits in source order.
   */
  search?: (query: string, opts?: { maxResults?: number }) => Promise<StageSearchHit[]>
}
