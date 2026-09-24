/**
 * Function plugin porting the Sati patent document renderer into the DeepSeek
 * Harness: template resolution, brand injection, headless-Chrome PDF rendering
 * through ctx.subprocess, and the render_patent_document tool.
 * @module @deepseek-ai/dsh-patent-document
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_PDF_TIMEOUT_MS } from './document/pdfRenderer.ts'
import { createRenderPatentDocumentTool } from './tool/render-patent-document.ts'

// Public library API: the ported document engine and the tool factory.
export * from './document/index.ts'
export { createRenderPatentDocumentTool, renderDocumentResult } from './tool/render-patent-document.ts'
export type { RenderPatentDocumentToolOptions } from './tool/render-patent-document.ts'

/** Cordis plugin name. */
export const name = 'patent-document'

/** Services the plugin requires before registration. */
export const inject = ['tools', 'subprocess']

/** Model-facing patent-document plugin configuration. */
export interface Config {
  /** Absolute Chrome executable used for PDF; overrides DSH_CHROME_PATH/CHROME_PATH discovery. */
  chromePath?: string
  /** Default output directory (relative to the process working directory) when neither outputDir nor caseId is given. */
  outputRoot?: string
  /** Headless-Chrome print timeout in milliseconds; defaults to the renderer's exported default (120000). */
  pdfTimeoutMs?: number
}

/** Schemastery configuration: optional Chrome override, default output directory, and print timeout. */
export const Config: z<Config> = z.object({
  chromePath: z.string(),
  outputRoot: z.string().default('.dsh/documents'),
  pdfTimeoutMs: z.number().step(1).min(1).default(DEFAULT_PDF_TIMEOUT_MS),
})

/**
 * Register the render_patent_document tool.
 * @param ctx - registrant context carrying the tool registry and subprocess service.
 * @param config - deployment's Chrome path override, default output directory, and print timeout.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(createRenderPatentDocumentTool({
    subprocess: ctx.subprocess,
    ...(config.chromePath !== undefined ? { chromePath: config.chromePath } : {}),
    ...(config.outputRoot !== undefined ? { defaultOutputDir: config.outputRoot } : {}),
    pdfTimeoutMs: config.pdfTimeoutMs ?? DEFAULT_PDF_TIMEOUT_MS,
  }))
}
