/**
 * The document-deliver plugin: one model-facing `document_deliver` tool that
 * records the document agent's delivered files, formats, and quality-gate
 * state. The tool registers into `ctx.tools`; the tool call is the session
 * log's only write path — no host RPC, no durable file outside the log.
 * @module @deepseek-ai/dsh-document-deliver
 */

import type { Context } from '@deepseek-ai/cordis'
import { createDocumentDeliverTool } from './tool.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-deliver'

/** Services required to register the tool and resolve deliverable files. */
export const inject = ['tools', 'fs']

/**
 * Register the `document_deliver` tool.
 * @param ctx - plugin context carrying the tools registry and the fs service.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(createDocumentDeliverTool(ctx))
}
