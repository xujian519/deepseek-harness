/**
 * DOCX to text projection, ported from `knowledge/fileindex/reader_docx.go` of
 * the Go project Mady, which read `word/document.xml` through `encoding/xml`
 * and added the header and footer parts.
 *
 * Projection rules:
 * - The body projects in document order; a `w:p` outside a table becomes one
 *   line, and a `w:tbl` becomes one line per `w:tr`.
 * - A line's text is the concatenation of the `w:t` elements under it, trimmed;
 *   a paragraph with no text projects nothing.
 * - A heading is a paragraph whose `w:pStyle` names level `HeadingN` or the
 *   localized numeric form, or, when no style names a level, whose inline
 *   `w:outlineLvl` is N-1. Its line is prefixed with `#` repeated per level.
 * - A table row is its cells joined by ` | ` between outer pipes; a cell is its
 *   paragraphs joined by a space, so a nested table contributes text without
 *   row separators.
 * - Header and footer parts project in archive order, each block introduced by
 *   its label line.
 * - Lines are joined by a blank line, and `sections` lists them individually.
 */

import {
  DOCUMENT_PART,
  FOOTER_PART_LABEL,
  FOOTER_PART_PREFIX,
  HEADER_PART_LABEL,
  HEADER_PART_PREFIX,
  HEADING_MARKER,
  headingLevelOf,
  TABLE_CELL_SEPARATOR,
  XML_PART_SUFFIX,
  type DocxProblem,
  type DocxSection,
  type DocxTextResult,
  type HeadingLevel,
  type ZipEntry,
} from './types.ts'
import { buildXmlTree, scanXml, type XmlNode } from './xml.ts'
import { readZip } from './zip.ts'

/** Decoder of the part texts, which OOXML fixes as UTF-8. */
const PART_DECODER = new TextDecoder()

/** Style identifiers Word writes for built-in headings, English or localized numeric. */
const HEADING_STYLE = /^(?:heading\s*)?([1-9])$/iu

/** Attribute holding a style identifier or an outline level. */
const VALUE_ATTRIBUTE = 'w:val'

/** Paragraph properties element. */
const PARAGRAPH_PROPERTIES = 'w:pPr'

/** Paragraph style element. */
const PARAGRAPH_STYLE = 'w:pStyle'

/** Outline level element, counting from zero. */
const OUTLINE_LEVEL = 'w:outlineLvl'

/** Paragraph element. */
const PARAGRAPH = 'w:p'

/** Table element. */
const TABLE = 'w:tbl'

/** Table row element. */
const ROW = 'w:tr'

/** Table cell element. */
const CELL = 'w:tc'

/** Run text element. */
const TEXT = 'w:t'

/**
 * Read the children of one element that carry a given name.
 * @param node - the element to read.
 * @param name - the child element name.
 * @returns the matching children in document order.
 */
function childrenNamed(node: XmlNode, name: string): readonly XmlNode[] {
  return node.children.filter(child => child.name === name)
}

/**
 * Read the text of every `w:t` element at or under one element.
 * @param node - the element to read.
 * @returns the concatenated text in document order.
 */
function elementsText(node: XmlNode): string {
  let text = ''
  for (const child of node.children) {
    if (child.name === TEXT) {
      text += child.text
      continue
    }
    text += elementsText(child)
  }
  return text
}

/**
 * Read the heading level a paragraph style names.
 * @param value - the style identifier.
 * @returns the named level, or `undefined` when the style is not a heading style.
 */
function styleHeadingLevel(value: string | undefined): HeadingLevel | undefined {
  if (value === undefined) return undefined
  const matched = HEADING_STYLE.exec(value)
  return matched === null ? undefined : headingLevelOf(Number(matched[1]))
}

/**
 * Read the heading level a paragraph outline level names.
 * @param value - the outline level, counting from zero.
 * @returns the level, or `undefined` when the value names none.
 */
function outlineHeadingLevel(value: string | undefined): HeadingLevel | undefined {
  if (value === undefined) return undefined
  return headingLevelOf(Number(value) + 1)
}

/**
 * Read the heading level one paragraph declares, preferring its style over its outline level.
 * @param paragraph - the `w:p` element.
 * @returns the declared level, or `undefined` for a body paragraph.
 */
function paragraphHeadingLevel(paragraph: XmlNode): HeadingLevel | undefined {
  const properties = childrenNamed(paragraph, PARAGRAPH_PROPERTIES)[0]
  if (properties === undefined) return undefined
  const style = childrenNamed(properties, PARAGRAPH_STYLE)[0]
  const styled = style === undefined ? undefined : styleHeadingLevel(style.attributes.get(VALUE_ATTRIBUTE))
  if (styled !== undefined) return styled
  const outline = childrenNamed(properties, OUTLINE_LEVEL)[0]
  return outline === undefined ? undefined : outlineHeadingLevel(outline.attributes.get(VALUE_ATTRIBUTE))
}

/**
 * Collect the trimmed text of every paragraph at or under one element.
 * @param node - the element to read.
 * @param texts - collected paragraph texts, appended in document order.
 */
