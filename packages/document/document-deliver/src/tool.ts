/**
 * The `document_deliver` tool: the document agent's structured deliverable
 * registration. The model calls it after the quality gate passes; the call's
 * arguments are session-logged, so the GUI derives the deliverable list
 * (paths, formats, gate state) without a new session event type. The tool
 * itself validates, checks, and confirms — it writes no file and touches no
 * persistence outside the normal tool/result log.
 *
 * The model declares which quality checks it ran; the tool reads the delivered
 * bytes and reports its own deterministic findings beside that declaration
 * (see `./checks.ts`). A finding the checker rates `block` throws instead of
 * registering, so a deliverable that still carries an unfilled variable never
 * reaches the registration path on the model's word alone.
 * @module @deepseek-ai/dsh-document-deliver/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { findStyleByName, type DocumentStyle } from '@deepseek-ai/dsh-doc-style'
import { extractDocxText, type ZipReadLimits } from '@deepseek-ai/dsh-docx-kit'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { errorMessage } from '@deepseek-ai/dsh-value'
import { checkDocumentText, type DocumentCheckFinding } from './checks.ts'

/** The formats the document workline delivers. */
export const DELIVERABLE_FORMATS = ['markdown', 'html', 'pdf', 'docx', 'pptx', 'other'] as const

/** One claimed deliverable format. */
export type DeliverableFormat = (typeof DELIVERABLE_FORMATS)[number]

/** Formats the checker reads as text directly; the rest need a projector or have none. */
const TEXT_FORMATS: readonly DeliverableFormat[] = ['markdown', 'html']

/** Largest deliverable the checker reads, matching the studio's preview cap. */
export const MAX_CHECK_BYTES = 4 * 1024 * 1024

/** One registered deliverable file. */
export interface DeliverFileInput {
  path: string
  format: DeliverableFormat
}

/** The quality-gate outcome for one registration. */
export interface DeliverGateInput {
  /** Verified P0 checklist items (P0 non-passing may not be delivered). */
  p0: string[]
  /** Met P1 checklist items; empty when none were met or none apply. */
  p1?: string[]
}

/** The `document_deliver` arguments (schema-validated field names). */
export interface DocumentDeliverInput {
  files: DeliverFileInput[]
  gate: DeliverGateInput
  brief_ref?: string
  /** Writing style to check against; the configured default when omitted. */
  style?: string
  /** Declared length budget of the delivered document, in characters. */
  char_budget?: number
}

/**
 * One deliverable's check outcome. `unchecked` means no reader exists for the
 * format, `unreadable` that reading or projecting it failed; neither claims the
 * file passes the checks. A `checked` report may still carry a reason when the
 * checks ran over incompletely projected text.
 */
export interface DeliverableCheckReport {
  path: string
  format: DeliverableFormat
  status: 'checked' | 'unchecked' | 'unreadable'
  /** Why the checks did not run, or ran over incomplete text; absent when they ran over the whole file. */
  reason?: string
  findings: DocumentCheckFinding[]
}

/** The canonical registration result (echoes the validated declaration). */
export interface DocumentDeliverResult {
  registered: Array<{ path: string; format: DeliverableFormat }>
  gate: {
    p0: string[]
    p1: string[]
    /** Style the deterministic checks ran against. */
    style: string
    /** One check report per registered file, in declaration order. */
    checks: DeliverableCheckReport[]
  }
  brief_ref?: string
}

/** Parsed, validated registration (camelCased, defaults applied). */
export interface DocumentDeliverSpec {
  files: Array<{ path: string; format: DeliverableFormat }>
  gate: { p0: string[]; p1: string[] }
  briefRef?: string
  /** Style the call named, absent when it named none. */
  styleName?: string
  /** Declared character budget, absent when the call declared none. */
  charBudget?: number
}

