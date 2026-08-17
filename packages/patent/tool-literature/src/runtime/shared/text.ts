/**
 * Academic literature metadata text helpers, ported from the Sati literature layer.
 *
 * Covers the routine text needs of academic APIs: XML/HTML entity decoding, JATS tag
 * stripping, abstract snippet truncation, and OpenAlex inverted-abstract rebuild. All
 * defensive: malformed input returns `undefined` / empty arrays rather than throwing.
 * @module @deepseek-ai/dsh-tool-literature/runtime/shared/text
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** Decode the few XML/HTML entities that appear in academic metadata (incl. numeric/hex refs). */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&[a-zA-Z]+;/g, m => ENTITIES[m] ?? m)
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Strip XML/HTML tags (e.g. JATS `<jats:p>` abstracts) and collapse whitespace. */
export function stripTags(input?: string): string | undefined {
  if (!input) return undefined
  const text = decodeEntities(input.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return text.length ? text : undefined
}

/** Truncate to a readable length without hard-splitting words. */
export function snippet(input?: string, max = 600): string | undefined {
  const text = stripTags(input)
  if (!text) return undefined
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…'
}

/** Pass through a source API record verbatim as an opaque `extra` payload. */
export function raw(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

/** Rebuild plain-text abstract from OpenAlex's `abstract_inverted_index` (word → positions). */
export function fromInverted(index?: Record<string, number[]> | null): string | undefined {
  if (!index) return undefined
  const words: string[] = []
  for (const word of Object.keys(index)) {
    for (const pos of index[word] ?? []) {
      if (Number.isInteger(pos) && pos >= 0) words[pos] = word
    }
  }
  const text = words
    .filter(w => w !== undefined)
    .join(' ')
    .trim()
  return text.length ? text : undefined
}
