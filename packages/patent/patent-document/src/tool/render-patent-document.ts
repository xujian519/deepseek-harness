/**
 * `render_patent_document` tool: render a patent-attorney deliverable from one
 * of the eleven shipped Chinese HTML templates into an HTML file and, by default,
 * a headless-Chrome PDF.
 * @module @deepseek-ai/dsh-patent-document/tool/render-patent-document
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { validateSpecDraft, validateTemplateDraft, type SpecDraft, type TemplateDraft } from '@deepseek-ai/dsh-patent-core'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { DocumentRenderError } from '../document/errors.ts'
import { FORM_TEMPLATE_SCHEMAS, isFormTemplateId } from '../document/draftSchema/index.ts'
import { renderPatentDocument } from '../document/renderPatentDocument.ts'
import type { DocumentRenderResult } from '../document/types.ts'

/** 十一个随包分发的模板 id，与 manifest.json 的 templates 列表一致。 */
const TEMPLATE_IDS = [
  'patentability-opinion',
  'search-report',
  'oa-response',
  'claims-spec',
  'invalidation-opinion',
  'rectification-response',
  're-examination-request',
  'infringement-opinion',
  'litigation-pleading',
  'right-evaluation-report',
  'search-report-form',
] as const

const DESCRIPTION = [
  'Render a patent-attorney deliverable (patentability opinion, search report, OA response, claims-spec chart, invalidation opinion, rectification response, re-examination request, infringement opinion, litigation pleading, right-evaluation report, or search report form) from a shipped Chinese HTML template into files on disk. Pick a template id and an outputName; templates accept content either as sections (an id -> innerHTML record; only the nine document templates not yet on the draft model) or as a controlled draft (the draft parameter). The claims-spec filing document takes the SpecDraft structure: bibliographic meta, unnumbered claims, multi-paragraph abstract, one drawingDescriptions entry per figure, and the five specification parts as paragraph/list/table blocks. The two form templates (right-evaluation report, search report form) take form drafts: fields text slots, checkbox choice slots given as the selected option id, and blocks/rows sections. Draft-driven templates generate headings, claim numbers, figure numbers, table captions, and checkbox states from the structure — never author markup. Writes an HTML file, and by default also a PDF through headless Chrome (format: html, pdf, or both; default both). Returns the written file paths plus any warnings or the PDF failure reason (the HTML still exists when the PDF fails).',
].join('\n')
/** 输出 canonical 值的 JSON schema（与 DocumentRenderResult 对应）。 */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    htmlPath: { type: 'string', required: true },
    pdfPath: { type: 'string' },
    pdfError: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

/**
 * 将渲染结果渲染为模型可读文本。
 * @param value - 渲染结果。
 * @returns 多行路径 + 告警 + PDF 失败说明。
 */
export function renderDocumentResult(value: DocumentRenderResult): string {
  const lines: string[] = [`HTML written: ${value.htmlPath}`]
  if (value.pdfPath !== undefined) lines.push(`PDF written: ${value.pdfPath}`)
  if (value.pdfError !== undefined) lines.push(`PDF not written: ${value.pdfError} (the HTML file is still available)`)
  for (const warning of value.warnings) lines.push(`Warning: ${warning}`)
  return lines.join('\n')
}

/**
 * 将 JSON 对象记录强转为字符串值记录。
 * @param value - 待强转的记录。
 * @param field - 参数字段名（用于报错）。
 * @returns 字符串值记录；非字符串值抛输入契约错误。
 */
function coerceStringRecord(value: Record<string, JsonValue> | undefined, field: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (value === undefined) return result
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new DocumentRenderError(`${field} 的键 "${key}" 必须是字符串`)
    }
    result[key] = entry
  }
  return result
}

/** 工具工厂依赖：subprocess 服务与 Chrome/目录覆盖。 */
export interface RenderPatentDocumentToolOptions {
  /** 注入的 subprocess 服务（ctx.subprocess）。 */
  subprocess: SubprocessRuntime
  /** Chrome 可执行文件覆盖。 */
  chromePath?: string
  /** 缺省输出目录（相对 cwd）。 */
  defaultOutputDir?: string
  /** Chrome 无头打印超时（毫秒；与 Config.pdfTimeoutMs 同源）。 */
  pdfTimeoutMs?: number
}

/**
 * 构造 render_patent_document 工具。
 * @param options - 工具依赖与覆盖。
 * @returns 可注册的工具定义。
 */
