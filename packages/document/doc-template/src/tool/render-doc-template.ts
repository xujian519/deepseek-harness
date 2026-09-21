/**
 * `render_doc_template` tool: render one template with supplied variables.
 *
 * The result always carries the residual placeholders and the validation
 * warnings beside the document, because they are what a caller (human or gate)
 * reads to decide whether the rendered document is complete. A required variable
 * the call did not supply fails the call instead of producing a document with a
 * hole in it.
 * @module @deepseek-ai/dsh-doc-template/tool/render-doc-template
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RenderRequest, TemplateStore } from '../store.ts'
import {
  DocTemplateError,
  OUTPUT_FORMATS,
  VAR_ISSUE_CODES,
  type OutputFormat,
  type RenderEncoding,
  type VarIssue,
} from '../types.ts'

/** The model's render request. */
export interface RenderDocTemplateInput {
  /** Template name, from `list_doc_templates`. */
  readonly template: string
  /** Variable values, keyed by variable name without braces. */
  readonly variables: Readonly<Record<string, string>>
  /** Target format; the template's fallback format when omitted. */
  readonly format?: OutputFormat
  /** Document title override; the template title when omitted. */
  readonly title?: string
  /** Author or attorney recorded in the HTML metadata. */
  readonly author?: string
  /** Document date recorded in the HTML metadata. */
  readonly date?: string
  /** Suggested file name without extension; the template name when omitted. */
  readonly filename?: string
}

/** The rendered document as the model receives it. */
export interface RenderDocTemplateOutput {
  /** The template that was rendered. */
  readonly template: string
  /** The format rendered to. */
  readonly format: OutputFormat
  /** Suggested file name including the format's extension. */
  readonly fileName: string
  /** Content type of the rendered document. */
  readonly mimeType: string
  /** How `content` is encoded. */
  readonly encoding: RenderEncoding
  /** The rendered document: text, or a base64 DOCX package. */
  readonly content: string
  /** The resolved Markdown body the renderer consumed. */
  readonly markdown: string
  /** Placeholders left unfilled, in first-occurrence order. */
  readonly residual: string[]
  /** Non-blocking variable validation issues. */
  readonly warnings: VarIssue[]
}

/** A mutable render request under construction. */
type MutableRenderRequest = { -readonly [K in keyof RenderRequest]: RenderRequest[K] }

/**
 * Render one template.
 * @param store - the loaded templates and styles.
 * @param input - the template, variables, format, and metadata overrides.
 * @returns the rendered document with its residual placeholders and warnings.
 * @throws DocTemplateError when the template, style, format, or required variables cannot be satisfied.
 */
export function renderDocTemplate(store: TemplateStore, input: RenderDocTemplateInput): RenderDocTemplateOutput {
  const request: MutableRenderRequest = { template: input.template, variables: input.variables }
  if (input.format !== undefined) request.format = input.format
  if (input.title !== undefined && input.title !== '') request.title = input.title
  if (input.author !== undefined && input.author !== '') request.author = input.author
  if (input.date !== undefined && input.date !== '') request.date = input.date
  if (input.filename !== undefined && input.filename !== '') request.filename = input.filename
  const outcome = store.render(request)
  return {
    template: outcome.template.name,
    format: outcome.format,
    fileName: outcome.fileName,
    mimeType: outcome.mimeType,
    encoding: outcome.encoding,
    content: outcome.content,
    markdown: outcome.markdown,
    residual: [...outcome.residual],
    warnings: outcome.warnings.map(issue => ({
      variable: issue.variable,
      code: issue.code,
      message: issue.message,
    })),
  }
}

/**
 * Convert the model's variable object into string values.
 * The parameter schema cannot express a string-valued map, so the values are
 * checked here; a non-string value would otherwise be substituted into the
 * document as its JSON form.
 * @param value - the model's variable object, or `undefined` when it was omitted.
 * @returns the variable values.
 * @throws DocTemplateError when a value is not a string.
 */
export function coerceStringRecord(value: Record<string, unknown> | undefined): Record<string, string> {
  const variables: Record<string, string> = {}
  if (value === undefined) return variables
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new DocTemplateError('variable-invalid', `变量 ${JSON.stringify(name)} 的值必须是字符串。`)
    }
    variables[name] = entry
  }
  return variables
}

