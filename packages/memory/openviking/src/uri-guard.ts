/**
 * `viking://` URI guard: block filesystem and shell tools from treating
 * OpenViking URIs as local paths, pointing the model at the OpenViking tool
 * surface instead.
 * @module @deepseek-ai/dsh-openviking/uri-guard
 */

import type { ToolExecutionInput, PreToolDecision } from '@deepseek-ai/dsh-tools'

/** Tools whose arguments must never carry a `viking://` URI as a local path. */
const LOCAL_PATH_TOOLS = new Set(['read', 'write', 'edit', 'ls', 'glob', 'grep', 'stat', 'tree', 'bash', 'fleet'])

/** Whether any argument value mentions a viking URI.
 * @param value - arbitrary tool argument to scan.
 * @returns true when any string nested in the value contains `viking://`.
 */
export function mentionsVikingUri(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('viking://')
  if (Array.isArray(value)) return value.some(mentionsVikingUri)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(mentionsVikingUri)
  }
  return false
}

/**
 * The pre-execute guard: deny local path tools whose arguments mention
 * `viking://`, with a hint pointing at the OpenViking tools.
 * @param exec - the pending tool execution.
 * @returns the pre-execute decision (allow or deny with a viking guidance hint).
 */
export function guardVikingUri(exec: ToolExecutionInput): PreToolDecision {
  if (!LOCAL_PATH_TOOLS.has(exec.name) || !mentionsVikingUri(exec.arguments)) return { kind: 'allow' }
  return {
    kind: 'deny',
    reason: 'viking:// URIs live in the OpenViking context database, not the local filesystem. Use the OpenViking tools (mcp__openviking__search/read/list, memcommit, memlearn) instead.',
  }
}
