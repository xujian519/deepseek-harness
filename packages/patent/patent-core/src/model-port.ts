/**
 * ModelPort adapter (P2.1): maps the dsh LLM streaming vocabulary
 * (LlmRuntime.stream(options: GenerateOptions): AsyncIterable<StreamChunk>)
 * into the patent-domain canonical form (PatentModelRequest/PatentModelEvent).
 * Provider selection stays with the harness ctx.llm adapters and the
 * agent/request waterfall (the Sati router is not ported).
 *
 * @module @deepseek-ai/dsh-patent-core/model-port
 */

import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PatentModelEvent, PatentModelMessage, PatentModelPort, PatentModelRequest } from './types.ts'

/** Fixed route and optional call controls the adapter fills into each request. */
export interface CreateLlmModelPortOptions {
  /** Registered provider route selecting the adapter instance. */
  provider: string
  /** Provider model id. */
  model: string
  /** Optional default temperature; omitted leaves the provider default. */
  temperature?: number
  /** Optional output token cap; omitted leaves the provider default. */
  maxTokens?: number
}

/**
 * Build a PatentModelPort from a dsh LLM stream function (typically
 * ctx.llm.stream bound to ctx.llm, or a partially applied waterfall).
 * @param stream - the harness streaming call to adapt.
 * @param options - fixed provider/model route and optional call controls.
 * @returns the patent-domain port whose stream maps canonical messages to chunks.
 */
export function createLlmModelPort(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  options: CreateLlmModelPortOptions,
): PatentModelPort {
  return {
    stream(request: PatentModelRequest, signal?: AbortSignal): AsyncIterable<PatentModelEvent> {
      const { messages, system } = translateRequest(request, options)
      // 逐调用 temperature 覆盖端口固定默认（extract 等原子按调用传 0）。
      const temperature = request.temperature ?? options.temperature
      const generate: GenerateOptions = {
        provider: options.provider,
        model: options.model,
        messages,
        ...(system === undefined ? {} : { system }),
        ...(temperature === undefined ? {} : { temperature }),
        ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
        ...(signal === undefined ? {} : { signal }),
      }
      return mapChunks(stream(generate))
    },
  }
}

/**
 * Translate patent-domain canonical messages into the dsh Message list plus a
 * system slot. System-role messages collapse into GenerateOptions.system; user
 * and assistant messages become identified dsh messages.
 */
function translateRequest(
  request: PatentModelRequest,
  options: CreateLlmModelPortOptions,
): { messages: Message[]; system?: string } {
  const messages: Message[] = []
  const systemParts: string[] = []
  for (const message of request.messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    messages.push(toDshMessage(message, options))
  }
  const system = systemParts.length > 0 ? systemParts.join('\n') : undefined
  return { messages, ...(system === undefined ? {} : { system }) }
}

/** One canonical message → one dsh message. */
function toDshMessage(message: PatentModelMessage, options: CreateLlmModelPortOptions): Message {
  const content = [{ type: 'text' as const, text: message.content }]
  if (message.role === 'assistant') {
    return createAssistantMessage({ content, source: { provider: options.provider, model: options.model } })
  }
  return createUserMessage({ content, source: { kind: 'user' } })
}

/** Terminal usage carried to the canonical done event. */
function buildUsage(inputTokens: number | undefined, outputTokens: number | undefined) {
  return inputTokens === undefined && outputTokens === undefined
    ? undefined
    : {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    }
}

/**
 * Map a dsh chunk stream to canonical events. Visible text deltas become delta
 * events; a terminal finish becomes the done event (an error or aborted finish
 * is rethrown so the atoms' callLlm catch degrades the stage). Reasoning, tool,
 * and block bookkeeping chunks are not part of the canonical text-only form.
 */
async function* mapChunks(chunks: AsyncIterable<StreamChunk>): AsyncGenerator<PatentModelEvent> {
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  const doneEvent = (): PatentModelEvent => {
    const usage = buildUsage(inputTokens, outputTokens)
    return { type: 'done', ...(usage === undefined ? {} : { usage }) }
  }
  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-delta':
        yield { type: 'delta', text: chunk.text }
        break
      case 'usage':
        inputTokens = chunk.usage.inputTokens
        outputTokens = chunk.usage.outputTokens
        break
      case 'finish': {
        const reason = chunk.reason
        if (reason.kind === 'error' || reason.kind === 'aborted') {
          // 保留 failure.code：callLlm 依赖 code==='setup_required' 的 fail-loud
          // 特判，取消/配置类终态在 mapChunks 丢 code 会被误降级。
          const error = new Error(reason.failure.message) as Error & { code?: string }
          if (reason.failure.code !== undefined) error.code = reason.failure.code
          throw error
        }
        yield doneEvent()
        return
      }
      default:
        // reasoning-delta / tool-call-delta / block-start / block-end are not
        // visible text and carry no canonical event.
        break
    }
  }
  // A well-formed adapter stream ends with a finish chunk; emit done defensively
  // if the stream ended without one.
  yield doneEvent()
}

/**
 * Collect a port stream into one string: sends the prompt as a single user
 * message and concatenates the visible text deltas. Used by the atoms
 * builtin/llm.ts bridge when a StageProvider carries a port instead of callLLM.
 * @param port - the patent-domain port to consume.
 * @param prompt - the user prompt text.
 * @param signal - optional cancellation.
 * @param options - optional per-call temperature and advisory schema.
 * @returns the concatenated visible text.
 */
export async function collectPortText(
  port: PatentModelPort,
  prompt: string,
  signal?: AbortSignal,
  options: { temperature?: number; schema?: unknown } = {},
): Promise<string> {
  let text = ''
  for await (const event of port.stream({
    messages: [{ role: 'user', content: prompt }],
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.schema === undefined ? {} : { schema: options.schema }),
  }, signal)) {
    if (event.type === 'delta') text += event.text
  }
  return text
}
