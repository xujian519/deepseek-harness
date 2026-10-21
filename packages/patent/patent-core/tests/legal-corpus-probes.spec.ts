import { describe, expect, it } from 'vitest'
import {
  AmendmentBasisHandler,
  analyzeNumericRanges,
  deriveAllElementsCoverage,
  deriveClaimRefs,
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

const ORIGINAL_CLAIMS = '1. 一种装置，包括壳体，其特征在于，所述壳体上设置有散热孔。'

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

  describe('A2 claim refs', () => {
    it.fails('引用语超出现行扫描窗口时不得默认判为独立权利要求', () => {
      const refs = deriveClaimRefs([
        '1. 一种装置，其特征在于，包括壳体。',
        '2. 一种用于高温高压环境下的换热装置，其包括壳体、设置于所述壳体内部的换热管以及用于连接所述换热管的集流管，其特征在于，根据权利要求1所述的换热装置，所述壳体为塑料。',
      ].join('\n'))
      expect(refs.find(ref => ref.claimNo === 2)?.claimType).not.toBe('independent')
    })

    it.fails('“前述权利要求中任一项”应解析为引用全部在前权项', () => {
      const refs = deriveClaimRefs([
        '1. 一种装置，其特征在于，包括壳体。',
        '2. 根据权利要求1所述的装置，其特征在于，所述壳体为塑料。',
        '3. 根据前述权利要求中任一项所述的装置，其特征在于，所述壳体可拆。',
      ].join('\n'))
      expect(refs.find(ref => ref.claimNo === 3)?.refersTo).toEqual([1, 2])
    })
  })

  describe('A4 amendment basis', () => {
    it.fails('新增单字“不”改变限定方向时应判为超出修改范围', async () => {
      const draft = [
        '修改后权利要求书：',
        '1. 一种装置，包括壳体，其特征在于，所述壳体上不设置有散热孔。',
        '',
        '意见陈述：x。',
      ].join('\n')
      const out = await new AmendmentBasisHandler().execute({
        state: { draft, claims: ORIGINAL_CLAIMS },
      })
      expect(out.amendment_basis_passed).toBe(false)
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
