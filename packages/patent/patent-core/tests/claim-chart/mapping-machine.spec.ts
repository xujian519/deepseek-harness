import { expect, it } from 'vitest'
import {
  deriveDistinguishingFeatures,
  deriveNoveltyCoverage,
  deriveNoveltyCoverageByClaim,
  validateRowMapping,
} from '@deepseek-ai/dsh-patent-core'
import type { ChartRow, ChartTarget, ClaimElement, ClaimRef } from '@deepseek-ai/dsh-patent-core'

const ELEMENTS: ClaimElement[] = [
  { id: '1a', claimNo: 1, text: '包括壳体', kind: 'limitation' },
  { id: '1b', claimNo: 1, text: '和滤芯', kind: 'limitation' },
  { id: '1c', claimNo: 1, text: '所述滤芯含有活性炭', kind: 'limitation' },
]

const D1: ChartTarget = { id: 'D1', kind: 'prior-art' }
const PRODUCT: ChartTarget = { id: '产品A', kind: 'accused-product' }

function row(elementId: string, targetId: string, mapping: ChartRow['mapping']): ChartRow {
  return { elementId, targetId, quote: '', pinCite: '', mapping, state: mapping, verified: false }
}

it('anticipation/obviousness-combination 仅限 prior-art 目标', () => {
  expect(validateRowMapping(row('1a', '产品A', 'anticipation'), PRODUCT, 'infringement')).toEqual([
    '行 [1a→产品A] 的 mapping "anticipation" 仅适用于 prior-art 目标',
  ])
  expect(validateRowMapping(row('1a', 'D1', 'anticipation'), D1, 'invalidity')).toEqual([])
})

it('doe 仅限侵权模式', () => {
  expect(validateRowMapping(row('1a', '产品A', 'doe'), PRODUCT, 'invalidity').length).toBe(1)
  expect(validateRowMapping(row('1a', '产品A', 'doe'), PRODUCT, 'infringement')).toEqual([])
})

it('新颖性单篇全覆盖推导：有缺口时不覆盖', () => {
  const rows = [row('1a', 'D1', 'literal'), row('1b', 'D1', 'literal'), row('1c', 'D1', 'not-found')]
  const res = deriveNoveltyCoverage(rows, 'D1', ELEMENTS)
  expect(res.covered).toBe(false)
  expect(res.missing).toEqual(['1c'])
})

it('新颖性单篇全覆盖推导：anticipation 计入覆盖', () => {
  const rows = [
    row('1a', 'D1', 'anticipation'),
    row('1b', 'D1', 'literal'),
    row('1c', 'D1', 'literal-construction-dependent'),
  ]
  const res = deriveNoveltyCoverage(rows, 'D1', ELEMENTS)
  expect(res.covered).toBe(true)
  expect(res.missing).toEqual([])
})

it('区别特征 = 主目标上 not-found/needs-evidence 的要素', () => {
  const rows = [
    row('1a', 'D1', 'literal'),
    row('1b', 'D1', 'not-found'),
    row('1c', 'D1', 'needs-evidence'),
    row('1c', 'D2', 'literal'),
  ]
  expect(deriveDistinguishingFeatures(rows, 'D1', ELEMENTS)).toEqual(['1b', '1c'])
})

// ── 逐权项单篇全覆盖（从属权项并入引用链） ──────────────────────────────────

const TWO_CLAIMS: ClaimElement[] = [
  { id: '1a', claimNo: 1, text: '包括壳体', kind: 'limitation' },
  { id: '1b', claimNo: 1, text: '和滤芯', kind: 'limitation' },
  { id: '2a', claimNo: 2, text: '根据权利要求1所述的装置', kind: 'preamble' },
  { id: '2b', claimNo: 2, text: '所述滤芯为折叠式', kind: 'limitation' },
  { id: '3a', claimNo: 3, text: '根据权利要求2所述的装置', kind: 'preamble' },
  { id: '3b', claimNo: 3, text: '所述壳体为塑料', kind: 'limitation' },
]

const CHAIN: ClaimRef[] = [
  { claimNo: 1, claimType: 'independent', refersTo: [] },
  { claimNo: 2, claimType: 'dependent', refersTo: [1] },
  { claimNo: 3, claimType: 'dependent', refersTo: [2] },
]

it('逐权项覆盖：独立权项只看自身要素', () => {
  const rows = [row('1a', 'D1', 'literal'), row('1b', 'D1', 'literal')]
  const [first] = deriveNoveltyCoverageByClaim(rows, 'D1', TWO_CLAIMS, CHAIN)
  expect(first).toEqual({
    claimNo: 1,
    covered: true,
    missing: [],
    includesReferredClaims: false,
    referredClaimNos: [],
  })
})

it('逐权项覆盖：从属权项并入所引用权项的全部要素（传递闭包）', () => {
  // 权 2 的附加特征被 D1 公开，但权 1 的 1b 未公开 —— 权 2 同样未全覆盖。
  const rows = [
    row('1a', 'D1', 'literal'),
    row('1b', 'D1', 'not-found'),
    row('2a', 'D1', 'literal'),
    row('2b', 'D1', 'literal'),
  ]
  const coverage = deriveNoveltyCoverageByClaim(rows, 'D1', TWO_CLAIMS, CHAIN)
  const second = coverage.find(entry => entry.claimNo === 2)
  expect(second?.covered).toBe(false)
  expect(second?.missing).toEqual(['1b'])
  expect(second?.includesReferredClaims).toBe(true)
  expect(second?.referredClaimNos).toEqual([1])
})

it('逐权项覆盖：多级从属取引用链的并集', () => {
  const rows = [
    row('1a', 'D1', 'literal'),
    row('1b', 'D1', 'literal'),
    row('2a', 'D1', 'literal'),
    row('2b', 'D1', 'literal'),
    row('3a', 'D1', 'literal'),
    row('3b', 'D1', 'not-found'),
  ]
  const third = deriveNoveltyCoverageByClaim(rows, 'D1', TWO_CLAIMS, CHAIN).find(entry => entry.claimNo === 3)
  expect(third?.referredClaimNos).toEqual([1, 2])
  expect(third?.missing).toEqual(['3b'])
})

it('逐权项覆盖：缺引用关系时按独立权项处理（不臆造引用）', () => {
  const rows = [row('2a', 'D1', 'literal'), row('2b', 'D1', 'literal')]
  const second = deriveNoveltyCoverageByClaim(rows, 'D1', TWO_CLAIMS, []).find(entry => entry.claimNo === 2)
  expect(second?.covered).toBe(true)
  expect(second?.includesReferredClaims).toBe(false)
})