/** The loaded styles and the default one, resolved once at plugin load. */
export interface DocumentDeliverDeps {
  /** Every loaded style, which a call may name. */
  readonly styles: readonly DocumentStyle[]
  /** The style a call that names none is checked against. */
  readonly defaultStyle: DocumentStyle
  /** Budgets the DOCX archive read must stay within (Config `maxArchiveEntries` / `maxUncompressedBytes`). */
  readonly docxReadLimits: ZipReadLimits
}

/** The style a registration resolves to, or a fail-loud error naming the loaded set. */
function resolveStyle(deps: DocumentDeliverDeps, spec: DocumentDeliverSpec): DocumentStyle {
  if (spec.styleName === undefined) return deps.defaultStyle
  const style = findStyleByName(deps.styles, spec.styleName)
  if (style === undefined) {
    const known = deps.styles.map(entry => entry.name).join('、')
    throw new Error(`document_deliver: 未加载样式 ${JSON.stringify(spec.styleName)}；可用样式：${known}`)
  }
  return style
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0
}

/**
 * Validate the schema-validated arguments into a normalized spec. The JSON
 * schema covers shape and enums; this covers the semantic invariants the
 * schema subset cannot express: at least one file, no blank or duplicate
 * paths, a non-empty P0 list, no blank checklist items, a non-blank style
 * name, and a positive whole character budget.
 * @param args - the schema-validated raw arguments.
 * @returns the normalized spec, or throws on the first violation.
 */
export function parseDocumentDeliverArgs(args: DocumentDeliverInput): DocumentDeliverSpec {
  if (!Array.isArray(args.files) || args.files.length === 0) {
    throw new Error('document_deliver: files must list at least one deliverable')
  }
  const seen = new Set<string>()
  const files: DocumentDeliverSpec['files'] = []
  for (const file of args.files) {
    if (!isNonBlank(file.path)) throw new Error('document_deliver: every file path must be a non-empty string')
    if (seen.has(file.path)) throw new Error(`document_deliver: duplicate deliverable path "${file.path}"`)
    seen.add(file.path)
    files.push({ path: file.path, format: file.format })
  }
  if (!isNonBlank(args.gate.p0[0] ?? '') || !args.gate.p0.every(isNonBlank)) {
    throw new Error('document_deliver: gate.p0 must list the P0 checks that passed (non-empty, no blank items)')
  }
  const p1 = args.gate.p1 ?? []
  if (!p1.every(isNonBlank)) {
    throw new Error('document_deliver: gate.p1 items must be non-empty strings')
  }
  if (args.brief_ref !== undefined && !isNonBlank(args.brief_ref)) {
    throw new Error('document_deliver: brief_ref must be a non-empty path when provided')
  }
  if (args.style !== undefined && !isNonBlank(args.style)) {
    throw new Error('document_deliver: style must be a non-empty style name when provided')
  }
  if (args.char_budget !== undefined && (args.char_budget <= 0 || !Number.isInteger(args.char_budget))) {
    throw new Error('document_deliver: char_budget must be a positive whole number of characters')
  }
  return {
    files,
    gate: { p0: args.gate.p0, p1 },
    ...args.brief_ref !== undefined ? { briefRef: args.brief_ref } : {},
    ...args.style !== undefined ? { styleName: args.style } : {},
    ...args.char_budget !== undefined ? { charBudget: args.char_budget } : {},
  }
}

/** Format the parsed input and the check reports into the canonical JSON result. */
function toResult(spec: DocumentDeliverSpec, checks: readonly DeliverableCheckReport[], style: DocumentStyle): DocumentDeliverResult {
  const result: DocumentDeliverResult = {
    registered: spec.files.map(file => ({ path: file.path, format: file.format })),
    gate: { p0: spec.gate.p0, p1: spec.gate.p1, style: style.name, checks: [...checks] },
  }
  if (spec.briefRef !== undefined) result.brief_ref = spec.briefRef
  return result
}

/** Resolve one registered path against the calling session's workspace. */
async function resolveTarget(
  ctx: Context, exec: ToolRunContext, path: string,
): Promise<FsTarget> {
  const cwd = exec.agent?.session.header.cwd
  return ctx.fs.resolve(path, {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  })
}

