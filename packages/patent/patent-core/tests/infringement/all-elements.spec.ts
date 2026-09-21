import { describe, expect, it } from 'vitest'
import type { ChartRow, ClaimElement, Mapping } from '../../src/claim-chart/protocol/types.ts'
import { deriveAllElementsCoverage } from '../../src/infringement/all-elements.ts'
import { ALL_ELEMENTS_CASES } from '../fixtures/from-mady/infringement.ts'

// 上游全面覆盖用例在 tests/fixtures/from-mady/infringement.ts（含上游路径与提交）；
// 上游由模型节点给出 all_elements_met，本模块的结论只由行级映射算出。

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

describe('deriveAllElementsCoverage', () => {
  it.each(ALL_ELEMENTS_CASES)('上游全面覆盖用例（$name）', ({ upstream, ours }) => {
    const elements = [element('1a'), element('1b')]
    const rows = upstream.allElementsMet
      ? [row('1a', 'literal'), row('1b', 'literal')]
      : [row('1a', 'literal')]
    expect(deriveAllElementsCoverage(rows, '产品A', elements).outcome).toBe(ours)
  })

  it('全部要素字面覆盖为 literal', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'literal'), row('1b', 'literal')],
      '产品A',
      [element('1a'), element('1b')],
    )
    expect(coverage.outcome).toBe('literal')
    expect(coverage.literalElements).toEqual(['1a', '1b'])
    expect(coverage.equivalenceCandidates).toEqual([])
    expect(coverage.missingElements).toEqual([])
    expect(coverage.elementCount).toBe(2)
  })

  it('缺任一要素即 not-covered，其余要素分类不丢失', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'literal'), row('1b', 'doe')],
      '产品A',
      [element('1a'), element('1b'), element('1c')],
    )
    expect(coverage.outcome).toBe('not-covered')
    expect(coverage.literalElements).toEqual(['1a'])
    expect(coverage.equivalenceCandidates).toEqual(['1b'])
    expect(coverage.missingElements).toEqual(['1c'])
  })

  it('无缺项但有等同候选时为 equivalence-required', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'literal'), row('1b', 'doe')],
      '产品A',
      [element('1a'), element('1b')],
    )
    expect(coverage.outcome).toBe('equivalence-required')
    expect(coverage.missingElements).toEqual([])
  })

  it('字面覆盖依赖权利要求解释时单列并降到 construction-dependent', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'literal'), row('1b', 'literal-construction-dependent')],
      '产品A',
      [element('1a'), element('1b')],
    )
    expect(coverage.outcome).toBe('construction-dependent')
    expect(coverage.literalElements).toEqual(['1a'])
    expect(coverage.constructionDependentElements).toEqual(['1b'])
  })

  it('只取指名的被诉方案目标', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'literal', 'D1'), row('1b', 'literal', '产品B')],
      '产品A',
      [element('1a'), element('1b')],
    )
    expect(coverage.targetId).toBe('产品A')
    expect(coverage.outcome).toBe('not-covered')
    expect(coverage.missingElements).toEqual(['1a', '1b'])
  })

  it('现有技术侧的映射不计入被诉方案的覆盖', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'anticipation'), row('1b', 'obviousness-combination')],
      '产品A',
      [element('1a'), element('1b')],
    )
    expect(coverage.outcome).toBe('not-covered')
    expect(coverage.missingElements).toEqual(['1a', '1b'])
  })

  it('权利要求解释依赖而未判等同时按缺项处理', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'literal'), row('1b', 'construction-dependent')],
      '产品A',
      [element('1a'), element('1b')],
    )
    expect(coverage.outcome).toBe('not-covered')
    expect(coverage.missingElements).toEqual(['1b'])
  })

  it('要素列表为空时判 not-covered', () => {
    const coverage = deriveAllElementsCoverage([], '产品A', [])
    expect(coverage.outcome).toBe('not-covered')
    expect(coverage.elementCount).toBe(0)
  })

  it('每个要素只在首个命中的分类中出现一次', () => {
    const coverage = deriveAllElementsCoverage(
      [row('1a', 'doe'), row('1a', 'literal')],
      '产品A',
      [element('1a')],
    )
    expect(coverage.outcome).toBe('literal')
    expect(coverage.literalElements).toEqual(['1a'])
    expect(coverage.equivalenceCandidates).toEqual([])
  })
})
