/**
 * The output-format renderer registry, rewritten from `renderer_registry.go` of
 * the Go project Mady: formats map to renderers, and asking for a format with no
 * renderer fails loud instead of returning an empty document.
 * @module @deepseek-ai/dsh-doc-template/renderer-registry
 */

import { docxRenderer } from './renderers/docx.ts'
import { htmlRenderer } from './renderers/html.ts'
import { markdownRenderer } from './renderers/markdown.ts'
import {
  DocTemplateError,
  type OutputFormat,
  type Renderer,
  type RenderedDocument,
  type RenderMeta,
} from './types.ts'

/** Registered renderers by format. */
export class RendererRegistry {
  private readonly renderersByFormat = new Map<OutputFormat, Renderer>()

  /**
   * Register a renderer for the format it declares; a format keeps one renderer.
   * @param renderer - the renderer to register.
   */
  register(renderer: Renderer): void {
    this.renderersByFormat.set(renderer.format, renderer)
  }

  /**
   * Look up the renderer of one format.
   * @param format - the format to look up.
   * @returns the renderer, or `undefined` when the format has none.
   */
  get(format: OutputFormat): Renderer | undefined {
    return this.renderersByFormat.get(format)
  }

  /**
   * Whether a format has a renderer.
   * @param format - the format to test.
   * @returns true when the format has one.
   */
  has(format: OutputFormat): boolean {
    return this.renderersByFormat.has(format)
  }

  /**
   * The registered formats, in code-unit order.
   * @returns the format names.
   */
  formats(): readonly OutputFormat[] {
    return [...this.renderersByFormat.keys()].sort()
  }

  /**
   * Render a resolved Markdown body in one format.
   * @param format - the target format.
   * @param markdown - the resolved body.
   * @param meta - rendering metadata.
   * @returns the rendered content.
   * @throws DocTemplateError when no renderer is registered for the format.
   */
  render(format: OutputFormat, markdown: string, meta: RenderMeta): RenderedDocument {
    const renderer = this.renderersByFormat.get(format)
    if (renderer === undefined) {
      throw new DocTemplateError('renderer-missing', `没有注册 ${format} 格式的渲染器。`)
    }
    return renderer.render(markdown, meta)
  }
}

/**
 * Build the registry of the renderers this package ships: Markdown, HTML, and
 * DOCX. The upstream PDF renderers are not ported.
 * @returns the registry.
 */
export function createRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry()
  registry.register(markdownRenderer)
  registry.register(htmlRenderer)
  registry.register(docxRenderer)
  return registry
}
