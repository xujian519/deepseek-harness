// Fixture message content: the constructors and samples the live world and
// the static fx-alpha history script both read.

import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm/message'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {
  AssistantMessage,
  ContentBlock,
  MessageSource,
  TokenUsage,
  ToolResultMessage,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/**
 * Wrap one string as the single text block of a fixture message.
 * @param t - the literal text the block carries.
 * @returns the one-block content array.
 */
export function text(t: string): ContentBlock[] {
  return [{ type: 'text', text: t }]
}

/**
 * Build a fixture user message.
 * @param content - the message content blocks.
 * @param source - the message source; a plain user turn by default.
 * @returns the user message.
 */
export function userMessage(content: ContentBlock[], source: MessageSource = { kind: 'user' }): UserMessage {
  return createUserMessage({ content, source })
}

/**
 * Build a fixture assistant message attributed to the fixture provider.
 * @param content - the message content blocks.
 * @param model - the model id the fixture attributes the message to.
 * @returns the assistant message.
 */
export function assistantMessage(content: ContentBlock[], model = 'fx-1'): AssistantMessage {
  return createAssistantMessage({
    content,
    source: { provider: 'fixture', model },
  })
}

/**
 * Build a fixture tool result message.
 * @param callId - the tool call the result answers.
 * @param content - the result content blocks.
 * @param isError - whether the call failed.
 * @returns the tool result message.
 */
export function toolResultMessage(callId: string, content: ContentBlock[], isError: boolean): ToolResultMessage {
  return createToolResultMessage({ callId: brandString<ToolCallId>(callId), content, isError })
}

/** Markdown body of the history's last assistant turn, reused by the live world. */
export const MARKDOWN_FIXTURE = [
  '# Markdown fixture',
  '',
  'Assistant output renders **strong text**, *emphasis*, and `inline code`.',
  '',
  '- first item',
  '  - nested item',
  '',
  '| Area | State |',
  '| --- | --- |',
  '| history | rendered |',
  '| streaming | stable |',
  '',
  '[DeepSeek](https://www.deepseek.com)',
  '',
  '```ts',
  'const markdown = true',
  '```',
].join('\n')

/** Base64 PNG behind `FIXTURE_IMAGE_REF`. */
export const FIXTURE_IMAGE_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAYAAAA/xl1SAAAAvklEQVR42u3SMQ0AAAjAMIyhELM4AAe8PD1qYFlk9cCXEAEDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGBANiQDAgBgQDYkAwIAYEA2JAMCAGxIBCYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIBgQAwIBsSAYEAMCAbEgGBADAgGxIAYEAyIAcGAGBAMiAHBgBgQDIgBwYAYEAyIAcGAGBAMiAHBgBgQDIgB4bYWLb6pnOb1xAAAAABJRU5ErkJggg=='

/** Durable attachment ref shared by the history and live world image turns. */
export const FIXTURE_IMAGE_REF: ImageAttachmentRef = {
  attachmentId: 'fixture:image' as AttachmentIdType,
  mediaType: 'image/png',
  bytes: 247,
  width: 160,
  height: 90,
  name: 'fixture-image.png',
}

/**
 * Deterministic provider billing attached to fixture assistant messages.
 * @param turn - the turn the message belongs to.
 * @param step - the step within that turn.
 * @returns the usage the fixture attributes to the message.
 */
export function fixtureUsage(turn: number, step: number): TokenUsage {
  return {
    inputTokens: 20 + turn % 5,
    outputTokens: 8 + step,
    cacheReadTokens: turn === 0 ? 0 : 80,
    cacheWriteTokens: turn % 10 === 0 ? 4 : 0,
  }
}

/**
 * Build a lossless settled stream for static fixture messages.
 * @param message - the assistant message the stream replays.
 * @param usage - the usage chunk appended before the finish chunk.
 * @param time - the timestamp every chunk carries.
 * @returns the settled stream records.
 */
export function fixtureSettledStream(
  message: AssistantMessage,
  usage: TokenUsage,
  time: number,
): AssistantStreamRecord[] {
  const stream: AssistantStreamRecord[] = []
  for (const [index, block] of message.content.entries()) {
    stream.push(
      { type: 'chunk', time, chunk: { type: 'block-start', index, blockType: block.type } },
      { type: 'chunk', time, chunk: { type: 'block-end', index, block } },
    )
  }
  stream.push(
    { type: 'chunk', time, chunk: { type: 'usage', usage } },
    { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  )
  return stream
}
