/**
 * The shared tool/result text extractor: the plain text of a finalized tool
 * result — the text blocks of its message content, in order. Shared by the
 * Side Chat transcript, the Side Chat inheritance snapshot, the jobs.output
 * replay, and the subagent activity fold (each site maps the empty case onto
 * its own wire convention).
 */

/**
 * Collect the text blocks of one message content array.
 * @param content - the raw `content` field of a `tool/result` message (or any message).
 * @returns the text blocks, in order (empty when the content carries no text block).
 */
export function toolResultTextBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      parts.push(candidate.text)
    }
  }
  return parts
}
