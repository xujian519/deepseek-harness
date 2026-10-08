/**
 * `verify_patent_filing` 工具：对成品申请文件 .docx 跑体例与内容断言。
 * @module @deepseek-ai/dsh-patent-filing/tool/verify-patent-filing
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { FilingVerifyResult } from '../types.ts'
import { verifyFiling } from '../filing/engine.ts'
import type { VerifyEngineOptions } from '../filing/engine.ts'
import { SECTION_TALLY_SCHEMA } from './schemas.ts'

const DESCRIPTION = [
  '对一件申请文件 .docx 跑体例与内容断言：分节数、各节页眉、行距、首行缩进、字号、是否出现非黑色文字（Word 内置标题样式会带蓝色）、说明书五部分是否齐备、每一节是否都承载了内容（空节意味着内容没落进那一节，而分节数、页眉与编号连续性都不会报）、权利要求项数、`[NNNN]` 段落编号是否从 1 起连续、各节实际承载的段落与图片数、以及内部复核痕迹是否清除。',
  '同时核对成品体例与模板反解体例是否一致——模板漂移会报错。',
  '这些是模型看不出来的静默缺陷，交付前必须跑；断言不通过时 `errors` 逐条给出实测值。',
].join(' ')

/** 输出 canonical 值的 JSON schema。 */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passed: { type: 'boolean', required: true },
    errors: { type: 'array', required: true, items: { type: 'string' } },
    docxPath: { type: 'string', required: true },
    templateFingerprint: { type: 'string', required: true },
    info: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        sections: { type: 'number', required: true },
        headers: { type: 'array', required: true, items: { type: 'string' } },
        paragraphs: { type: 'number', required: true },
        claims: { type: 'number', required: true },
        numbering: { type: 'string', required: true },
        tables: { type: 'number', required: true },
        figures: { type: 'number', required: true },
        layout: { type: 'array', required: true, items: SECTION_TALLY_SCHEMA },
        template: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sections: { type: 'number', required: true },
            sizes_pt: { type: 'array', required: true, items: { type: 'number' } },
            line_spacings: { type: 'array', required: true, items: { type: 'number' } },
          },
        },
      },
    },
  },
} as const

/**
 * 把验收结果渲染为模型可读文本。
 * @param value - 验收结果。
 * @returns 结论行 + 未通过断言明细，或实测摘要。
 */
export function renderVerifyResult(value: FilingVerifyResult): string {
  const { info } = value
  const lines = [value.passed
    ? `✅ 断言全部通过：${value.docxPath}`
    : `❌ ${value.errors.length} 项未通过：${value.docxPath}`]
  for (const error of value.errors) lines.push(`  - ${error}`)
  lines.push(
    `分节 ${info.sections}（${info.headers.join(' / ')}）`,
    `段落 ${info.paragraphs} · 权项 ${info.claims} · 编号 ${info.numbering} · 表格 ${info.tables} · 附图 ${info.figures}`,
    `各节归属：${info.layout.map(tally => `${tally.key} ${tally.paragraphs} 段/${tally.figures} 图`).join(' · ')}`,
    `模板指纹：sha256 ${value.templateFingerprint.slice(0, 16)}…`,
  )
  return lines.join('\n')
}

/** 工具工厂依赖：与验收引擎的调用参数同形。 */
export type VerifyPatentFilingToolOptions = VerifyEngineOptions

/**
 * 构造 `verify_patent_filing` 工具。
 * @param options - 工具依赖与引擎覆盖。
 * @returns 可注册的工具定义。
 */
export function createVerifyPatentFilingTool(options: VerifyPatentFilingToolOptions): ToolDefinition {
  return defineTool({
    name: 'verify_patent_filing',
    description: DESCRIPTION,
    parameters: {
      docx: {
        type: 'string',
        required: true,
        description: '待验收的申请文件 .docx 路径',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderVerifyResult(value) }],
    },
    async execute(args, exec) {
      return verifyFiling({ docxPath: args.docx }, options, exec.signal)
    },
  })
}
