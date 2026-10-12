/**
 * Deterministic two-step adapter for the patent-rule Loader fixture: call the
 * probe tool once, then answer, so the warn context must arrive before the answer.
 * @module patent-rule-warn-mock-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

class WarnProbeMockAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.messages.some(message => message.role === 'tool')) {
      const text = 'probe answered'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    } else {
      const id = ToolCallId('patent-warn-probe-1')
      const args = '{}'
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'patent_warn_probe', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'patent_warn_probe', arguments: args } }
    }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'patent-rule-warn-mock-llm'
export const inject = ['llm']

/** Register the test-only `patent-rule-warn-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['patent-rule-warn-mock'], new WarnProbeMockAdapter())
}
