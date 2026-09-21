import { describe, expect, it } from 'vitest'
import type { ChartRow, ClaimElement, Mapping } from '../../src/claim-chart/protocol/types.ts'
import { deriveAllElementsCoverage } from '../../src/infringement/all-elements.ts'
import type { EquivalenceTriplet } from '../../src/infringement/equivalence.ts'
import {
  DEFAULT_INFRINGEMENT_WEIGHTS,
  INFRINGEMENT_DIMENSIONS,
  riskLevel,
  scoreInfringement,
  type InfringementScoreInput,
  type InfringementWeights,
} from '../../src/infringement/risk.ts'
import { RISK_LEVEL_CASES, SCORER_CASES } from '../fixtures/from-mady/infringement.ts'

// 上游分级阈值（0.75/0.5/0.3 → high/medium/low）与评分维度用例在
// tests/fixtures/from-mady/infringement.ts（含上游路径与提交）。本模块的偏离项：
// 字面与等同合并为覆盖度、删除 strategy_viability 与固定金额上限、求和次序固定、
// 非法权重抛错。

/** 构造一条权利要求要素。 */
function element(id: string): ClaimElement {
  return { id, claimNo: 1, text: `特征 ${id}`, kind: 'limitation' }
}

/** 构造一条映射行。 */
function row(elementId: string, mapping: Mapping): ChartRow {
  return {
    elementId,
    targetId: '产品A',
    quote: '引文',
    pinCite: '[产品A 图1]',
    mapping,
    state: mapping,
    verified: true,
  }
}

/** 构造一条认定等同的记录。 */
function triplet(elementId: string): EquivalenceTriplet {
  return {
    elementId,
    targetId: '产品A',
    sameMeans: true,
    sameFunction: true,
    sameEffect: true,
    inventiveEffortRequired: false,
    isEquivalent: true,
  }
}

/** 无抗辩、无补救风险的基础输入。 */
function baseInput(rows: readonly ChartRow[], elements: readonly ClaimElement[]): InfringementScoreInput {
  return {
    coverage: deriveAllElementsCoverage(rows, '产品A', elements),
    triplets: [],
    contradictions: [],
    estoppelApplied: false,
    dedicationApplied: false,
    defenses: [],
    remedyExposureRatio: 0,
  }
}

describe('riskLevel', () => {
  it.each(RISK_LEVEL_CASES)('上游分级用例（$name）', ({ composite, want }) => {
    // 上游权重之和恰为 1，故上游合成分即本模块的"加权和 / 权重量程"。
    expect(riskLevel(composite, 1)).toBe(want)
  })

  it('阈值取等号即为该档', () => {
    expect(riskLevel(0.7, 1)).toBe('high')
    expect(riskLevel(0.4, 1)).toBe('medium')
    expect(riskLevel(0.3999, 1)).toBe('low')
  })

  it('阈值按权重量程折算', () => {
    expect(riskLevel(0.7 * 0.9, 0.9)).toBe('high')
    expect(riskLevel(0.4 * 0.9, 0.9)).toBe('medium')
    expect(riskLevel(0.4 * 0.9 - 0.001, 0.9)).toBe('low')
  })
})