/**
 * Confirm every registered file exists in the workspace. Registration is the
 * pre-delivery enforcement point: a file the session cannot resolve is not a
 * deliverable, and the model must fix it or drop it instead of registering a
 * ghost.
 * @param ctx - plugin context carrying `ctx.fs`.
 * @param exec - the current tool execution (signal, agent).
 * @param paths - the registered workspace-relative paths.
 * @returns the missing paths, empty when every file exists.
 */
export async function missingDeliverableFiles(
  ctx: Context, exec: ToolRunContext, paths: readonly string[],
): Promise<string[]> {
  const missing: string[] = []
  for (const path of paths) {
    const target = await resolveTarget(ctx, exec, path)
    const info = await ctx.fs.stat(target, exec.signal)
    if (info === undefined) missing.push(path)
  }
  return missing
}

/**
 * Read one deliverable and run the deterministic checks over its text.
 *
 * A format with no text reader, a read that fails (an oversized file, a
 * removed one), and a DOCX package that projects no text all report their own
 * status with the reason attached: the registration stays possible, and the
 * result never implies a check that did not run.
 * @param ctx - plugin context carrying `ctx.fs`.
 * @param exec - the current tool execution (signal, agent).
 * @param file - the declared path and format.
 * @param style - the style whose forbidden words are enforced.
 * @param charBudget - the declared character budget, when the call declared one.
 * @param docxReadLimits - budgets the DOCX archive read must stay within.
 * @returns the check report for this file.
 */
async function checkDeliverable(
  ctx: Context, exec: ToolRunContext, file: { path: string; format: DeliverableFormat },
  style: DocumentStyle, charBudget: number | undefined, docxReadLimits: ZipReadLimits,
): Promise<DeliverableCheckReport> {
  const base = { path: file.path, format: file.format }
  const options = { style, ...charBudget === undefined ? {} : { charBudget } }
  if (!TEXT_FORMATS.includes(file.format) && file.format !== 'docx') {
    return { ...base, status: 'unchecked', reason: `${file.format} 格式没有文本读取器`, findings: [] }
  }
  const target = await resolveTarget(ctx, exec, file.path)
  try {
    if (file.format === 'docx') {
      const bytes = await ctx.fs.readBytes(target, exec.signal, MAX_CHECK_BYTES)
      const projected = extractDocxText(bytes, docxReadLimits)
      const problems = projected.problems.map(problem => problem.code).join('、')
      // An empty projection always carries at least the `no-text` problem, so
      // the joined codes are the reason.
      if (projected.text === '') {
        return { ...base, status: 'unreadable', reason: problems, findings: [] }
      }
      // A package whose parts did not all project is reported as unreadable even
      // though the projected part was checked: a passing status would claim
      // coverage the reader did not have.
      return {
        ...base,
        status: problems === '' ? 'checked' : 'unreadable',
        ...problems === '' ? {} : { reason: `DOCX 结构报告 ${problems}，投影文本可能不完整` },
        findings: checkDocumentText(projected.text, options),
      }
    }
    // The text branch reads under the same cap as the DOCX branch, so an oversized
    // file is reported below instead of being read whole.
    const bytes = await ctx.fs.readBytes(target, exec.signal, MAX_CHECK_BYTES)
    const text = new TextDecoder().decode(bytes)
    return { ...base, status: 'checked', findings: checkDocumentText(text, options) }
  } catch (error) {
    // A file the checker cannot read is reported with its reason, never skipped silently.
    return { ...base, status: 'unreadable', reason: errorMessage(error), findings: [] }
  }
}

/**
 * Check every declared deliverable.
 * @param ctx - plugin context carrying `ctx.fs`.
 * @param exec - the current tool execution (signal, agent).
 * @param spec - the validated registration.
 * @param style - the style the checks run against.
 * @param docxReadLimits - budgets the DOCX archive read must stay within.
 * @returns one report per file, in declaration order.
 */
