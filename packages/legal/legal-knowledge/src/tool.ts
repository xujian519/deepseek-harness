/**
 * Optional model-facing companion plugin for the `ctx.legalKnowledge` service.
 *
 * The service keeps owning no tool schema; a deployment that wants model access
 * mounts this subpath plugin beside the service, inside the same isolate realm.
 * @module @deepseek-ai/dsh-legal-knowledge/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { createLegalKnowledgeSearchTool } from './tool/search.ts'

/** Cordis plugin name. */
export const name = 'legal-knowledge-tool'

/** Services the tool requires before registration. */
export const inject = ['tools', 'legalKnowledge']

/**
 * Register `legal_knowledge_search` over the mounted legal-knowledge service.
 * @param ctx - registrant context carrying the tool registry and the service.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(createLegalKnowledgeSearchTool(ctx.legalKnowledge))
}
