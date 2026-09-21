import { describe, expect, it } from 'vitest'
import {
  AMENDMENT_ACTION_LABELS,
  REJECTION_AMENDMENT_ACTIONS,
  REJECTION_BASIS,
  REJECTION_SECTIONS,
  REJECTION_STRATEGY,
  STRATEGY_LABELS,
  isAmendmentStrategy,
  strategiesFor,
  summarizeStrategies,
} from '../../src/response/strategy.ts'
import { REJECTION_ORDER, REJECTION_SHORT_LABELS } from '../../src/notice/office-action.ts'
import type { NoticeRejectionType } from '../../src/notice/office-action.ts'
import {
  AMENDMENT_ACTION_CASES,
  BASIS_CASES,
  STRATEGY_CASES,
} from '../fixtures/from-mady/response.ts'

// 上游策略、修改动作与法条依据的用例与取值对照在 tests/fixtures/from-mady/response.ts
// （含上游路径与提交）。无 note 的对照项断言与上游一致，有 note 的断言本模块改写后的取值。

/** 含 `other` 的全部驳回类型，用于遍历四张表的键集。 */
const ALL_TYPES: readonly NoticeRejectionType[] = [...REJECTION_ORDER, 'other']

/** 上游按"权利要求 1 / 其余权项"两分支判定修改动作。 */
function kindOf(claimNumber: number): 'independent' | 'dependent' {
  return claimNumber === 1 ? 'independent' : 'dependent'
}

describe('response 策略表', () => {
  it('四张表的键集与驳回类型一致', () => {
    expect(Object.keys(REJECTION_STRATEGY).sort()).toEqual([...ALL_TYPES].sort())
    expect(Object.keys(REJECTION_AMENDMENT_ACTIONS).sort()).toEqual([...ALL_TYPES].sort())
    expect(Object.keys(REJECTION_BASIS).sort()).toEqual([...ALL_TYPES].sort())
    expect(Object.keys(REJECTION_SECTIONS).sort()).toEqual([...ALL_TYPES].sort())
  })

  it('策略取值与标签覆盖闭集', () => {
    for (const type of ALL_TYPES) {
      expect(Object.keys(STRATEGY_LABELS)).toContain(REJECTION_STRATEGY[type])
    }
    expect(STRATEGY_LABELS).toEqual({ argument: '争辩', amendment: '修改', combined: '争辩+修改' })
  })

  it('修改动作取值与标签覆盖闭集', () => {
    for (const type of ALL_TYPES) {
      const actions = REJECTION_AMENDMENT_ACTIONS[type]
      expect(Object.keys(AMENDMENT_ACTION_LABELS)).toContain(actions.independent)
      expect(Object.keys(AMENDMENT_ACTION_LABELS)).toContain(actions.dependent)
    }
    expect(AMENDMENT_ACTION_LABELS).toEqual({
      clarify: '澄清限定',
      narrow: '限缩',
      delete: '删除',
      'adjust-reference': '从属引用调整',
      none: '无需修改',
    })
  })

  it.each(STRATEGY_CASES)('上游答复策略一致（$type）', ({ type, upstream, ours, note }) => {
    expect(REJECTION_STRATEGY[type]).toBe(ours)
    if (note === undefined) expect(REJECTION_STRATEGY[type]).toBe(upstream)
  })

  it.each(AMENDMENT_ACTION_CASES)(
    '上游修改动作对照（$type 权利要求 $claimNumber）',
    ({ type, claimNumber, upstream, ours, note }) => {
      expect(REJECTION_AMENDMENT_ACTIONS[type][kindOf(claimNumber)]).toBe(ours)
      if (note === undefined) expect(AMENDMENT_ACTION_LABELS[ours]).toBe(upstream)
    },
  )

  it.each(BASIS_CASES)('上游法条依据对照（$type）', ({ type, upstream, ours, note }) => {
    expect(REJECTION_BASIS[type]).toBe(ours)
    if (note === undefined) expect(REJECTION_BASIS[type]).toBe(upstream)
  })

  it('未识别条款用组合策略兜底且不产生修改', () => {
    expect(REJECTION_STRATEGY.other).toBe('combined')
    expect(REJECTION_AMENDMENT_ACTIONS.other).toEqual({ independent: 'none', dependent: 'none' })
    expect(REJECTION_BASIS.other).toContain('人工判读')
  })

  it('每条理由都有必答段落', () => {
    for (const type of ALL_TYPES) expect(REJECTION_SECTIONS[type].length).toBeGreaterThan(0)
  })

  it('isAmendmentStrategy 只对修改与组合策略为真', () => {
    expect(isAmendmentStrategy('amendment')).toBe(true)
    expect(isAmendmentStrategy('combined')).toBe(true)
    expect(isAmendmentStrategy('argument')).toBe(false)
  })

  it('strategiesFor 保序', () => {
    expect(strategiesFor(['inventiveness', 'clarity', 'novelty'])).toEqual([
      'argument',
      'amendment',
      'argument',
    ])
    expect(strategiesFor([])).toEqual([])
  })

  it('summarizeStrategies 用简称与会话标签渲染摘要', () => {
    expect(summarizeStrategies(['inventiveness', 'clarity'])).toBe('创造性→争辩、不清楚→修改')
    expect(summarizeStrategies([])).toBe('综合答复')
  })

  it('简称表与 notice 模块共用一份', () => {
    expect(REJECTION_SHORT_LABELS.other).toBe('未识别条款')
    expect(summarizeStrategies(['other'])).toBe('未识别条款→争辩+修改')
  })
})
