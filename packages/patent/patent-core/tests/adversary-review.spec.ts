import { describe, expect, it } from 'vitest'
import {
  AdversaryReviewHandler,
  adversaryReviewAtom,
  ADVERSARY_REVIEW_FORBIDDEN_KEYS,
  checkAdversaryReviewIsolation,
  extractAdversaryReviewEvent,
  reviewFinalDraft,
  detectMissedRejections,
  detectEvidenceGaps,
  assessArgumentStrength,
  computeReviewConfidence,
  buildReviewSummary,
  globalAtomRegistry,
  globalStageHandlerRegistry,
  registerBuiltinAtoms,
} from '@deepseek-ai/dsh-patent-core'
import type {
  AdversaryReviewReport,
  AdversaryReviewInput,
  AdversaryReviewOfficeAction,
} from '@deepseek-ai/dsh-patent-core'

// 注册内置原子（幂等操作）
registerBuiltinAtoms()

describe('adversary-review atom', () => {
  it('atom 声明正确', () => {
    expect(adversaryReviewAtom.name).toBe('adversary-review')
    expect(adversaryReviewAtom.category).toBe('gate')
    expect(adversaryReviewAtom.usesModel).toBe(false)
    expect(adversaryReviewAtom.inputSchema).toEqual([
      'final_draft',
      'reference_documents',
      'claims',
      'office_action',
    ])
    expect(adversaryReviewAtom.outputSchema).toEqual([
      'adversary_review_report',
      'adversary_review_disputes',
      'adversary_review_confidence',
      'adversary_review_full_report',
      '_adversary_review_event',
    ])
  })

  it('inputSchema 不包含禁止键', () => {
    for (const key of ADVERSARY_REVIEW_FORBIDDEN_KEYS) {
      expect(adversaryReviewAtom.inputSchema).not.toContain(key)
    }
    // 特别检查：不能包含己方中间推理键
    expect(adversaryReviewAtom.inputSchema).not.toContain('dispute_framing_report')
    expect(adversaryReviewAtom.inputSchema).not.toContain('claim_chart')
    expect(adversaryReviewAtom.inputSchema).not.toContain('response_plan')
    expect(adversaryReviewAtom.inputSchema).not.toContain('draft')
  })

  it('handler 名称与 atom 一致', () => {
    const handler = new AdversaryReviewHandler()
    expect(handler.name).toBe('adversary-review')
    expect(handler.category).toBe('gate')
  })

  it('atom 注册成功', () => {
    const registered = globalAtomRegistry.lookup('adversary-review')
    expect(registered).toBeDefined()
    expect(registered?.name).toBe('adversary-review')
  })

  it('handler 注册成功', () => {
    const registered = globalStageHandlerRegistry.lookup('adversary-review')
    expect(registered).toBeDefined()
    expect(registered?.name).toBe('adversary-review')
  })
})

describe('ADVERSARY_REVIEW_FORBIDDEN_KEYS', () => {
  it('包含所有己方中间推理键', () => {
    expect(ADVERSARY_REVIEW_FORBIDDEN_KEYS).toContain('dispute_framing_report')
    expect(ADVERSARY_REVIEW_FORBIDDEN_KEYS).toContain('claim_chart')
    expect(ADVERSARY_REVIEW_FORBIDDEN_KEYS).toContain('draft')
    expect(ADVERSARY_REVIEW_FORBIDDEN_KEYS).toContain('response_plan')
    expect(ADVERSARY_REVIEW_FORBIDDEN_KEYS).toContain('response_plan_summary')
  })
})

describe('checkAdversaryReviewIsolation', () => {
  it('无禁止键时返回 clean=true', () => {
    const stateKeys = ['final_draft', 'reference_documents', 'claims', 'office_action']
    const result = checkAdversaryReviewIsolation(stateKeys)
    expect(result.clean).toBe(true)
    expect(result.leakedKeys).toEqual([])
  })

  it('检测到单个禁止键时 fail-closed', () => {
    const stateKeys = ['final_draft', 'response_plan', 'claims']
    const result = checkAdversaryReviewIsolation(stateKeys)
    expect(result.clean).toBe(false)
    expect(result.leakedKeys).toEqual(['response_plan'])
  })

  it('检测到多个禁止键', () => {
    const stateKeys = ['claim_chart', 'draft', 'final_draft']
    const result = checkAdversaryReviewIsolation(stateKeys)
    expect(result.clean).toBe(false)
    expect(result.leakedKeys).toContain('claim_chart')
    expect(result.leakedKeys).toContain('draft')
  })
})

