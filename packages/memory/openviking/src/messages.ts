/**
 * Shared session-content helpers for capture and recall.
 * @module @deepseek-ai/dsh-openviking/messages
 */

/**
 * Text of the string-text blocks of one message, joined by newlines.
 * @param content - Message content blocks; only `text` blocks with a string value contribute.
 * @returns The joined text of the block, or '' when no text block has a string value.
 */
export function textOf(content: readonly { type: string; text?: unknown }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}
