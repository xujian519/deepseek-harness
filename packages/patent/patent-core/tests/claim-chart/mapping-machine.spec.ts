import { expect, it } from 'vitest'
import {
  deriveDistinguishingFeatures,
  deriveNoveltyCoverage,
  validateRowMapping,
} from '@deepseek-ai/dsh-patent-core'
import type { ChartRow, ChartTarget, ClaimElement } from '@deepseek-ai/dsh-patent-core'

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