describe('detectMissedRejections', () => {
  it('检测遗漏的驳回理由', () => {
    const finalDraft = '本申请具有创造性，符合专利法第22条第3款'
    const officeAction: AdversaryReviewOfficeAction = {
      rejectionTypes: ['inventiveness', 'novelty'],
      affectedClaims: [1, 2],
    }
    const missed = detectMissedRejections(finalDraft, officeAction)
    // 创造性被回应，新颖性未被回应
    expect(missed).toContain('novelty')
    expect(missed).not.toContain('inventiveness')
  })

  it('无驳回理由时返回空', () => {
    const missed = detectMissedRejections('test', { rejectionTypes: [] })
    expect(missed).toEqual([])
  })

  it('无通知书时返回空', () => {
    const missed = detectMissedRejections('test', undefined)
    expect(missed).toEqual([])
  })
})

describe('detectEvidenceGaps', () => {
  it('检测未引用对比文件', () => {
    const finalDraft = '本申请具有创造性'
    const referenceDocuments = 'CN1234567A 公开了一种方法'
    const gaps = detectEvidenceGaps(finalDraft, referenceDocuments, undefined)
    expect(gaps.length).toBeGreaterThan(0)
  })

  it('检测创造性论证缺失', () => {
    const finalDraft = '本申请符合专利法规定'
    const officeAction: AdversaryReviewOfficeAction = {
      rejectionTypes: ['inventiveness'],
    }
    const gaps = detectEvidenceGaps(finalDraft, '', officeAction)
    expect(gaps.some(g => g.includes('创造性'))).toBe(true)
  })

  it('无输入时返回空', () => {
    const gaps = detectEvidenceGaps('', '', undefined)
    expect(gaps).toEqual([])
  })
})

describe('assessArgumentStrength', () => {
  it('有遗漏驳回理由时返回 insufficient', () => {
    const strength = assessArgumentStrength(['novelty'], [], [])
    expect(strength).toBe('insufficient')
  })

  it('有多个证据缺口时返回 weak', () => {
    const strength = assessArgumentStrength([], ['gap1', 'gap2'], [])
    expect(strength).toBe('weak')
  })

  it('有高置信度争议点时返回 weak', () => {
    const disputes = [
      { statute: 'A22.3', claims: [1], point: 'test', relation: 'disagreement' as const, confidence: 0.9, tag: 'heuristic' as const },
    ]
    const strength = assessArgumentStrength([], [], disputes)
    expect(strength).toBe('weak')
  })

  it('无问题时返回 strong', () => {
    const strength = assessArgumentStrength([], [], [])
    expect(strength).toBe('strong')
  })
})

describe('computeReviewConfidence', () => {
  it('无争议点且论证充分时返回高置信度', () => {
    const confidence = computeReviewConfidence([], 'strong')
    expect(confidence).toBe(0.8)
  })

  it('无争议点但论证不足时返回低置信度', () => {
    const confidence = computeReviewConfidence([], 'insufficient')
    expect(confidence).toBe(0.5)
  })

  it('有争议点时基于加权平均计算', () => {
    const disputes = [
      { statute: 'A22.3', claims: [1], point: 'test', relation: 'disagreement' as const, confidence: 0.8, tag: 'heuristic' as const },
    ]
    const confidence = computeReviewConfidence(disputes, 'strong')
    expect(confidence).toBeGreaterThan(0)
    expect(confidence).toBeLessThanOrEqual(1)
  })
})

describe('buildReviewSummary', () => {
  it('生成可读摘要', () => {
    const summary = buildReviewSummary(['novelty'], ['gap1'], 'weak', 0.6)
    expect(summary).toContain('部分不足')
    expect(summary).toContain('遗漏')
    expect(summary).toContain('证据缺口')
    expect(summary).toContain('60.0%')
  })

  it('无问题时摘要显示充分', () => {
    const summary = buildReviewSummary([], [], 'strong', 0.8)
    expect(summary).toContain('充分')
    expect(summary).toContain('80.0%')
  })
})

