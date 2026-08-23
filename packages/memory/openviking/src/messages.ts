/**
 * Shared session-content helpers for capture and recall.
 * @module @deepseek-ai/dsh-openviking/messages
 */

/**
 * Text of the non-empty text blocks of a message.
 * @param content - Content blocks of the message.
 * @returns Newline-joined text of the string-typed text blocks.
 */
export function textOf(content: readonly { type: string; text?: unknown }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}
