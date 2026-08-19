import { expect, it } from 'vitest'
import {
  DEGRADATION_SUFFIX,
  degradationSummary,
  getDegradationMark,
  isDegraded,
  markDegraded,
  type GraphState,
  type StateDelta,
} from '@deepseek-ai/dsh-patent-core'

it('markDegraded: 写 fallback 值与并列降级标记', () => {
  const delta: StateDelta = {}
  markDegraded(delta, 'prior_art', [], 'search_failed', '检索失败', 'warning')
  expect(delta.prior_art).toEqual([])
  expect(delta[`prior_art${DEGRADATION_SUFFIX}`]).toEqual({
    reason: 'search_failed',
    message: '检索失败',
    severity: 'warning',
  })
})

it('isDegraded / getDegradationMark: 读取标记', () => {
  const state: GraphState = {}
  const delta: StateDelta = {}
  markDegraded(delta, 'features', [], 'llm_unavailable', 'LLM 不可用')
  Object.assign(state, delta)
  expect(isDegraded(state, 'features')).toBe(true)
  expect(isDegraded(state, 'other')).toBe(false)
  expect(getDegradationMark(state, 'features')).toEqual({
    reason: 'llm_unavailable',
    message: 'LLM 不可用',
    severity: 'warning',
  })
  expect(getDegradationMark(state, 'other')).toBeUndefined()
})

it('degradationSummary: 汇总全部标记（按 key 字典序）', () => {
  const state: GraphState = {}
  const a: StateDelta = {}
  const b: StateDelta = {}
  markDegraded(a, 'prior_art', [], 'search_failed', '检索失败', 'critical')
  markDegraded(b, 'features', [], 'llm_unavailable', 'LLM 不可用')
  Object.assign(state, a, b)
  state['normal_key'] = '正常数据'
  const summary = degradationSummary(state)
  expect(summary.length).toBe(2)
  // 字典序：features__degradation < prior_art__degradation
  expect(summary[0]?.reason).toBe('llm_unavailable')
  expect(summary[1]?.reason).toBe('search_failed')
})

it('degradationSummary: 结构异常的标记 key 被忽略', () => {
  const state: GraphState = { [`bad${DEGRADATION_SUFFIX}`]: 'not-an-object' }
  expect(degradationSummary(state)).toEqual([])
})
