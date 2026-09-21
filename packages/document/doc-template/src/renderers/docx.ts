/**
 * The DOCX renderer, rewritten from `renderer_docx.go` of the Go project Mady.
 * The upstream file wrote the three OOXML parts itself; the harness already owns
 * that renderer as `@deepseek-ai/dsh-docx-kit`, so this module delegates to it
 * rather than carrying a second copy of the OOXML writer.
 *
 * The disclaimer is handed to the package rather than prepended here: the
 * package writes it in the same Markdown form `markdown.ts` uses, so the two
 * render paths produce one disclaimer.
 * @module @deepseek-ai/dsh-doc-template/renderers/docx
 */

import { renderDocx as renderDocxPackage } from '@deepseek-ai/dsh-docx-kit'
import type { DocxRenderOptions } from '@deepseek-ai/dsh-docx-kit'
import type { Renderer, RenderMeta } from '../types.ts'

/**
 * Render a resolved body as a DOCX package.
 * @param markdown - the resolved body.
 * @param meta - rendering metadata.
 * @returns the DOCX package bytes.
 */
function renderDocx(markdown: string, meta: RenderMeta): Uint8Array {
  const title = meta.title ?? ''
  const disclaimer = meta.style?.disclaimer ?? ''
  const options: DocxRenderOptions = {
    ...(title === '' ? {} : { title }),
    ...(disclaimer === '' ? {} : { disclaimer }),
  }
  return renderDocxPackage(markdown, options)
}

/** The DOCX renderer. */
export const docxRenderer: Renderer = { format: 'docx', render: renderDocx }