export async function checkDeliverables(
  ctx: Context, exec: ToolRunContext, spec: DocumentDeliverSpec, style: DocumentStyle,
  docxReadLimits: ZipReadLimits,
): Promise<DeliverableCheckReport[]> {
  const reports: DeliverableCheckReport[] = []
  for (const file of spec.files) {
    reports.push(await checkDeliverable(ctx, exec, file, style, spec.charBudget, docxReadLimits))
  }
  return reports
}

/** Every blocking finding of one check run, phrased as the remediation list. */
function blockingLines(checks: readonly DeliverableCheckReport[]): string[] {
  return checks.flatMap(report => report.findings
    .filter(finding => finding.level === 'block')
    .map(finding => `- ${report.path} [${finding.check}] ${finding.detail}`))
}

/** The one-line status of a file's check, as the model and the studio read it. */
function statusText(report: DeliverableCheckReport): string {
  if (report.status === 'unchecked') return '未核验'
  if (report.status === 'unreadable') return '无法核验'
  return report.findings.length === 0 ? '通过' : `${String(report.findings.length)} 项提示`
}

/** One file's check outcome as one line, with the reason it did not fully run. */
function describeCheck(report: DeliverableCheckReport): string {
  const status = `${report.path} ${statusText(report)}`
  return report.reason === undefined ? status : `${status}（${report.reason}）`
}

/** Model-facing text of one registration result. */
function renderResult(result: DocumentDeliverResult): string {
  const warnings = result.gate.checks.flatMap(report => report.findings
    .filter(finding => finding.level === 'warn')
    .map(finding => `- ${report.path} [${finding.check}] ${finding.detail}`))
  const lines = [
    `已登记 ${String(result.registered.length)} 个交付文件：${result.registered.map(file => file.path).join('、')}`,
    `质量门：P0 ${String(result.gate.p0.length)} 项通过${result.gate.p1.length > 0 ? `，P1 ${String(result.gate.p1.length)} 项` : ''}`,
    `确定性核验（样式 ${result.gate.style}）：${result.gate.checks.map(describeCheck).join('；')}`,
  ]
  if (result.brief_ref !== undefined) lines.push(`brief 参考：${result.brief_ref}`)
  if (warnings.length > 0) lines.push(`提示（${String(warnings.length)}）：`, ...warnings)
  return lines.join('\n')
}

/**
 * Project the check reports into the presentation metadata persisted on the
 * tool result.
 *
 * The projection is written out field by field rather than passing the reports
 * through: this object is what the log keeps and what the delivery studio
 * narrows back on replay, so its fields are a wire commitment, not an alias for
 * whatever the in-process report happens to carry.
 * @param checks - the check reports of one registration.
 * @returns the metadata value for `tool/result`.
 */
function checksMeta(checks: readonly DeliverableCheckReport[]) {
  return {
    checks: checks.map(report => ({
      path: report.path,
      format: report.format,
      status: report.status,
      ...report.reason === undefined ? {} : { reason: report.reason },
      findings: report.findings.map(finding => ({
        check: finding.check,
        level: finding.level,
        detail: finding.detail,
        ...finding.line === undefined ? {} : { line: finding.line },
      })),
    })),
  }
}

/**
 * Register one `document_deliver` tool definition over the plugin's context.
 * @param ctx - the Cordis context with the tools and fs services.
 * @param deps - the loaded styles and the default style of this deployment.
 * @returns a registry-ready tool definition.
 */
