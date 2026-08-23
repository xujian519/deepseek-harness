/**
 * Shared session-content helpers for capture and recall.
 * @module @deepseek-ai/dsh-openviking/messages
 */

/** Text of the non-empty text blocks of a message. */
export function textOf(content: readonly { type: string; text?: unknown }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}