describe('scoreInfringement', () => {
  it('默认权重与维度次序一致', () => {
    expect(Object.keys(DEFAULT_INFRINGEMENT_WEIGHTS).sort()).toEqual([...INFRINGEMENT_DIMENSIONS].sort())
    const sum = INFRINGEMENT_DIMENSIONS.reduce((total, dimension) => total + DEFAULT_INFRINGEMENT_WEIGHTS[dimension], 0)
    expect(sum).toBeCloseTo(0.9, 10)
  })

  it.each(SCORER_CASES)('上游评分维度对照（$name）', ({ ours, input }) => {
    const elements = input.elements.map(id => element(id))
    const rows = input.mappings.map(([id, mapping]) => row(id, mapping))
    const score = scoreInfringement({
      ...baseInput(rows, elements),
      triplets: input.equivalent.map(id => triplet(id)),
    })
    expect(score.dimensions[ours.dimension]).toBeCloseTo(ours.value, 10)
  })

  it('字面全覆盖的案子评为高风险，不被等同维度拉低', () => {
    // 上游把 literal_match 与 equivalence 分列加权，字面全覆盖时合成分只有 0.25。
    const score = scoreInfringement(baseInput([row('1a', 'literal')], [element('1a')]))
    expect(score.dimensions.elementsCovered).toBe(1)
    expect(score.composite).toBeCloseTo(0.8, 10)
    expect(score.riskLevel).toBe('high')
    expect(score.thresholds.high).toBeCloseTo(0.63, 10)
    expect(score.thresholds.medium).toBeCloseTo(0.36, 10)
  })

  it('经核验构成等同的要素计入覆盖', () => {
    const input: InfringementScoreInput = {
      ...baseInput([row('1a', 'literal'), row('1b', 'doe')], [element('1a'), element('1b')]),
      triplets: [triplet('1b')],
    }
    const score = scoreInfringement(input)
    expect(score.equivalentElements).toEqual(['1b'])
    expect(score.dimensions.elementsCovered).toBe(1)
    expect(score.composite).toBeCloseTo(0.8, 10)
  })

  it('等同认定被矛盾否定的要素不计入覆盖', () => {
    const input: InfringementScoreInput = {
      ...baseInput([row('1a', 'literal'), row('1b', 'doe')], [element('1a'), element('1b')]),
      triplets: [triplet('1b')],
      contradictions: [
        {
          elementId: '1b',
          targetId: '产品A',
          kind: 'inventive-effort-required',
          detail: '认定构成等同，但同时认定需要创造性劳动才能联想到，等同不成立',
        },
      ],
    }
    const score = scoreInfringement(input)
    expect(score.equivalentElements).toEqual([])
    expect(score.dimensions.elementsCovered).toBe(0.5)
  })

  it('别的目标上的矛盾不影响本目标的覆盖', () => {
    const input: InfringementScoreInput = {
      ...baseInput([row('1a', 'literal'), row('1b', 'doe')], [element('1a'), element('1b')]),
      triplets: [triplet('1b')],
      contradictions: [
        { elementId: '1b', targetId: '产品B', kind: 'triplet-denies-doe', detail: '另一目标的矛盾' },
      ],
    }
    expect(scoreInfringement(input).dimensions.elementsCovered).toBe(1)
  })

  it('待解释要素与缺项都不计入覆盖', () => {
    const score = scoreInfringement(
      baseInput([row('1a', 'literal'), row('1b', 'literal-construction-dependent')], [element('1a'), element('1b')]),
    )
    expect(score.dimensions.elementsCovered).toBe(0.5)
    const notCovered = scoreInfringement(baseInput([row('1a', 'literal')], [element('1a'), element('1b')]))
    expect(notCovered.dimensions.elementsCovered).toBe(0.5)
  })

  it('无要素时覆盖度为 0', () => {
    expect(scoreInfringement(baseInput([], [])).dimensions.elementsCovered).toBe(0)
  })

  it('禁止反悔与捐献规则适用时对应维度归零', () => {
    const input: InfringementScoreInput = {
      ...baseInput([row('1a', 'literal')], [element('1a')]),
      estoppelApplied: true,
      dedicationApplied: true,
    }
    const score = scoreInfringement(input)
    expect(score.dimensions.estoppelAvailable).toBe(0)
    expect(score.dimensions.dedicationAvailable).toBe(0)
    expect(score.composite).toBeCloseTo(0.65, 10)
    expect(score.riskLevel).toBe('high')
  })

  it('抗辩强度按强抗辩占比反向计', () => {
    expect(scoreInfringement(baseInput([row('1a', 'literal')], [element('1a')])).dimensions.defenseStrength).toBe(1)
    const strong = scoreInfringement({
      ...baseInput([row('1a', 'literal')], [element('1a')]),
      defenses: ['high', 'medium'],
    })
    expect(strong.dimensions.defenseStrength).toBe(0)
    const mixed = scoreInfringement({
      ...baseInput([row('1a', 'literal')], [element('1a')]),
      defenses: ['high', 'low'],
    })
    expect(mixed.dimensions.defenseStrength).toBe(0.5)
  })

  it('补救风险由调用方按案件量程给出，原样进入分项', () => {
    const input: InfringementScoreInput = {
      ...baseInput([row('1a', 'literal')], [element('1a')]),
      remedyExposureRatio: 0.4,
    }
    const score = scoreInfringement(input)
    expect(score.dimensions.remedyExposure).toBe(0.4)
    expect(score.composite).toBeCloseTo(0.84, 10)
  })

  it('同一输入重复运行结果一致，且与权重对象的键序无关', () => {
    const input: InfringementScoreInput = {
      ...baseInput([row('1a', 'literal'), row('1b', 'doe')], [element('1a'), element('1b')]),
      triplets: [triplet('1b')],
      defenses: ['high', 'low', 'low'],
      remedyExposureRatio: 0.25,
    }
    const reordered: InfringementWeights = {
      remedyExposure: 0.10,
      defenseStrength: 0.20,
      dedicationAvailable: 0.05,
      estoppelAvailable: 0.10,
      elementsCovered: 0.45,
    }
    const first = JSON.stringify(scoreInfringement(input))
    expect(JSON.stringify(scoreInfringement(input))).toBe(first)
    expect(JSON.stringify(scoreInfringement(input, reordered))).toBe(first)
  })

  it('权重非法时抛错', () => {
    const input = baseInput([row('1a', 'literal')], [element('1a')])
    expect(() => scoreInfringement(input, { ...DEFAULT_INFRINGEMENT_WEIGHTS, elementsCovered: -0.1 })).toThrow(
      new RangeError('权重 elementsCovered 非法：-0.1（须为有限非负数）'),
    )
    expect(() => scoreInfringement(input, { ...DEFAULT_INFRINGEMENT_WEIGHTS, defenseStrength: Number.NaN })).toThrow(
      RangeError,
    )
    const zeroed = { ...DEFAULT_INFRINGEMENT_WEIGHTS }
    for (const dimension of INFRINGEMENT_DIMENSIONS) zeroed[dimension] = 0
    expect(() => scoreInfringement(input, zeroed)).toThrow(new RangeError('权重之和须为正数'))
  })

  it('补救风险比例越界时抛错', () => {
    const input = baseInput([row('1a', 'literal')], [element('1a')])
    expect(() => scoreInfringement({ ...input, remedyExposureRatio: 1.01 })).toThrow(RangeError)
    expect(() => scoreInfringement({ ...input, remedyExposureRatio: -0.01 })).toThrow(RangeError)
    expect(() => scoreInfringement({ ...input, remedyExposureRatio: Number.NaN })).toThrow(RangeError)
  })
})