describe('reviewFinalDraft', () => {
  it('完整流程：读取输入、生成报告', () => {
    const input: AdversaryReviewInput = {
      finalDraft: '本申请具有创造性，符合专利法第22条第3款',
      referenceDocuments: 'CN1234567A 公开了一种方法',
      claims: '权利要求1-2',
      officeAction: {
        rejectionTypes: ['inventiveness'],
        affectedClaims: [1, 2],
      },
    }
    const report = reviewFinalDraft(input)
    expect(report).toBeDefined()
    expect(report.argumentStrength).toBeDefined()
    expect(report.missedRejections).toBeDefined()
    expect(report.evidenceGaps).toBeDefined()
    expect(report.overallConfidence).toBeGreaterThanOrEqual(0)
    expect(report.overallConfidence).toBeLessThanOrEqual(1)
    expect(report.summary).toBeDefined()
  })

  it('无输入时仍生成报告', () => {
    const report = reviewFinalDraft({})
    expect(report).toBeDefined()
    expect(report.missedRejections).toEqual([])
    expect(report.overallConfidence).toBeGreaterThanOrEqual(0)
  })
})

describe('handler execute', () => {
  it('完整流程：读取输入、生成报告', async () => {
    const handler = new AdversaryReviewHandler()
    const state = {
      final_draft: '本申请具有创造性，符合专利法第22条第3款',
      reference_documents: 'CN1234567A 公开了一种方法',
      claims: '权利要求1-2',
      office_action: JSON.stringify({
        rejectionTypes: ['inventiveness'],
        affectedClaims: [1, 2],
      }),
    }
    const result = await handler.execute({ state })
    expect(result.adversary_review_report).toBeDefined()
    expect(typeof result.adversary_review_report).toBe('string')
    expect(result.adversary_review_disputes).toBeDefined()
    expect(typeof result.adversary_review_confidence).toBe('number')
    expect(result._adversary_review_event).toBeDefined()
  })

  it('无输入时仍生成报告', async () => {
    const handler = new AdversaryReviewHandler()
    const result = await handler.execute({ state: {} })
    expect(result.adversary_review_report).toBeDefined()
    expect(result.adversary_review_confidence).toBeGreaterThanOrEqual(0)
  })

  it('运行时隔离检查集成：检测到禁止键时 fail-closed', async () => {
    const handler = new AdversaryReviewHandler()
    const state = {
      final_draft: 'test',
      response_plan: '泄漏内容',
    }
    const result = await handler.execute({ state })
    expect(result.adversary_review_report).toContain('信息隔离检查失败')
    expect(result.adversary_review_report).toContain('response_plan')
    expect(result.adversary_review_confidence).toBe(0)
    expect(result._adversary_review_event).toBeDefined()
    const event = result._adversary_review_event as { isolationCheck: { clean: boolean; leakedKeys: string[] } }
    expect(event.isolationCheck.clean).toBe(false)
    expect(event.isolationCheck.leakedKeys).toContain('response_plan')
  })
})

describe('session 事件写入', () => {
  it('extractAdversaryReviewEvent 提取事件数据', async () => {
    const handler = new AdversaryReviewHandler()
    const state = {
      final_draft: 'test',
      claims: '权利要求1',
    }
    const result = await handler.execute({ state })
    const event = extractAdversaryReviewEvent(result)
    expect(event).toBeDefined()
    expect(event?.inputKeys).toBeDefined()
    expect(event?.outputKeys).toBeDefined()
    expect(event?.isolationCheck).toBeDefined()
    expect(event?.isolationCheck.clean).toBe(true)
  })

  it('隔离检查失败时事件包含泄漏键', async () => {
    const handler = new AdversaryReviewHandler()
    const state = {
      final_draft: 'test',
      claim_chart: '泄漏',
    }
    const result = await handler.execute({ state })
    const event = extractAdversaryReviewEvent(result)
    expect(event).toBeDefined()
    expect(event?.isolationCheck.clean).toBe(false)
    expect(event?.isolationCheck.leakedKeys).toContain('claim_chart')
  })

  it('无事件数据时返回 undefined', () => {
    const event = extractAdversaryReviewEvent({})
    expect(event).toBeUndefined()
  })
})

describe('AdversaryReviewReport 类型', () => {
  it('输出结构符合类型定义', () => {
    const report: AdversaryReviewReport = {
      disputes: [],
      argumentStrength: 'strong',
      missedRejections: [],
      evidenceGaps: [],
      overallConfidence: 0.8,
      summary: '测试摘要',
    }
    expect(report.argumentStrength).toBe('strong')
    expect(Array.isArray(report.disputes)).toBe(true)
    expect(Array.isArray(report.missedRejections)).toBe(true)
    expect(Array.isArray(report.evidenceGaps)).toBe(true)
    expect(typeof report.overallConfidence).toBe('number')
    expect(typeof report.summary).toBe('string')
  })
})
