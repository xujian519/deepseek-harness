import { describe, expect, it } from 'vitest'
import type { ChartRow, ChartTarget, ClaimChart, ClaimElement, Mapping } from '../../src/claim-chart/protocol/types.ts'
import { deriveInfringementConclusion } from '../../src/infringement/conclusion.ts'
import type { EquivalenceTriplet } from '../../src/infringement/equivalence.ts'

/** 构造一条权利要求要素。 */
function element(id: string, claimNo = 1): ClaimElement {
  return { id, claimNo, text: `特征 ${id}`, kind: 'limitation' }
}

/** 构造一条映射行。 */
function row(elementId: string, mapping: Mapping, targetId = '产品A'): ChartRow {
  return {
    elementId,
    targetId,
    quote: '引文',
    pinCite: '[产品A 图1]',
    mapping,
    state: mapping,
    verified: true,
  }
}

/** 构造一张侵权模式图表。 */
function chart(rows: readonly ChartRow[], targets: readonly ChartTarget[]): ClaimChart {
  return {
    chartId: 'chart-infringement',
    mode: 'infringement',
    caseId: 'case-1',
    elements: [element('1a'), element('1b')],
    claimNos: [1],
    targets: [...targets],
    rows: [...rows],
    gaps: [],
    draftNotice: '草稿',
  }
}

/** 一条认定等同的三要素记录。 */
const affirmative: EquivalenceTriplet = {
  elementId: '1b',
  targetId: '产品A',
  sameMeans: true,
  sameFunction: true,
  sameEffect: true,
  inventiveEffortRequired: false,
  isEquivalent: true,
}

const ACCUSED: ChartTarget = { id: '产品A', kind: 'accused-product' }
const PRIOR_ART: ChartTarget = { id: 'D1', kind: 'prior-art' }

describe('deriveInfringementConclusion', () => {
  it('逐被控产品判定覆盖，现有技术侧目标不参与', () => {
    const conclusion = deriveInfringementConclusion(chart([
      row('1a', 'literal'),
      row('1b', 'doe'),
      row('1a', 'literal', 'D1'),
    ], [ACCUSED, PRIOR_ART]))
    expect(conclusion.coverage).toHaveLength(1)
    expect(conclusion.coverage[0]?.targetId).toBe('产品A')
    expect(conclusion.coverage[0]?.outcome).toBe('equivalence-required')
    expect(conclusion.coverage[0]?.equivalenceCandidates).toEqual(['1b'])
    // 未给等同认定记录：按等同落格的行一律报缺记录。
    expect(conclusion.contradictions.map(item => item.kind)).toEqual(['doe-without-triplet'])
    expect(conclusion.scores).toBeUndefined()
  })

  it('给出评分事实时逐被控产品出分，缺省事实按无抗辩/未适用处理', () => {
    const input = chart([row('1a', 'literal'), row('1b', 'doe')], [ACCUSED])
    // 只给必需事实：抗辩缺省（不因缺少抗辩分析而降低风险）、禁止反悔与捐献未适用。
    const bare = deriveInfringementConclusion(input, { scoring: { remedyExposureRatio: 0 } })
    expect(bare.scores).toHaveLength(1)
    expect(bare.scores?.[0]?.dimensions.estoppelAvailable).toBe(1)
    expect(bare.scores?.[0]?.dimensions.dedicationAvailable).toBe(1)
    expect(bare.scores?.[0]?.dimensions.defenseStrength).toBe(1)

    // 给全事实：认定等同计入覆盖，两个规则适用时对应维度归零。
    const full = deriveInfringementConclusion(input, {
      triplets: [affirmative],
      scoring: {
        defenses: ['low'],
        remedyExposureRatio: 0.5,
        estoppelApplied: true,
        dedicationApplied: true,
      },
    })
    expect(full.contradictions).toEqual([])
    expect(full.scores?.[0]?.equivalentElements).toEqual(['1b'])
    expect(full.scores?.[0]?.dimensions.estoppelAvailable).toBe(0)
    expect(full.scores?.[0]?.dimensions.dedicationAvailable).toBe(0)
  })

  it('没有被控产品目标时不判定，评分数组为空', () => {
    const conclusion = deriveInfringementConclusion(
      chart([row('1a', 'literal', 'D1')], [PRIOR_ART]),
      { scoring: { remedyExposureRatio: 0 } },
    )
    expect(conclusion.coverage).toEqual([])
    expect(conclusion.scores).toEqual([])
  })
})