export function createDocumentDeliverTool(ctx: Context, deps: DocumentDeliverDeps): ToolDefinition {
  return defineTool({
    name: 'document_deliver',
    description: `登记一份文档交付物：声明成品文件、导出格式与质量门结果（P0/P1 自检项）。质量门通过后、向用户交付前调用一次；文件必须在工作区中存在。

工具会自己读成品并做确定性核验：残余占位符（{{变量}}、[TBD] 等）、本文档未声明的锚点、空章节、所选风格（style）的禁用词、以及声明的字数预算（char_budget）。这些结论与 P0/P1 自检项一并写入会话日志，交付物面板同时展示二者。命中禁用级问题（未填变量、风格禁用词）时调用会被拒绝并列出问题，修复后重新登记。`,
    parameters: {
      files: {
        type: 'array',
        required: true,
        description: '本次交付的全部成品文件与格式（至少一个）；path 为工作区相对路径（或绝对路径），如 out/report.html',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: '工作区相对路径（或绝对路径）' },
            format: { type: 'string', required: true, enum: [...DELIVERABLE_FORMATS], description: '成品导出格式' },
          },
        },
      },
      gate: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: '质量门结果：P0 全过才允许登记',
        properties: {
          p0: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: '已通过并核验的 P0 自检项（每项一句话）',
          },
          p1: {
            type: 'array',
            items: { type: 'string' },
            description: '已满足的 P1 自检项（无则省略）',
          },
        },
      },
      brief_ref: {
        type: 'string',
        description: '本次交付依据的 brief 文件路径（如 brief.md），可省略',
      },
      style: {
        type: 'string',
        description: '核验所用的书写风格名（如 assistant-neutral、patent-standard）；省略时用本部署配置的默认风格',
      },
      char_budget: {
        type: 'integer',
        description: '全文声明的字数预算（非空白字符数），用于核验篇幅；省略则不核验篇幅',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          registered: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                format: { type: 'string', required: true, enum: [...DELIVERABLE_FORMATS] },
              },
            },
            required: true,
          },
          gate: {
            type: 'object',
            additionalProperties: false,
            properties: {
              p0: { type: 'array', items: { type: 'string' }, required: true },
              p1: { type: 'array', items: { type: 'string' }, required: true },
              style: { type: 'string', required: true },
              checks: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    path: { type: 'string', required: true },
                    format: { type: 'string', required: true, enum: [...DELIVERABLE_FORMATS] },
                    status: { type: 'string', required: true, enum: ['checked', 'unchecked', 'unreadable'] },
                    reason: { type: 'string' },
                    findings: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          check: { type: 'string', required: true, enum: ['placeholder', 'broken_anchor', 'empty_section', 'anti_pattern', 'length_budget'] },
                          level: { type: 'string', required: true, enum: ['block', 'warn'] },
                          detail: { type: 'string', required: true },
                          line: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: true,
          },
          brief_ref: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
      // The deliverable panel reads the same computed reports back on replay;
      // the model-facing text above is only their summary.
      presentationMeta: (_args, value) => checksMeta(value.gate.checks),
    },
    presentCall: (args) => {
      try {
        const spec = parseDocumentDeliverArgs(args)
        return {
          card: 'generic',
          title: `登记文档交付物（${spec.files.length} 个文件）`,
          rawInput: {
            files: spec.files.map(file => `${file.path} (${file.format})`),
            p0: spec.gate.p0.length,
            p1: spec.gate.p1.length,
            ...spec.briefRef !== undefined ? { brief_ref: spec.briefRef } : {},
          },
          locations: spec.files.map(file => ({ path: file.path })),
        }
      } catch {
        // A UI may project the pending call during streaming, before the
        // validator-narrowed arguments reach the semantically-valid state; the
        // fallback card (tool name + raw args) still renders the call.
        return undefined
      }
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const spec = parseDocumentDeliverArgs(args)
      const style = resolveStyle(deps, spec)
      const missing = await missingDeliverableFiles(ctx, exec, spec.files.map(file => file.path))
      if (missing.length > 0) {
        throw new Error(`document_deliver: 以下交付文件在工作区中不存在，先修复或从登记中移除: ${missing.join('、')}`)
      }
      const checks = await checkDeliverables(ctx, exec, spec, style, deps.docxReadLimits)
      const blocking = blockingLines(checks)
      if (blocking.length > 0) {
        throw new Error([
          'document_deliver: 确定性核验未通过，修复以下问题后重新登记：',
          ...blocking,
        ].join('\n'))
      }
      return toResult(spec, checks, style)
    },
  })
}
