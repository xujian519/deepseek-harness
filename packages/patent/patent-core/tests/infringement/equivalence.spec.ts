import { describe, expect, it } from 'vitest'
import type { ChartRow, Mapping } from '../../src/claim-chart/protocol/types.ts'
import { findEquivalenceContradictions, type EquivalenceTriplet } from '../../src/infringement/equivalence.ts'
import { EQUIVALENCE_CASES } from '../fixtures/from-mady/infringement.ts'

// 上游等同三要素用例在 tests/fixtures/from-mady/infringement.ts（含上游路径与提交）；
// 上游由同一次模型输出自证三要素与等同结论，本模块把图表与认定记录分开输入后核验。

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

/** 构造一条等同认定记录（默认符合三要素并认定等同）。 */
function triplet(elementId: string, overrides: Partial<EquivalenceTriplet> = {}): EquivalenceTriplet {
  return {
    elementId,
    targetId: '产品A',
    sameMeans: true,
    sameFunction: true,
    sameEffect: true,
    inventiveEffortRequired: false,
    isEquivalent: true,
    ...overrides,
  }
}

describe('findEquivalenceContradictions', () => {
  it.each(EQUIVALENCE_CASES)('上游等同三要素用例（$name）', ({ upstream, ours }) => {
    const contradictions = findEquivalenceContradictions(
      [row('1a', 'doe')],
      [
        triplet('1a', {
          sameMeans: upstream.sameMeans,
          sameFunction: upstream.sameFunction,
          sameEffect: upstream.sameEffect,
          isEquivalent: upstream.isEquivalent,
        }),
      ],
    )
    expect(contradictions.map(item => item.kind)).toEqual(ours)
  })

  it('按等同落格且有自洽的认定记录时不报矛盾', () => {
    expect(findEquivalenceContradictions([row('1a', 'doe')], [triplet('1a')])).toEqual([])
  })

  it('按等同落格但缺认定记录时报缺', () => {
    expect(findEquivalenceContradictions([row('1a', 'doe')], [])).toEqual([
      {
        elementId: '1a',
        targetId: '产品A',
        kind: 'doe-without-triplet',
        detail: '图表按等同落格，但没有对应的等同三要素记录，等同认定无法复核',
      },
    ])
  })

  it('认定记录否认等同时报矛盾', () => {
    expect(findEquivalenceContradictions([row('1a', 'doe')], [triplet('1a', { isEquivalent: false })])).toEqual([
      {
        elementId: '1a',
        targetId: '产品A',
        kind: 'triplet-denies-doe',
        detail: '图表按等同落格，但等同认定记录为不构成等同',
      },
    ])
  })

  it('手段、功能、效果三项均不同却认定等同时报矛盾', () => {
    const contradictions = findEquivalenceContradictions(
      [row('1a', 'doe')],
      [triplet('1a', { sameMeans: false, sameFunction: false, sameEffect: false })],
    )
    expect(contradictions.map(item => item.kind)).toEqual(['doe-without-common-element'])
  })

  it('认定等同同时认定需要创造性劳动时报矛盾', () => {
    const contradictions = findEquivalenceContradictions(
      [row('1a', 'doe')],
      [triplet('1a', { inventiveEffortRequired: true })],
    )
    expect(contradictions.map(item => item.kind)).toEqual(['inventive-effort-required'])
  })

  it('一处认定命中两条矛盾时两条都报，按固定次序', () => {
    const contradictions = findEquivalenceContradictions(
      [row('1a', 'doe')],
      [triplet('1a', { sameMeans: false, sameFunction: false, sameEffect: false, inventiveEffortRequired: true })],
    )
    expect(contradictions.map(item => item.kind)).toEqual([
      'doe-without-common-element',
      'inventive-effort-required',
    ])
  })

  it('同一要素与目标有多条认定记录时报重复并以首条为准', () => {
    const contradictions = findEquivalenceContradictions(
      [row('1a', 'doe')],
      [triplet('1a'), triplet('1a', { isEquivalent: false })],
    )
    expect(contradictions).toEqual([
      {
        elementId: '1a',
        targetId: '产品A',
        kind: 'duplicate-triplet',
        detail: '同一要素与目标有多条等同认定记录，核验以首条为准',
      },
    ])
  })

  it('认定等同但图表未按等同落格时报未落图', () => {
    expect(findEquivalenceContradictions([row('1a', 'not-found')], [triplet('1a')])).toEqual([
      {
        elementId: '1a',
        targetId: '产品A',
        kind: 'equivalence-not-mapped',
        detail: '已认定构成等同，但图表在该行结论为 not-found',
      },
    ])
    expect(findEquivalenceContradictions([], [triplet('1a')])).toEqual([
      {
        elementId: '1a',
        targetId: '产品A',
        kind: 'equivalence-not-mapped',
        detail: '已认定构成等同，但图表无对应行',
      },
    ])
  })

  it('字面或已按等同落格时不报未落图', () => {
    expect(findEquivalenceContradictions([row('1a', 'literal')], [triplet('1a')])).toEqual([])
    expect(findEquivalenceContradictions([row('1a', 'doe')], [triplet('1a')])).toEqual([])
  })

  it('认定不构成等同且图表未落格时不报矛盾', () => {
    expect(findEquivalenceContradictions([row('1a', 'not-found')], [triplet('1a', { isEquivalent: false })])).toEqual(
      [],
    )
  })

  it('认定记录按要素与目标成对匹配，不跨目标套用', () => {
    const contradictions = findEquivalenceContradictions([row('1a', 'doe')], [triplet('1a', { targetId: '产品B' })])
    expect(contradictions.map(item => [item.targetId, item.kind])).toEqual([
      ['产品A', 'doe-without-triplet'],
      ['产品B', 'equivalence-not-mapped'],
    ])
  })

  it('逐行核验，多行各自成对', () => {
    const contradictions = findEquivalenceContradictions(
      [row('1a', 'doe'), row('1b', 'doe'), row('1c', 'doe')],
      [triplet('1a'), triplet('1b', { isEquivalent: false })],
    )
    expect(contradictions.map(item => [item.elementId, item.kind])).toEqual([
      ['1b', 'triplet-denies-doe'],
      ['1c', 'doe-without-triplet'],
    ])
  })
})
