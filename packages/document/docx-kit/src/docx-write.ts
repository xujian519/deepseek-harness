/**
 * Markdown to DOCX rendering, ported from `domains/doctmpl/renderer_docx.go` of
 * the Go project Mady. The rendered package holds the three parts that renderer
 * wrote: content types, package relationships, and the document body.
 */

import { parseMarkdown } from './markdown.ts'
import {
  CONTENT_TYPES_XML,
  headingXml,
  listItemXml,
  paragraphXml,
  ROOT_RELS_XML,
  tableXml,
  wrapDocumentXml,
} from './ooxml.ts'
import {
  assertNever,
  CONTENT_TYPES_PART,
  DOCUMENT_PART,
  ROOT_RELS_PART,
  type DocxBlock,
  type DocxRenderOptions,
} from './types.ts'
import { writeZip } from './zip.ts'

/** Warning marker the upstream renderer prefixed to a disclaimer line. */
const DISCLAIMER_PREFIX = '> ⚠️ '

/** Separator the upstream renderer put between the disclaimer and the body. */
const DISCLAIMER_SEPARATOR = '\n\n---\n\n'

/** Encoder of the part names and part texts, which OOXML fixes as UTF-8. */
const TEXT_CODEC = new TextEncoder()

/**
 * Prepend the disclaimer the way the upstream renderer did, at Markdown source level.
 * @param markdown - the Markdown body.
 * @param disclaimer - disclaimer text, when the caller supplied one.
 * @returns the source the block parser reads.
 */
function withDisclaimer(markdown: string, disclaimer: string | undefined): string {
  if (disclaimer === undefined || disclaimer === '') return markdown
  return `${DISCLAIMER_PREFIX}${disclaimer}${DISCLAIMER_SEPARATOR}${markdown}`
}

/**
 * Render one block.
 * @param block - the block to render.
 * @returns the block's OOXML fragment.
 */
function blockXml(block: DocxBlock): string {
  switch (block.kind) {
    case 'heading':
      return headingXml(block.text, block.level)
    case 'paragraph':
      return paragraphXml(block.runs)
    case 'listItem':
      return listItemXml(block.runs)
    case 'table':
      return tableXml(block.rows)
    /* v8 ignore next 2 -- DocxBlock is closed and every variant is rendered above. */
    default:
      return assertNever(block)
  }
}

/**
 * Render Markdown into a DOCX package.
 * @param markdown - the Markdown body.
 * @param options - title and disclaimer injected before the body.
 * @returns the complete DOCX bytes.
 * @throws RangeError when a written part name exceeds the ZIP name length field.
 */
export function renderDocx(markdown: string, options: DocxRenderOptions = {}): Uint8Array {
  const source = withDisclaimer(markdown, options.disclaimer)
  const body = parseMarkdown(source).map(blockXml).join('')
  const title = options.title === undefined || options.title === '' ? '' : headingXml(options.title, 1)
  return writeZip([
    { name: CONTENT_TYPES_PART, data: TEXT_CODEC.encode(CONTENT_TYPES_XML) },
    { name: ROOT_RELS_PART, data: TEXT_CODEC.encode(ROOT_RELS_XML) },
    { name: DOCUMENT_PART, data: TEXT_CODEC.encode(wrapDocumentXml(title + body)) },
  ])
}
