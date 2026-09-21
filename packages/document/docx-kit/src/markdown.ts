/**
 * Markdown block and inline parsing for the writer, ported from
 * `domains/doctmpl/renderer_docx.go` of the Go project Mady.
 *
 * Accepted syntax: `#`-prefixed headings up to level 6, plain paragraphs,
 * `-` or `*` list items, pipe tables, and inline `**bold**` and `` `code` ``
 * spans. Anything else stays paragraph text instead of failing.
 */

import { HEADING_MARKER, headingLevelOf, type DocxBlock, type DocxInlineRun, type DocxTableRow, type HeadingLevel } from './types.ts'

/** Marker opening and closing a bold span. */
const BOLD_MARKER = '**'

/** Marker opening and closing a code span. */
const CODE_MARKER = '`'

/** Markers that end a plain run, in the order the upstream scanner tests them. */
const INLINE_MARKERS = [BOLD_MARKER, CODE_MARKER] as const

/**
 * Find where the next inline marker starts.
 * @param text - the line being scanned.
 * @param cursor - the position the run starts at.
 * @returns the earliest marker position, or the position after `cursor` when the cursor itself is one.
 */
function nextMarkerOffset(text: string, cursor: number): number {
  let next = text.length
  for (const marker of INLINE_MARKERS) {
    const found = text.indexOf(marker, cursor)
    if (found >= 0 && found < next) next = found
  }
  return next <= cursor ? cursor + 1 : next
}

/**
 * Split one line into its decorated spans.
 * An unpaired marker stays literal text; a paired marker with no text between
 * its markers yields an empty run, which the renderer drops.
 * @param text - one line of block text.
 * @returns the spans in line order.
 */
export function parseInline(text: string): readonly DocxInlineRun[] {
  const runs: DocxInlineRun[] = []
  let cursor = 0
  while (cursor < text.length) {
    if (text.startsWith(BOLD_MARKER, cursor)) {
      const end = text.indexOf(BOLD_MARKER, cursor + BOLD_MARKER.length)
      if (end >= 0) {
        runs.push({ text: text.slice(cursor + BOLD_MARKER.length, end), bold: true, code: false })
        cursor = end + BOLD_MARKER.length
        continue
      }
    }
    if (text.startsWith(CODE_MARKER, cursor)) {
      const end = text.indexOf(CODE_MARKER, cursor + CODE_MARKER.length)
      if (end >= 0) {
        runs.push({ text: text.slice(cursor + CODE_MARKER.length, end), bold: false, code: true })
        cursor = end + CODE_MARKER.length
        continue
      }
    }
    const next = nextMarkerOffset(text, cursor)
    runs.push({ text: text.slice(cursor, next), bold: false, code: false })
    cursor = next
  }
  return runs
}

/**
 * Read a heading line.
 * @param line - trimmed line.
 * @returns the level and text, or `undefined` when the line is not a heading of level 1 through 6.
 */
function parseHeading(line: string): { readonly level: HeadingLevel; readonly text: string } | undefined {
  if (!line.startsWith(HEADING_MARKER)) return undefined
  let hashes = 0
  while (hashes < line.length && line.charAt(hashes) === HEADING_MARKER) hashes += 1
  const rest = line.slice(hashes)
  if (!rest.startsWith(' ')) return undefined
  const level = headingLevelOf(hashes)
  return level === undefined ? undefined : { level, text: rest.trim() }
}

/**
 * Whether a line opens a list item.
 * @param line - trimmed line.
 * @returns whether the line starts with the `- ` or `* ` marker.
 */
function isListItem(line: string): boolean {
  return line.startsWith('- ') || line.startsWith('* ')
}

/**
 * Whether a table line is its separator row.
 * Only lines starting with `|` reach this predicate, so the upstream pipe test is implied.
 * @param line - trimmed table line.
 * @returns whether the line holds only hyphens, pipes, and spaces, and at least one hyphen.
 */
function isTableSeparator(line: string): boolean {
  if (!line.includes('-')) return false
  return line.replaceAll(' ', '').replaceAll('-', '').replaceAll('|', '') === ''
}

/**
 * Split one table line into its cells.
 * @param line - trimmed table line.
 * @returns the trimmed cell texts between the outer pipes.
 */
function parseTableRow(line: string): DocxTableRow {
  const inner = line.replace(/^\|/u, '').replace(/\|$/u, '')
  return inner.split('|').map(cell => parseInline(cell.trim()))
}

/**
 * Parse Markdown into the block model the writer renders.
 * A line ending opens a new block only as the upstream renderer did: consecutive
 * plain lines join into one paragraph, a separator row inside a table run is
 * dropped, and an empty table contributes no block.
 * @param markdown - the Markdown source.
 * @returns the blocks in source order.
 */
export function parseMarkdown(markdown: string): readonly DocxBlock[] {
  const blocks: DocxBlock[] = []
  let paragraph: string[] = []
  let table: DocxTableRow[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', runs: parseInline(paragraph.join(' ')) })
    paragraph = []
  }

  const flushTable = (): void => {
    if (table.length === 0) return
    blocks.push({ kind: 'table', rows: table })
    table = []
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r+$/u, '').trim()
    if (line.startsWith('|')) {
      flushParagraph()
      if (!isTableSeparator(line)) table.push(parseTableRow(line))
      continue
    }
    flushTable()
    const heading = parseHeading(line)
    if (heading !== undefined) {
      flushParagraph()
      blocks.push({ kind: 'heading', level: heading.level, text: heading.text })
      continue
    }
    if (isListItem(line)) {
      flushParagraph()
      blocks.push({ kind: 'listItem', runs: parseInline(line.slice(2).trim()) })
      continue
    }
    if (line === '') {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }
  flushTable()
  flushParagraph()
  return blocks
}
