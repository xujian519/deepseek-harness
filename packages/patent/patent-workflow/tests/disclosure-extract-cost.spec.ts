import { describe, expect, it } from 'vitest'
import { ExtractHandler, type StageProvider } from '@deepseek-ai/dsh-patent-core'
import { patentDisclosureManifest } from '@deepseek-ai/dsh-patent-workflow'

/**
 * 披露提取链的调用预算：问题与发明认知合并为一次调用后，三路抽取各下发一次原文。
 *
 * 基线来自 `.agents/audits/2026-10-21-extract-call-cost.md`：8000 字符上限处四路
 * prompt 合计 32,613 字符。本用例把「合并后不再重复第四份原文」钉成回归信号，
 * 同时验证每条 prompt 只携带一份原文。
 */

const SOURCE_LENGTH = 8000
/** 四路抽取的实测 prompt 字符基线（审计报告 8000 字符行）。 */
const FOUR_WAY_BASELINE = 32613

/** 统计子串在文本中的出现次数。 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** 捕获 prompt，并按阶段参数返回该路抽取的最小合法 JSON。 */
function capturingProvider(
  prompts: string[],
  outputMode: unknown,
  outputKey: unknown,
): StageProvider {
  return {
    callLLM: async (prompt) => {
      prompts.push(prompt)
      if (outputMode === 'problem_insight') return JSON.stringify({ problem_insight: [] })
      return JSON.stringify({ [String(outputKey)]: [] })
    },
  }
}

describe('patent_disclosure_v1 抽取调用预算', () => {
  it('三路抽取各调用一次，prompt 总量低于四路基线，每条只带一份原文', async () => {
    const source = '甲'.repeat(SOURCE_LENGTH)
    const extractStages = patentDisclosureManifest.stages.filter(stage => stage.atom === 'extract')
    expect(extractStages.map(stage => stage.id)).toEqual([
      'extract_problem',
      'extract_features',
      'extract_effects',
    ])

    const prompts: string[] = []
    const handler = new ExtractHandler()
    for (const stage of extractStages) {
      const out = await handler.execute({
        state: { text: source, ...stage.params },
        provider: capturingProvider(prompts, stage.params?.['output_mode'], stage.params?.['output_key']),
      })
      expect(out._error, stage.id).toBeUndefined()
    }

    // 每次调用都携带完整原文（截断上限内），且不重复下发同一份原文。
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(countOccurrences(prompt, source)).toBe(1)
    }
    const totalChars = prompts.reduce((sum, prompt) => sum + prompt.length, 0)
    expect(totalChars).toBeLessThan(FOUR_WAY_BASELINE)
    expect(prompts[0]).toContain('problem_insight')
  })
})
