/**
 * The `document_deliver` tool: the document agent's structured deliverable
 * registration. The model calls it after the quality gate passes; the call's
 * arguments are session-logged, so the GUI derives the deliverable list
 * (paths, formats, gate state) without a new session event type. The tool
 * itself only validates and confirms — it writes no file and touches no
 * persistence outside the normal tool/result log.
 * @module @deepseek-ai/dsh-document-deliver/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** The formats the document workline delivers. */
export const DELIVERABLE_FORMATS = ['markdown', 'html', 'pdf', 'docx', 'pptx', 'other'] as const

/** One claimed deliverable format. */
export type DeliverableFormat = (typeof DELIVERABLE_FORMATS)[number]

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
}

/** The canonical registration result (echoes the validated declaration). */
export interface DocumentDeliverResult {
  registered: Array<{ path: string; format: DeliverableFormat }>
  gate: { p0: string[]; p1: string[] }
  brief_ref?: string
}

/** Parsed, validated registration (camelCased, defaults applied). */
export interface DocumentDeliverSpec {
  files: Array<{ path: string; format: DeliverableFormat }>
  gate: { p0: string[]; p1: string[] }
  briefRef?: string
}

/** Format the parsed input back into the canonical JSON result. */
function toResult(spec: DocumentDeliverSpec): DocumentDeliverResult {
  const result: DocumentDeliverResult = {
    registered: spec.files.map(file => ({ path: file.path, format: file.format })),
    gate: { p0: spec.gate.p0, p1: spec.gate.p1 },
  }
  if (spec.briefRef !== undefined) result.brief_ref = spec.briefRef
  return result
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0
}

/**
 * Validate the schema-validated arguments into a normalized spec. The JSON
 * schema covers shape and enums; this covers the semantic invariants the
 * schema subset cannot express: at least one file, no blank or duplicate
 * paths, a non-empty P0 list, and no blank checklist items.
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
  return {
    files,
    gate: { p0: args.gate.p0, p1 },
    ...args.brief_ref !== undefined ? { briefRef: args.brief_ref } : {},
  }
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
 * Register one `document_deliver` tool definition over the plugin's context.
 * @param ctx - the Cordis context with the tools, fs, and systemPrompt services.
 * @returns a registry-ready tool definition.
 */
export function createDocumentDeliverTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'document_deliver',
    description: '登记一份文档交付物：声明成品文件、导出格式与质量门结果（P0/P1 自检项）。质量门通过后、向用户交付前调用一次；文件必须在工作区中存在。调用会写入会话日志，交付物面板据此展示文件与质量门状态。',
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
            },
            required: true,
          },
          brief_ref: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const result = value
        const lines = [
          `已登记 ${result.registered.length} 个交付文件：${result.registered.map(file => file.path).join('、')}`,
          `质量门：P0 ${result.gate.p0.length} 项通过${result.gate.p1.length > 0 ? `，P1 ${result.gate.p1.length} 项` : ''}`,
        ]
        if (result.brief_ref !== undefined) lines.push(`brief 参考：${result.brief_ref}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
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
      const missing = await missingDeliverableFiles(ctx, exec, spec.files.map(file => file.path))
      if (missing.length > 0) {
        throw new Error(`document_deliver: 以下交付文件在工作区中不存在，先修复或从登记中移除: ${missing.join('、')}`)
      }
      return toResult(spec)
    },
  })
}
