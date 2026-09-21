/**
 * `parse_office_action` tool: deterministic parsing of an office action
 * (审查意见通知书) — rejection types, cited references with relevance, affected
 * claims, examiner arguments. The parser lives in
 * @deepseek-ai/dsh-patent-core (`notice/office-action.ts`) and calls no model,
 * so the result is reproducible on the same text.
 *
 * The tool reports the notice's own wording only. It does not decide whether a
 * rejection is well founded and does not draft a response; unmarked references
 * carry no relevance class rather than a default one.
 * @module @deepseek-ai/dsh-patent-tools/tool/parse-office-action
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  formatOfficeActionSummary,
  parseOfficeAction,
  type CitedReference,
  type ParsedOfficeAction,
} from '@deepseek-ai/dsh-patent-core'
import { PatentToolError } from '../error.ts'

/** Input for the parse_office_action tool. */
export type ParseOfficeActionInput = {
  /** The office action text to parse. */
  text: string
}

/** Output of the parse_office_action tool. */
export type ParseOfficeActionOutput = {
  /** Structured result (ParsedOfficeAction, JSON-safe). */
  parsed: JsonValue
  /** Chinese summary of the parsed facts. */
  summary: string
}

const DESCRIPTION = [
  '确定性解析审查意见通知书（不调用模型）：识别驳回类型（专利法 26.3/26.4/22.2/22.3/22.4/25 条等）、引用文献与相关性类别（X/Y/A/E/P）、',
  '涉及的权利要求（区间已展开）、审查员论点。用于答复前先拿到结构化事实：先按主驳回类型定答复主策略，再逐条处理。',
  '输出只反映通知书原文的措辞，不判断驳回是否成立，也不起草答复。文献未标注相关性类别时不推断类别。',
].join('')

/**
 * Render a cited reference line with the claims its sentence mentions.
 * @param reference - the parsed citation.
 * @returns one line, with the co-occurrence caveat made explicit.
 */
function renderCitation(reference: CitedReference): string {
  const relevancy = reference.relevancy === undefined ? '未标注' : `${reference.relevancy} 类`
  const claims = reference.claimsAffected.length > 0 ? reference.claimsAffected.join(', ') : '无'
  return `- ${reference.documentNumber}（${relevancy}）→ 同句提到的权项: ${claims}`
}

/** Render the canonical parse value into model-facing prose. */
function renderParseOfficeAction(value: ParseOfficeActionOutput): string {
  const parsed = value.parsed as unknown as ParsedOfficeAction
  const citationLines = parsed.citations.length > 0
    ? ['## 引用文献逐条（权项为同句共现，非权威对应）', ...parsed.citations.map(renderCitation)]
    : []
  return [
    'parse_office_action: 审查意见通知书解析（确定性纯函数，未调用模型）',
    value.summary,
    ...citationLines,
  ].join('\n')
}

/**
 * Build the `parse_office_action` tool.
 * @returns a registry-ready tool definition.
 */
export function createParseOfficeActionTool(): ToolDefinition {
  return defineTool({
    name: 'parse_office_action',
    description: DESCRIPTION,
    parameters: {
      text: { type: 'string', required: true, description: '审查意见通知书正文（含驳回条款与引用文献的原文）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          parsed: { type: 'json', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderParseOfficeAction(value) }],
    },
    // oxlint-disable-next-line typescript/require-await -- tool contract requires async execute
    async execute(args) {
      if (args.text.trim().length === 0) {
        throw new PatentToolError('invalid_tool_input', 'text 为空（须为审查意见通知书正文）', { tool: 'parse_office_action' })
      }
      const parsed = parseOfficeAction(args.text)
      return { parsed: parsed as unknown as JsonValue, summary: formatOfficeActionSummary(parsed) }
    },
  })
}