function collectParagraphTexts(node: XmlNode, texts: string[]): void {
  for (const child of node.children) {
    if (child.name === PARAGRAPH) {
      texts.push(elementsText(child).trim())
      continue
    }
    collectParagraphTexts(child, texts)
  }
}

/**
 * Read one table cell as a single line of text.
 * @param cell - the `w:tc` element.
 * @returns the cell's paragraph texts joined by a space.
 */
function cellText(cell: XmlNode): string {
  const texts: string[] = []
  collectParagraphTexts(cell, texts)
  return texts.filter(text => text !== '').join(' ')
}

/**
 * Append one line for a paragraph, dropping it when it holds no text.
 * @param paragraph - the `w:p` element.
 * @param lines - projected lines, appended in document order.
 */
function pushParagraph(paragraph: XmlNode, lines: DocxSection[]): void {
  const text = elementsText(paragraph).trim()
  if (text === '') return
  const level = paragraphHeadingLevel(paragraph)
  lines.push({
    text: level === undefined ? text : `${HEADING_MARKER.repeat(level)} ${text}`,
    headingLevel: level,
  })
}

/**
 * Append one line per table row, dropping rows that hold no cell.
 * @param table - the `w:tbl` element.
 * @param lines - projected lines, appended in document order.
 */
function pushTable(table: XmlNode, lines: DocxSection[]): void {
  for (const row of childrenNamed(table, ROW)) {
    const cells = childrenNamed(row, CELL).map(cellText)
    if (cells.length === 0) continue
    lines.push({ text: `| ${cells.join(TABLE_CELL_SEPARATOR)} |`, headingLevel: undefined })
  }
}

/**
 * Project the paragraphs and tables of one element.
 * @param node - the element to walk.
 * @param lines - projected lines, appended in document order.
 */
function collectLines(node: XmlNode, lines: DocxSection[]): void {
  for (const child of node.children) {
    if (child.name === PARAGRAPH) {
      pushParagraph(child, lines)
      continue
    }
    if (child.name === TABLE) {
      pushTable(child, lines)
      continue
    }
    collectLines(child, lines)
  }
}

/** One projected part, with the failure that stopped it when unreadable. */
interface ProjectedPart {
  /** Projected lines; empty when the part did not parse. */
  readonly lines: readonly DocxSection[]
  /** The failure to report, or `undefined` when the part parsed. */
  readonly problem: DocxProblem | undefined
}

/**
 * Project one XML part.
 * @param name - the part name, for diagnostics.
 * @param data - the part bytes.
 * @returns the part's lines and any failure; a part that is not well-formed XML projects no lines.
 */
function projectPart(name: string, data: Uint8Array): ProjectedPart {
  const scan = scanXml(PART_DECODER.decode(data))
  if (!scan.wellFormed) {
    return { lines: [], problem: { code: 'malformed-xml', part: name, detail: 'the part is not well-formed XML' } }
  }
  const lines: DocxSection[] = []
  collectLines(buildXmlTree(scan.tokens), lines)
  return { lines, problem: undefined }
}

/**
 * Project one part and record its failure.
 * @param name - the part name.
 * @param data - the part bytes.
 * @param problems - problem list to append to.
 * @returns the part's lines.
 */
function projectedLines(name: string, data: Uint8Array, problems: DocxProblem[]): readonly DocxSection[] {
  const projected = projectPart(name, data)
  if (projected.problem !== undefined) problems.push(projected.problem)
  return projected.lines
}

/**
 * Project every header or footer part of an archive.
 * @param entries - the archive entries.
 * @param prefix - part-name prefix selecting the group.
 * @param problems - problem list to append to.
 * @returns the group's lines, in archive order.
 */
function groupedLines(entries: readonly ZipEntry[], prefix: string, problems: DocxProblem[]): readonly DocxSection[] {
  return entries
    .filter(entry => entry.name.startsWith(prefix) && entry.name.endsWith(XML_PART_SUFFIX))
    .flatMap(entry => projectedLines(entry.name, entry.data, problems))
}

/**
 * Project a DOCX package into text.
 * @param bytes - the package bytes.
 * @returns the projected text, its sections, and every recoverable failure the archive or a part reported.
 */
export function extractDocxText(bytes: Uint8Array): DocxTextResult {
  const archive = readZip(bytes)
  const problems = [...archive.problems]
  const document = archive.entries.find(entry => entry.name === DOCUMENT_PART)
  if (document === undefined) {
    problems.push({ code: 'missing-document', detail: `the archive holds no ${DOCUMENT_PART} part` })
  }
  const body = document === undefined ? [] : projectedLines(DOCUMENT_PART, document.data, problems)
  const header = groupedLines(archive.entries, HEADER_PART_PREFIX, problems)
  const footer = groupedLines(archive.entries, FOOTER_PART_PREFIX, problems)

  const sections: DocxSection[] = []
  if (header.length > 0) sections.push({ text: HEADER_PART_LABEL, headingLevel: undefined }, ...header)
  sections.push(...body)
  if (footer.length > 0) sections.push({ text: FOOTER_PART_LABEL, headingLevel: undefined }, ...footer)

  const text = sections.map(section => section.text).join('\n\n')
  if (text === '') problems.push({ code: 'no-text', detail: 'no paragraph text was projected' })
  return { text, sections, problems }
}
