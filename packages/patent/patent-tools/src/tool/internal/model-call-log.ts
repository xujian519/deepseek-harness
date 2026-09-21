/**
 * Session-log binding for the patent tools' model ports.
 *
 * A model call a patent tool makes inside its body has no `request/*` or
 * `assistant/*` event of its own, so the tool binds its injected port to the
 * calling agent's session before use: every call then appends one
 * `patent/model-call` event (owner: `@deepseek-ai/dsh-patent-workflow`). The
 * arguments are the model-visible request side and are already logged as the
 * tool call; this event carries the output side.
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/model-call-log
 */

import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import { loggedPatentModel } from '@deepseek-ai/dsh-patent-workflow'
import type { PatentModelCallContext } from '@deepseek-ai/dsh-patent-workflow'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/**
 * Bind one tool's injected model port to the calling agent's session.
 * @param exec - the tool-call execution whose agent owns the session.
 * @param port - the injected model port (absent when the composition supplied none).
 * @param context - static labels recorded on every call the port serves.
 * @returns the logging port, or `undefined` when the tool has no port.
 */
export function loggedToolModel(
  exec: Pick<ToolRunContext, 'agent'>,
  port: PatentModelPort | undefined,
  context: PatentModelCallContext,
): PatentModelPort | undefined {
  return port === undefined ? undefined : loggedPatentModel(port, exec.agent, context)
}
