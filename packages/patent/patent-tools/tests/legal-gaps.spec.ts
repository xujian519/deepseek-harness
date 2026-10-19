import { describe, expect, it } from 'vitest'
import type { PipelineState } from '@deepseek-ai/dsh-patent-core'
import {
  LEGAL_GAP_CHECKS,
  LEGAL_GAP_PROFILES,
  LegalGapsHandler,
  legalGapsAtom,
  type LegalGapItem,
} from '../src/atoms/legal-gaps.ts'

/**
 * 运行 legal-gaps 并取出汇总项。
 * @param state - 阶段执行态。
 * @returns `legal_gaps_items`（非数组时为空）。
 */
async function itemsOf(state: PipelineState): Promise<LegalGapItem[]> {
  const out = await new LegalGapsHandler().execute({ state })
  const items = out['legal_gaps_items']
  return Array.isArray(items) ? (items as LegalGapItem[]) : []
}

describe('legal-gaps 原子', () => {
  it('声明 profile 输入与四项输出，并覆盖全部案件类型', () => {
    expect(legalGapsAtom.name).toBe('legal-gaps')
    expect(legalGapsAtom.inputSchema).toContain('profile')
    expect(legalGapsAtom.inputSchema).toEqual(expect.arrayContaining([
      'evidence_check_report',
      'novelty',
      'inventiveness',
      'prior_art_defense_report',
    ]))
    expect(legalGapsAtom.outputSchema).toEqual([
      'legal_gaps_report',
      'legal_gaps_passed',
      'legal_gaps_items',
      'legal_gaps_unassessed',
    ])
    expect(Object.keys(LEGAL_GAP_CHECKS).sort()).toEqual([...LEGAL_GAP_PROFILES].sort())
    for (const checks of Object.values(LEGAL_GAP_CHECKS)) {
      for (const check of checks) {
        expect(check.provision.trim().length).toBeGreaterThan(0)
        expect(check.label.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('答复清单：两项检查均通过时判定通过，并给出法条依据', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'oa-response',
        response_check_report: '答复规范检查：通过',
        response_check_passed: true,
        response_check_unevaluated: [],
        amendment_basis_report: '修改依据检查：通过',
        amendment_basis_passed: true,
        amendment_basis_scope: '原始权利要求书、原说明书',
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual([])
    const report = String(out['legal_gaps_report'])
    expect(report).toContain('无阻断项')
    expect(report).toContain('专利法第26条第3款')
    expect(report).toContain('专利法第33条')
    expect(report).toContain('不替代审查意见')
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.every(item => item.status === 'passed')).toBe(true)
  })

  it('答复清单：答复检查失败时形成阻断项（G-13 反例）', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'oa-response',
        response_check_report: '答复规范检查：未通过（1 条违规）',
        response_check_passed: false,
        amendment_basis_report: '修改依据检查：通过',
        amendment_basis_passed: true,
      },
    })
    expect(out['legal_gaps_passed']).toBe(false)
    const report = String(out['legal_gaps_report'])
    expect(report).toContain('未通过')
    expect(report).toContain('1 项阻断')
    expect(report).toContain('response_check_passed = false')
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'response-compliance')).toMatchObject({
      status: 'failed',
      severity: 'block',
    })
  })

  it('答复清单：待核项记为未评估，但不形成阻断', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'oa-response',
        response_check_report: '答复规范检查：通过（1 项未评估）',
        response_check_passed: true,
        response_check_unevaluated: [{ rule: 'PR-OA-008', reason: '缺少通知书' }],
        amendment_basis_report: '修改依据检查：通过',
        amendment_basis_passed: true,
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual(['response-compliance'])
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'response-compliance')?.evidence).toContain('1 项待核')
  })

  it('答复清单：未检测到修改后权利要求时 A33 记不适用', async () => {
    const items = await itemsOf({
      profile: 'oa-response',
      response_check_report: '答复规范检查：通过',
      response_check_passed: true,
      amendment_basis_report: '修改依据检查：通过（A33 不适用）',
      amendment_basis_passed: true,
      amendment_basis_scope: '未检测到修改后权利要求',
    })
    expect(items.find(item => item.id === 'amendment-basis')?.status).toBe('not-applicable')
  })

  it('没有任何检查产出时列出全部法条为未评估，不空转（G-13 反例）', async () => {
    const out = await new LegalGapsHandler().execute({ state: { profile: 'oa-response' } })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual(['response-compliance', 'amendment-basis'])
    const report = String(out['legal_gaps_report'])
    expect(report).toContain('2 项未评估')
    expect(report).toContain('专利法第26条第3款')
    expect(report).toContain('专利法第33条')
    expect(report).toContain('未被任何确定性阶段覆盖')
  })

  it('新颖性清单：时间基准缺失时 A22.5 记未评估', async () => {
    const items = await itemsOf({
      profile: 'novelty',
      novelty_conclusion: '权利要求 1 具备新颖性',
    })
    expect(items.find(item => item.id === 'time-baseline')).toMatchObject({
      status: 'not-assessed',
      provision: '专利法第22条第5款',
    })
    expect(items.find(item => item.id === 'novelty')?.status).toBe('passed')
  })

  it('披露清单：eligibility 失败形成阻断项', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'disclosure',
        eligibility_report: '可专利客体筛查：未通过',
        eligibility_passed: false,
        eligibility_pending: [],
      },
    })
    expect(out['legal_gaps_passed']).toBe(false)
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'eligibility')).toMatchObject({
      status: 'failed',
      severity: 'block',
      provision: '专利法第2条第2款、第5条、第25条',
    })
  })

  it('无效清单：证据审查失败形成阻断项，新颖性与创造性理由按阶段产出判定', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'invalidation',
        evidence_check_report: '证据审查（无效/复审）：未通过（1 条阻断）',
        evidence_check_passed: false,
        evidence_check_pending: [],
        novelty: '权利要求 1 不具备新颖性（D1 单独公开全部特征）',
        inventiveness: '权利要求 1 不具备创造性',
      },
    })
    expect(out['legal_gaps_passed']).toBe(false)
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'evidence')).toMatchObject({
      status: 'failed',
      severity: 'block',
      provision: '审查指南第四部分第三章4.3.2',
    })
    expect(items.find(item => item.id === 'novelty')?.status).toBe('passed')
    expect(items.find(item => item.id === 'inventiveness')?.status).toBe('passed')
    expect(out['legal_gaps_unassessed']).toEqual([])
  })

  it('无效清单：证据审查未执行时记为未评估，不把缺证据当成证据合格', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'invalidation',
        evidence_check_report: '证据审查（无效/复审）：未执行（未提供证据清单）',
        evidence_check_passed: true,
        evidence_check_pending: [],
        novelty: '权利要求 1 具备新颖性',
        inventiveness: '权利要求 1 具备创造性',
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual(['evidence'])
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'evidence')?.evidence).toContain('本次未执行')
  })

  it('无效清单：降级输出不算已评估', async () => {
    const items = await itemsOf({
      profile: 'invalidation',
      evidence_check_report: '证据审查（无效/复审）：未执行（未提供证据清单）',
      evidence_check_passed: true,
      novelty: '[WORKFLOW_DEGRADED] novelty: 模型调用失败',
      inventiveness: '[WORKFLOW_DEGRADED] inventiveness: 模型调用失败',
    })
    expect(items.find(item => item.id === 'novelty')?.status).toBe('not-assessed')
    expect(items.find(item => item.id === 'inventiveness')?.status).toBe('not-assessed')
  })

  it('侵权清单：保护范围按要素网格与覆盖结论判定，现有技术抗辩尚无确定性产出', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'infringement',
        claim_chart_doc: '{"claims":[{"id":"1"}],"targets":[]}',
        coverage_report: '{"verdict":"no-literal-infringement"}',
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual(['prior-art-defense'])
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'protection-scope')).toMatchObject({
      status: 'passed',
      provision: '专利法第59条',
    })
    expect(items.find(item => item.id === 'prior-art-defense')).toMatchObject({
      status: 'not-assessed',
      provision: '专利法第62条',
    })
  })

  it('披露清单：检索过滤、权项支持与说明书检查分别覆盖宽限期、A26.4 与 A26.3', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'disclosure',
        eligibility_report: '可专利客体筛查：通过',
        eligibility_passed: true,
        eligibility_pending: [],
        reference_date: '2024-06-01',
        prior_art_filter_report: '现有技术过滤：排除 1 篇晚于截止日的文献',
        novelty_result: '逐特征新颖性初判：具备新颖性',
        spec_check_report: '权利要求合规检查：通过',
        spec_check_passed: true,
        specification_check_report: '说明书合规检查：通过',
        specification_check_passed: true,
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual([])
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'grace-period')?.status).toBe('passed')
    expect(items.find(item => item.id === 'claim-support')?.status).toBe('passed')
    expect(items.find(item => item.id === 'enablement')).toMatchObject({
      status: 'passed',
      provision: '专利法第26条第3款',
    })
  })

  it('披露清单：说明书检查未通过时充分公开记为未通过但不阻断', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'disclosure',
        specification_check_report: '说明书合规检查：未通过（缺少必要章节）',
        specification_check_passed: false,
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'enablement')).toMatchObject({
      status: 'failed',
      severity: 'warn',
    })
  })

  it('创造性清单：技术问题校验失败形成阻断项，结论阶段产出覆盖 A22.3', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'inventiveness',
        problem_check_report: '技术问题校验：未通过（问题包含解决手段）',
        problem_check_passed: false,
        conclude: '创造性结论：不具备创造性',
      },
    })
    expect(out['legal_gaps_passed']).toBe(false)
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'problem')).toMatchObject({
      status: 'failed',
      severity: 'block',
      provision: '专利法第22条第3款',
    })
    expect(items.find(item => item.id === 'inventiveness')?.status).toBe('passed')
    expect(out['legal_gaps_unassessed']).toEqual(['time-baseline', 'grace-period'])
  })

  it('可专利性清单：客体、权项支持与充分公开通过，缺时间基准与宽限期产出时记未评估', async () => {
    const out = await new LegalGapsHandler().execute({
      state: {
        profile: 'patentability',
        eligibility_report: '可专利客体筛查：通过',
        eligibility_passed: true,
        eligibility_pending: [],
        spec_check_report: '权利要求合规检查：通过',
        spec_check_passed: true,
        specification_check_report: '说明书合规检查：通过',
        specification_check_passed: true,
      },
    })
    expect(out['legal_gaps_passed']).toBe(true)
    expect(out['legal_gaps_unassessed']).toEqual(['time-baseline', 'grace-period'])
    const items = out['legal_gaps_items'] as LegalGapItem[]
    expect(items.find(item => item.id === 'eligibility')?.status).toBe('passed')
    expect(items.find(item => item.id === 'claim-support')?.status).toBe('passed')
    expect(items.find(item => item.id === 'enablement')?.status).toBe('passed')
  })

  it('profile 缺失或未知时降级，不猜测案件类型', async () => {
    const missing = await new LegalGapsHandler().execute({ state: {} })
    expect(String(missing['_error'])).toContain('params.profile')
    const unknown = await new LegalGapsHandler().execute({ state: { profile: 'unknown' } })
    expect(String(unknown['_error'])).toContain('params.profile')
  })

  it('数组形式的评估产出算已评估', async () => {
    const items = await itemsOf({
      profile: 'novelty',
      compare: [{ citationId: 'D1' }],
    })
    expect(items.find(item => item.id === 'novelty')).toMatchObject({
      status: 'passed',
      evidence: '已由 state.compare 评估',
    })
  })

  it('显式 null 的评估键不算已评估', async () => {
    const items = await itemsOf({
      profile: 'novelty',
      reference_date: null,
    })
    expect(items.find(item => item.id === 'time-baseline')?.status).toBe('not-assessed')
  })
})
