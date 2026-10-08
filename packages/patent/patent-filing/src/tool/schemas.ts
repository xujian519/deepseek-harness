/**
 * 成文与验收两个工具结果共用的 JSON schema 片段。
 *
 * 两处的输出都带 `SectionTally`；schema 与 `types.ts` 的声明必须同步，放在这里就只有
 * 一处要改。
 * @module @deepseek-ai/dsh-patent-filing/tool/schemas
 */

/** 一节承载的内容量（`SectionTally`）的 JSON schema。 */
export const SECTION_TALLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: { type: 'string', required: true },
    paragraphs: { type: 'number', required: true },
    figures: { type: 'number', required: true },
  },
} as const
