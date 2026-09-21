import { describe, expect, it } from 'vitest'
import {
  MAX_CLAIM_NUMBER,
  checkEmbodimentCoverage,
  type ClaimCoverageEntry,
} from '../../src/claim-coverage/coverage.ts'

// 用例表转写自 Mady domains/claimdrafting/coverage_test.go（MIT，同作者）；
// 聚合口径按本模块修正（上游用原始 features 长度计数，重复特征会重复计入已覆盖数）。

const entry = (claimId: string, features: string[], embodimentRefs: string[]): ClaimCoverageEntry => ({
  claimId,
  features,
  embodimentRefs,
})

describe('checkEmbodimentCoverage: 覆盖度', () => {
  it('全部特征获实施例支持 → full', () => {
    const matrix = checkEmbodimentCoverage([
      entry('claim_1', ['导电涂层', '散热结构'], ['实施例1记载导电涂层采用石墨烯', '实施例2记载散热结构为翅片']),
    ])
    expect(matrix.items).toEqual([
      { claimId: 'claim_1', claimNumber: 1, valid: true, coverage: 'full', featureCount: 2, uncovered: [] },
    ])
    expect(matrix.fullCount).toBe(1)
    expect(matrix.partialCount).toBe(0)
    expect(matrix.noneCount).toBe(0)
    expect(matrix.coveredFeatureCount).toBe(2)
    expect(matrix.uncoveredFeatureCount).toBe(0)
  })

  it('部分特征获支持 → partial 并列出未覆盖特征', () => {
    const matrix = checkEmbodimentCoverage([entry('claim_1', ['导电涂层', '散热结构'], ['实施例1记载导电涂层'])])
    expect(matrix.items[0]).toMatchObject({ coverage: 'partial', featureCount: 2, uncovered: ['散热结构'] })
    expect(matrix.partialCount).toBe(1)
    expect(matrix.coveredFeatureCount).toBe(1)
    expect(matrix.uncoveredFeatureCount).toBe(1)
  })

  it('无实施例引用 → none，全部特征未覆盖', () => {
    const matrix = checkEmbodimentCoverage([entry('claim_1', ['导电涂层', '散热结构'], [])])
    expect(matrix.items[0]).toMatchObject({ coverage: 'none', featureCount: 2, uncovered: ['导电涂层', '散热结构'] })
    expect(matrix.noneCount).toBe(1)
    expect(matrix.coveredFeatureCount).toBe(0)
  })

  it('重复与空白特征去重，聚合数为去重后的特征数', () => {
    const matrix = checkEmbodimentCoverage([
      entry('claim_1', ['导电涂层', ' 导电涂层 ', '散热结构'], ['导电涂层']),
    ])
    expect(matrix.items[0]).toMatchObject({ featureCount: 2, uncovered: ['散热结构'] })
    expect(matrix.coveredFeatureCount).toBe(1)
    expect(matrix.uncoveredFeatureCount).toBe(1)
  })

  it('特征按整串出现判定，命中某实施例引用即视为覆盖', () => {
    const matrix = checkEmbodimentCoverage([
      entry('claim_1', ['驱动电机'], ['实施例3公开了驱动电机与减速器']),
    ])
    expect(matrix.items[0]).toMatchObject({ coverage: 'full' })
  })
})

describe('checkEmbodimentCoverage: 编号断档与非法条目', () => {
  it('编号断档按升序推断', () => {
    const matrix = checkEmbodimentCoverage([
      entry('claim_1', ['a'], ['a']),
      entry('claim_3', ['b'], ['b']),
    ])
    expect(matrix.gaps).toEqual([2])
  })

  it('条目编号非法时不推断断档，只逐条标注原因', () => {
    const matrix = checkEmbodimentCoverage([
      entry('claim_1', ['a'], ['a']),
      entry('claim_x', ['b'], ['b']),
      entry('claim_3', ['c'], ['c']),
    ])
    expect(matrix.gaps).toEqual([])
    expect(matrix.items).toHaveLength(3)
    expect(matrix.items[1]).toEqual({
      claimId: 'claim_x',
      valid: false,
      invalidReason: 'claim id 格式非法（应为 claim_<n>）',
    })
    expect(matrix.fullCount).toBe(2)
  })

  it('编号超出上限 → 非法（含 0 与上限值）', () => {
    const matrix = checkEmbodimentCoverage([
      entry(`claim_${MAX_CLAIM_NUMBER}`, ['a'], ['a']),
      entry(`claim_${MAX_CLAIM_NUMBER + 1}`, ['a'], ['a']),
      entry('claim_0', ['a'], ['a']),
    ])
    expect(matrix.items.map(item => item.valid)).toEqual([true, false, false])
    expect(matrix.items[1]).toMatchObject({ invalidReason: 'claim 编号超出上限（1..1000）' })
    expect(matrix.items[2]).toMatchObject({ invalidReason: 'claim 编号超出上限（1..1000）' })
  })

  it('编号超出申请的权利要求总数 → 非法', () => {
    const matrix = checkEmbodimentCoverage([entry('claim_5', ['a'], ['a'])], 2)
    expect(matrix.items[0]).toEqual({
      claimId: 'claim_5',
      valid: false,
      invalidReason: 'claim 编号超出权利要求数量',
    })
  })

  it('提供权利要求总数且编号均合法时不产生断档', () => {
    const matrix = checkEmbodimentCoverage([
      entry('claim_2', ['b'], ['b']),
      entry('claim_1', ['a'], ['a']),
    ], 2)
    expect(matrix.gaps).toEqual([])
    expect(matrix.items[0]).toMatchObject({ claimNumber: 2 })
    expect(matrix.fullCount).toBe(2)
  })

  it('空条目列表返回空矩阵', () => {
    expect(checkEmbodimentCoverage([])).toEqual({
      items: [],
      fullCount: 0,
      partialCount: 0,
      noneCount: 0,
      coveredFeatureCount: 0,
      uncoveredFeatureCount: 0,
      gaps: [],
    })
  })
})
