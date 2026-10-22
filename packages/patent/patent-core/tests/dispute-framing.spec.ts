import { describe, expect, it } from 'vitest'
import {
  DisputeFramingHandler,
  DisputeFramingRefineHandler,
  frameDispute,
  refineDispute,
  scanClaimNumbers,
  scanDisputeText,
} from '@deepseek-ai/dsh-patent-core'

describe('争议粗定位', () => {
  it('从正文识别法条与权项区间', () => {
    const scanned = scanDisputeText('审查员认为权利要求 1-3 不具备创造性，不符合专利法第22条第3款的规定。')
    expect(scanned.statutes).toContain('A22.3')
    expect(scanned.claims).toEqual([1, 2, 3])
  })

  it('识别短式 A22.2 / A26.4 与中文条款号', () => {
    const scanned = scanDisputeText('A22.2 与 A26.4 均被援引；另见专利法第二十六条第三款。')
    expect(scanned.statutes.sort()).toEqual(['A22.2', 'A26.3', 'A26.4'])
  })

  it('权项列表去重、排序并展开区间', () => {
    expect(scanClaimNumbers('权利要求1、3、3-5和2')).toEqual([1, 2, 3, 4, 5])
  })

  it('优先使用 office_action 的结构化驳回类型与涉及权项', () => {
    const framing = frameDispute({
      office_action: JSON.stringify({ rejectionTypes: ['inventiveness', 'claim-clarity'], affectedClaims: [1, 2] }),
      input: '不应优先扫描这段文本 A22.2',
    })
    expect(framing?.source).toBe('office-action')
    expect(framing?.candidates.map(candidate => candidate.statute).sort()).toEqual(['A22.3', 'A26.4'])
    expect(framing?.claims).toEqual([1, 2])
  })

  it('grounds 中的否定表述不计入候选', () => {
    const framing = frameDispute({
      grounds: JSON.stringify([
        { ground: 'inventiveness', article: '专利法第22条第3款', label: '创造性', negated: false },
        { ground: 'novelty', article: '专利法第22条第2款', label: '新颖性', negated: true },
      ]),
      input: '正文',
    })
    expect(framing?.source).toBe('grounds')
    expect(framing?.candidates.map(candidate => candidate.statute)).toEqual(['A22.3'])
  })

  it('无结构化产出时扫描正文；无任何材料时返回 undefined', () => {
    expect(frameDispute({ input: '权利要求 1 不具备新颖性，A22.2。' })?.source).toBe('text')
    expect(frameDispute({})).toBeUndefined()
  })

  it('handler 无材料时降级，不猜测争议', async () => {
    const out = await new DisputeFramingHandler().execute({ state: {} })
    expect(String(out['_error'])).toContain('缺少争议定位材料')
  })

  it('handler 输出报告、候选、权项与来源', async () => {
    const out = await new DisputeFramingHandler().execute({
      state: { input: '权利要求 1-2 不具备创造性，专利法第22条第3款。' },
    })
    expect(out['dispute_framing_report']).toContain('A22.3')
    expect(out['dispute_framing_candidates']).toEqual([
      { statute: 'A22.3', label: '专利法第22条第3款（创造性）', source: 'text' },
    ])
    expect(out['dispute_framing_claims']).toEqual([1, 2])
    expect(out['dispute_framing_source']).toBe('text')
  })
})

describe('争议定位修正', () => {
  const candidates = [
    { statute: 'A22.3', label: '专利法第22条第3款（创造性）', source: 'text' as const },
    { statute: 'A59', label: '专利法第59条（保护范围）', source: 'text' as const },
  ]

  it('时间基准已锁定时标注 locked，且不改写时间基准', async () => {
    const state = {
      dispute_framing_candidates: candidates,
      reference_date: '2024-01-01',
      time_baseline_report: '现有技术时间基准：2024-01-01',
    }
    const refined = refineDispute(state)
    expect(refined.timeBasis).toBe('locked')
    expect(refined.candidates.find(candidate => candidate.statute === 'A22.3')).toMatchObject({
      timeDependent: true,
      timeBasis: 'locked',
    })
    expect(refined.candidates.find(candidate => candidate.statute === 'A59')).toMatchObject({
      timeDependent: false,
      timeBasis: 'locked',
    })
    const out = await new DisputeFramingRefineHandler().execute({ state })
    expect(out['time_basis_status']).toBe('locked')
    expect(out['dispute_framing_refined']).toContain('2024-01-01')
    // 修正阶段只读时间基准：返回片段不得携带任何时间基准键。
    expect(out).not.toHaveProperty('reference_date')
    expect(out).not.toHaveProperty('time_baseline_report')
  })

  it('时间基准缺失时标为 unverified，保留候选但不改基准', () => {
    const state = { dispute_framing_candidates: candidates }
    const refined = refineDispute(state)
    expect(refined.timeBasis).toBe('unverified')
    expect(refined.candidates.find(candidate => candidate.statute === 'A22.3')?.timeBasis).toBe('unverified')
    expect(state).toEqual({ dispute_framing_candidates: candidates })
  })

  it('时间基准降级文本不当作已锁定', () => {
    expect(refineDispute({
      dispute_framing_candidates: candidates,
      reference_date: '[WORKFLOW_DEGRADED] 缺少申请日',
    }).timeBasis).toBe('unverified')
  })

  it('无候选时输出空集报告，不报错', () => {
    const refined = refineDispute({})
    expect(refined.candidates).toEqual([])
    expect(refined.report).toContain('保持空集')
  })
})
