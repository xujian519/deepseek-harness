/**
 * 专利文书渲染引擎（自 Sati src/patent/document 移植）：模板解析、品牌注入、
 * Chrome headless PDF 渲染与 HTML/PDF 落盘。
 * @module @deepseek-ai/dsh-patent-document/document
 */

export type {
  DocumentBrand,
  DocumentRenderInput,
  DocumentRenderResult,
  DocumentTemplateId,
  RenderFormat,
} from './types.ts'

export { DocumentRenderError } from './errors.ts'
export { renderPatentDocument, DEFAULT_OUTPUT_DIR } from './renderPatentDocument.ts'
export type { RenderPatentDocumentOptions } from './renderPatentDocument.ts'
export { renderPdf, findChrome } from './pdfRenderer.ts'
export { buildBrandStyle, loadBrandFromPath, mergeBrand, BRAND_KEY_TO_CSS_VAR } from './brandInjector.ts'
export { readTemplateManifest, resolveTemplate, readTemplateHtml, getTemplateRoot } from './templateResolver.ts'
