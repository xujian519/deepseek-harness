import { describe, expect, it } from 'vitest'
import {
  analyzeNumericRanges,
  deriveAllElementsCoverage,
  extractCitations,
  type ChartRow,
  type ClaimElement,
  type NumericRangeVerdict,
} from '@deepseek-ai/dsh-patent-core'

/**
 * 对一则数值表述运行确定性核验。
 * @param claim - 权利要求侧文本。
 * @param prior - 对比文件侧文本。
 * @returns 核验结论。
 */
function verdictOf(claim: string, prior: string): NumericRangeVerdict {
  return analyzeNumericRanges({
    claims: [{ id: 'claim-1', text: claim }],
    priorArt: [{ docId: 'D1', text: prior }],
  }).verdict
}

describe('legal corpus probes', () => {
  describe('A1 numeric ranges', () => {
    it.fails('负值区间重叠应判为 overlapped', () => {
      expect(verdictOf('温度为-5至-10℃', 'D1 公开温度为-8至-6℃')).toBe('overlapped')
    })

    it.fails('负值数值点落入对比文件范围应判为 inside_without_endpoint', () => {
      expect(verdictOf('温度为-5℃', 'D1 公开温度为-10至-1℃')).toBe('inside_without_endpoint')
    })

    it.fails('Unicode 负号 − 应与 ASCII 负号同义', () => {
      expect(verdictOf('温度为−5至−10℃', 'D1 公开温度为-8至-6℃')).toBe('overlapped')
    })

    it.fails('同量纲不同单位应先换算再比较', () => {
      expect(verdictOf('加入量为 5-10mg', 'D1 公开加入量为 0.005-0.01g')).toBe('overlapped')
    })

    it.fails('不同量纲的单位不可比时结论应为 inconclusive', () => {
      expect(verdictOf('加入量为 5-10mg', 'D1 公开加热时间为 5-10s')).toBe('inconclusive')
    })

    it.fails('后缀式下界（70℃以上）应按区间处理', () => {
      expect(verdictOf('温度在 70℃以上', 'D1 公开温度为 100-200℃')).toBe('overlapped')
    })
  })

  describe('A3 office action parsing', () => {
    it.fails('全角括号的本申请号应被识别为自身指代', () => {
      const citations = extractCitations('本申请（申请号CN117000000A）与对比文件CN112345678A的区别在于加热结构。')
      expect(citations.map(citation => citation.documentNumber)).toEqual(['CN112345678A'])
    })

    it.fails('并列枚举的权项号应全部计入同句引用', () => {
      const citations = extractCitations('对比文件CN101234567A公开了权利要求1、2和3的技术方案。')
      expect(citations[0]?.claimsAffected).toEqual([1, 2, 3])
    })
  })

  describe('A5 all-elements coverage', () => {
    it.fails('空要素表不应给出“不落入保护范围”的实质结论', () => {
      expect(deriveAllElementsCoverage([], '产品A', []).outcome).not.toBe('not-covered')
    })

    it.fails('任一权利要求被全部覆盖时整体结论不应是 not-covered', () => {
      const elements: ClaimElement[] = [
        { id: '1a', claimNo: 1, text: 'a', kind: 'limitation' },
        { id: '2a', claimNo: 2, text: 'b', kind: 'limitation' },
        { id: '2b', claimNo: 2, text: 'c', kind: 'limitation' },
      ]
      const rows: ChartRow[] = ['1a', '2a'].map(elementId => ({
        elementId,
        targetId: '产品A',
        quote: 'q',
        pinCite: 'p',
        mapping: 'literal',
        state: 'literal',
        verified: true,
      }))
      expect(deriveAllElementsCoverage(rows, '产品A', elements).outcome).not.toBe('not-covered')
    })
  })
})