/**
 * Render the result for the model. The DOCX package itself stays out of the
 * transcript: a text format shows the document as rendered, and a DOCX result
 * shows the resolved Markdown, with the package carried base64 in the result's
 * `content` field for a delivery consumer.
 * @param value - the rendered document.
 * @returns the model-facing text.
 */
export function renderDocumentResult(value: RenderDocTemplateOutput): string {
  const lines: string[] = [
    `${value.template} · ${value.format} · ${value.fileName} · ${value.mimeType} · ${value.encoding}`,
    '',
  ]
  if (value.encoding === 'base64') {
    lines.push(`The rendered package is ${String(value.content.length)} base64 characters in the content field.`, '')
  }
  lines.push(
    value.residual.length === 0
      ? 'Residual placeholders: none'
      : `Residual placeholders (${String(value.residual.length)}): ${value.residual.join(', ')}`,
  )
  lines.push(
    value.warnings.length === 0
      ? 'Warnings: none'
      : `Warnings:\n${value.warnings.map(issue => `- ${issue.variable}: ${issue.message}`).join('\n')}`,
  )
  lines.push('', '--- document ---', value.encoding === 'utf8' ? value.content : value.markdown)
  return lines.join('\n')
}

const DESCRIPTION = [
  '- Renders one document template with supplied variables and returns the document, the placeholders that stayed unfilled, and the variable warnings.',
  '- Get the template name and its variables from `list_doc_templates` first. Every required variable must be supplied: a missing one fails the call and names it, rather than returning a document with a hole in it.',
  '- `format` defaults to the template\'s fallback format; a template only renders to the formats it lists. `markdown` and `html` return text; `docx` returns the package base64-encoded in `content`. The resolved Markdown body is always returned in `markdown`.',
  '- Variables the template does not declare are ignored, and a placeholder with no supplied value is left in the document and reported under `residual` instead of being erased. Both residual placeholders and warnings are returned for every successful render: read them before treating a document as final.',
  '',
  'Usage notes:',
  '  - Offline; renders the packaged template assets, the configured override directories, and the packaged styles.',
  '  - A template that declares a writing style carries that style\'s disclaimer into the rendered document when the deployment enabled disclaimers.',
].join('\n')

const WARNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    variable: { type: 'string', required: true },
    code: { type: 'string', required: true, enum: VAR_ISSUE_CODES },
    message: { type: 'string', required: true },
  },
} as const

/**
 * Build the `render_doc_template` tool.
 * @param store - the loaded templates and styles.
 * @returns the tool definition.
 */
export function createRenderDocTemplateTool(store: TemplateStore): ToolDefinition {
  return defineTool({
    name: 'render_doc_template',
    description: DESCRIPTION,
    parameters: {
      template: { type: 'string', required: true, description: 'Template name from list_doc_templates' },
      variables: {
        type: 'object',
        additionalProperties: true,
        description: 'Variable values keyed by variable name, without the {{}} wrapping; values are strings',
      },
      format: {
        type: 'string',
        enum: OUTPUT_FORMATS,
        description: 'Output format: markdown, html, or docx (default markdown)',
      },
      title: { type: 'string', description: 'Document title override; defaults to the template title' },
      author: { type: 'string', description: 'Author or attorney, written into the HTML metadata' },
      date: { type: 'string', description: 'Document date, written into the HTML metadata' },
      filename: { type: 'string', description: 'Suggested file name stem without extension; defaults to the template name' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          template: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: OUTPUT_FORMATS },
          fileName: { type: 'string', required: true },
          mimeType: { type: 'string', required: true },
          encoding: { type: 'string', required: true, enum: ['utf8', 'base64'] },
          content: { type: 'string', required: true },
          markdown: { type: 'string', required: true },
          residual: { type: 'array', required: true, items: { type: 'string' } },
          warnings: { type: 'array', required: true, items: WARNING_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDocumentResult(value) }],
    },
    execute(args) {
      const input: RenderDocTemplateInput = {
        template: args.template,
        variables: coerceStringRecord(args.variables),
        ...(args.format === undefined ? {} : { format: args.format }),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.author === undefined ? {} : { author: args.author }),
        ...(args.date === undefined ? {} : { date: args.date }),
        ...(args.filename === undefined ? {} : { filename: args.filename }),
      }
      // Rendering is pure over the loaded assets, so the value is already settled.
      return Promise.resolve(renderDocTemplate(store, input))
    },
  })
}
