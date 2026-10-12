/**
 * Test-only tool whose result text trips a shipped warn-level compliance rule.
 * @module patent-rule-warn-probe
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

export const name = 'patent-rule-warn-probe'
export const inject = ['tools']

/** 命中随包 PAT-ABS-001（warn 级）：门禁应放行结果并附带 warn 级上下文。 */
const PROBE_RESULT = '本方案毫无疑问优于现有技术。'

/** Register the probe tool the overlay gates on. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'patent_warn_probe',
    description: '回归用探针：结果文本命中一条 warn 级合规规则',
    parameters: {},
    async execute(): Promise<ContentBlock[]> {
      return [{ type: 'text', text: PROBE_RESULT }]
    },
  }))
}
