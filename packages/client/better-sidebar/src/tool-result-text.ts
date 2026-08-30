/**
 * The shared tool/result text extractor: the plain text of a finalized tool
 * result — the text blocks inside the `tool-result` content blocks of a
 * message's `content`, in order. Shared by the Side Chat transcript, the
 * Side Chat inheritance snapshot, and the jobs.output replay (each site
 * maps the empty case onto its own wire convention).
 */

/**
 * Collect the text blocks inside one message content's `tool-result` blocks.
 * @param content - the raw `content` field of a `tool/result` message (or any message).
 * @returns the inner text blocks, in order (empty when the content carries no tool-result text).
 */
export function toolResultTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; content?: unknown }
    if (candidate.type !== 'tool-result') continue
    const inner = candidate.content
    if (!Array.isArray(inner)) continue
    for (const item of inner) {
      if (item === null || typeof item !== 'object') continue
      const textItem = item as { type?: unknown; text?: unknown }
      if (textItem.type === 'text' && typeof textItem.text === 'string') {
        parts.push(textItem.text)
      }
    }
  }
  return parts
}