export function createRenderPatentDocumentTool(options: RenderPatentDocumentToolOptions): ToolDefinition {
  return defineTool({
    name: 'render_patent_document',
    description: DESCRIPTION,
    parameters: {
      template: {
        type: 'string',
        required: true,
        enum: TEMPLATE_IDS,
        description: 'Template id to render (one of the eleven shipped patent templates).',
      },
      outputName: {
        type: 'string',
        required: true,
        description: 'Output filename stem (no extension); letters, digits, underscore, hyphen, dot, parentheses, Chinese characters, circled numerals (①–⑳), and common Chinese punctuation (a Chinese draft name is accepted as written). No spaces, no path separators, no "..".',
      },
      caseId: {
        type: 'string',
        description: 'Optional case id; when given the result lands in data/cases/<caseId>/outputs/ instead of the default directory.',
      },
      outputDir: {
        type: 'string',
        description: 'Optional explicit output directory (overrides caseId and the default directory).',
      },
      format: {
        type: 'string',
        enum: ['html', 'pdf', 'both'] as const,
        description: 'Output format: html, pdf, or both (default both).',
      },
      sections: {
        type: 'object',
        additionalProperties: true,
        description: 'Record of element id -> HTML innerHTML content to inject into the template. Not for claims-spec, which requires draft instead.',
      },
      draft: {
        type: 'object',
        additionalProperties: true,
        description: 'Controlled draft (structured JSON). The claims-spec template takes the SpecDraft structure: meta (title/applicant/inventor/agent/date), claims (unnumbered, one per item), abstract (one paragraph per item), figureFiles, one drawingDescriptions entry per figure, and sections with the five specification parts (technicalField/background/summary/drawingDescriptions/embodiment) as paragraph/list/table blocks; tables are allowed only in embodiment and are captioned automatically. The form templates right-evaluation-report and search-report-form instead take the form draft: fields (text slots filled into .fill spans, and choice slots given as the selected option id, or an array of ids for multi-select groups), plus sections as either blocks (paragraph/list, rendered one line per paragraph or item) or rows (equal-width string arrays for the related-documents and search-round tables). Headings, claim numbers, figure numbers, and table captions are generated from the structure, never authored. Other templates do not accept draft yet.',
      },
      brand: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional inline brand overrides (keys map to the --sati-doc-* CSS variables, e.g. firm, accent).',
      },
      brandPath: {
        type: 'string',
        description: 'Optional path to a theme.json whose documents.patent namespace supplies brand overrides.',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderDocumentResult(value) }],
    },
    async execute(args, exec) {
      const sections = coerceStringRecord(args.sections, 'sections')
      const brand = args.brand === undefined ? undefined : coerceStringRecord(args.brand, 'brand')
      let draft: SpecDraft | undefined
      let templateDraft: TemplateDraft | undefined
      if (args.draft !== undefined) {
        if (args.template === 'claims-spec') {
          // validateSpecDraft 的契约是只抛 DraftValidationError（消息已列出可用槽位），直接传播。
          draft = validateSpecDraft(args.draft)
        } else if (isFormTemplateId(args.template)) {
          templateDraft = validateTemplateDraft(args.draft, FORM_TEMPLATE_SCHEMAS[args.template])
        } else {
          throw new DocumentRenderError(`模板 ${args.template} 尚未接入受控草案：draft 目前支持 claims-spec、right-evaluation-report、search-report-form，其余模板请仍用 sections`)
        }
      }
      const result = await renderPatentDocument(
        {
          template: args.template,
          outputName: args.outputName,
          ...(args.caseId !== undefined ? { caseId: args.caseId } : {}),
          ...(args.outputDir !== undefined ? { outputDir: args.outputDir } : {}),
          ...(args.format !== undefined ? { format: args.format } : {}),
          sections,
          ...(draft !== undefined ? { draft } : {}),
          ...(templateDraft !== undefined ? { templateDraft } : {}),
          ...(brand !== undefined ? { brand } : {}),
          ...(args.brandPath !== undefined ? { brandPath: args.brandPath } : {}),
        },
        process.cwd(),
        {
          subprocess: options.subprocess,
          ...(options.chromePath !== undefined ? { chromePath: options.chromePath } : {}),
          ...(options.defaultOutputDir !== undefined ? { defaultOutputDir: options.defaultOutputDir } : {}),
          ...(options.pdfTimeoutMs !== undefined ? { pdfTimeoutMs: options.pdfTimeoutMs } : {}),
          signal: exec.signal,
        },
      )
      const out: { htmlPath: string; pdfPath?: string; pdfError?: string; warnings: string[] } = {
        htmlPath: result.htmlPath,
        warnings: result.warnings,
      }
      if (result.pdfPath !== undefined) out.pdfPath = result.pdfPath
      if (result.pdfError !== undefined) out.pdfError = result.pdfError
      return out
    },
  })
}
