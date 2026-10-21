import { describe, expect, it } from 'vitest'
import {
  createCheckerRuleEvaluator,
  defaultPatentRules,
  loadPatentFullRuleSet,
} from '@deepseek-ai/dsh-patent-rule'

/**
 * checker 规则（71 条，随本包发布）与宪法资产（123 条）的主题重叠矩阵。
 *
 * 没有任何一对是等价实现：资产规则以 structural_analysis（缺失即违规）为主，
 * checker 规则以关键词/步骤/维度检查为主，故 `parity` 只有 `partial`（同主题、不同实现）
 * 与 `none`（资产无对应主题）。矩阵只用于迁移审计，不能据此用资产替换 checker 规则。
 */
type ParityEntry = {
  parity: 'partial' | 'none'
  assets: readonly string[]
}

const CORE_TO_ASSET: Record<string, ParityEntry> = {
  // 新颖性
  'NOVELTY-SINGLE-COMPARISON': { parity: 'partial', assets: ['P-NOV-001'] },
  'NOVELTY-FEATURE-COVERAGE': { parity: 'none', assets: [] },
  // 创造性
  'INVENTIVENESS-THREE-STEP': { parity: 'partial', assets: ['EX-INV-001', 'CON-104', 'IPC-GEN-INV-001'] },
  'INVENTIVENESS-TECHNICAL-PROBLEM': { parity: 'none', assets: [] },
  'INVENTIVENESS-PROBLEM-SOLUTION-BINDING': { parity: 'none', assets: [] },
  'INVENTIVENESS-PROBLEM-MULTI-CAUSAL': { parity: 'none', assets: [] },
  'INVENTIVENESS-PROBLEM-UNMEASURED': { parity: 'none', assets: [] },
  // 充分公开与权利要求
  'DISCLOSURE-SUFFICIENCY': { parity: 'partial', assets: ['CON-201', 'EX-DIS-003'] },
  'CLAIM-CLARITY-SUPPORT': { parity: 'partial', assets: ['EX-CLM-001', 'EX-CLM-002', 'CON-301', 'CON-302'] },
  'CLAIM-ESSENTIAL-FEATURES': { parity: 'partial', assets: ['CON-303'] },
  // 说明书
  'SPEC-SECTIONS': { parity: 'partial', assets: ['EX-DIS-001'] },
  'SPEC-CONTENT-TRIPLE': { parity: 'partial', assets: ['EX-DIS-002'] },
  'SPEC-EMBODIMENTS': { parity: 'partial', assets: ['EX-DIS-003', 'PR-SPEC-003'] },
  'SPEC-COMMERCIAL-BAN': { parity: 'partial', assets: ['CON-COMP-0105'] },
  'SPEC-SCOPE-COMPLIANCE': { parity: 'partial', assets: ['CON-501', 'EX-PRC-001'] },
  'SPEC-EFFECT-DATA': { parity: 'partial', assets: ['PR-SPEC-004'] },
  'SPEC-DRAWING-MARKS': { parity: 'partial', assets: ['PR-FMT-002', 'EX-DIS-004'] },
  'SPEC-ABSTRACT': { parity: 'partial', assets: ['EX-SPEC-003'] },
  // 侵权
  'INFRINGEMENT-FULL-COVERAGE': { parity: 'partial', assets: ['JD-INF-005'] },
  'INFRINGEMENT-EQUIVALENCE': { parity: 'partial', assets: ['JD-INF-001', 'LAW-EQUIV-BASIS-001'] },
  'INFRINGEMENT-ESTOPPEL': { parity: 'partial', assets: ['JD-INF-006'] },
  'INFRINGEMENT-DEDICATION': { parity: 'none', assets: [] },
  // 无效与复审
  'INVALID-NOVELTY-SINGLE-COMPARISON': { parity: 'partial', assets: ['P-NOV-001', 'PR-OA-004'] },
  'INVALID-COMBINATION-MOTIVATION': { parity: 'none', assets: [] },
  'INVALID-PRIORITY-DATE-CHECK': { parity: 'partial', assets: ['P-PRC-003'] },
  'REEXAM-GROUNDS-SCOPE': { parity: 'partial', assets: ['P-PRC-004'] },
  'REEXAM-NEW-EVIDENCE': { parity: 'partial', assets: ['PR-INV-002'] },
  // 外观设计
  'DESIGN-01': { parity: 'none', assets: [] },
  'DESIGN-02': { parity: 'none', assets: [] },
  'DESIGN-03': { parity: 'none', assets: [] },
  'DESIGN-04': { parity: 'none', assets: [] },
  'DESIGN-05': { parity: 'none', assets: [] },
  // 优先权
  'PRIORITY-01': { parity: 'partial', assets: ['P-PRC-003'] },
  'PRIORITY-02': { parity: 'none', assets: [] },
  'PRIORITY-03': { parity: 'partial', assets: ['P-PRC-003'] },
  'PRIORITY-04': { parity: 'partial', assets: ['P-PRC-003'] },
  'PRIORITY-05': { parity: 'partial', assets: ['P-PRC-003'] },
  // 公开方式
  'PUBACC-01': { parity: 'partial', assets: ['EX-NOV-001'] },
  'PUBACC-02': { parity: 'partial', assets: ['EX-NOV-001'] },
  'PUBACC-03': { parity: 'partial', assets: ['EX-NOV-001', 'JD-PRC-005'] },
  'PUBACC-04': { parity: 'partial', assets: ['EX-NOV-001'] },
  'PUBACC-05': { parity: 'none', assets: [] },
  // 保护客体
  'SUBJECT-01': { parity: 'partial', assets: ['CON-101', 'EX-CMP-001', 'LAW-UM-SUBJECT-001'] },
  'SUBJECT-02': { parity: 'none', assets: [] },
  'SUBJECT-03': { parity: 'none', assets: [] },
  'SUBJECT-04': { parity: 'partial', assets: ['EX-SEL-001', 'EX-SEL-002', 'EX-SEL-003', 'EX-SEL-005'] },
  'SUBJECT-05': { parity: 'none', assets: [] },
  // 推理模式：创造性
  'REASON-CREATIVITY-01A': { parity: 'none', assets: [] },
  'REASON-CREATIVITY-01B': { parity: 'partial', assets: ['EX-INV-005', 'IPC-GEN-INV-003'] },
  'REASON-CREATIVITY-02': { parity: 'none', assets: [] },
  'REASON-CREATIVITY-03': { parity: 'partial', assets: ['EX-INV-004'] },
  'REASON-CREATIVITY-04': { parity: 'none', assets: [] },
  'REASON-CREATIVITY-05': { parity: 'none', assets: [] },
  'REASON-CREATIVITY-06': { parity: 'partial', assets: ['EX-INV-006', 'CON-402'] },
  // 推理模式：新颖性
  'REASON-NOVELTY-01A': { parity: 'partial', assets: ['P-NOV-002'] },
  'REASON-NOVELTY-01B': { parity: 'none', assets: [] },
  'REASON-NOVELTY-02A': { parity: 'partial', assets: ['EX-NOV-001'] },
  'REASON-NOVELTY-02B': { parity: 'partial', assets: ['EX-NOV-001', 'JD-PRC-005'] },
  'REASON-NOVELTY-03A': { parity: 'partial', assets: ['P-NOV-003'] },
  'REASON-NOVELTY-03B': { parity: 'partial', assets: ['P-PRC-003'] },
  // 推理模式：权利要求与公开
  'REASON-CLAIMS-01': { parity: 'partial', assets: ['EX-CLM-001'] },
  'REASON-CLAIMS-02': { parity: 'partial', assets: ['EX-CLM-002'] },
  'REASON-CLAIMS-03': { parity: 'partial', assets: ['EX-CLM-005', 'PR-CLM-004'] },
  'REASON-CLAIMS-04': { parity: 'partial', assets: ['CON-201'] },
  'REASON-CLAIMS-05': { parity: 'none', assets: [] },
  // 推理模式：其他
  'REASON-OTHER-01A': { parity: 'partial', assets: ['CON-101'] },
  'REASON-OTHER-01B': { parity: 'partial', assets: ['EX-SEL-001', 'EX-SEL-003'] },
  'REASON-OTHER-02A': { parity: 'partial', assets: ['CON-501', 'CON-502', 'EX-PRC-001'] },
  'REASON-OTHER-02B': { parity: 'partial', assets: ['P-PRC-003'] },
  'REASON-OTHER-03': { parity: 'partial', assets: ['P-UTL-001'] },
  'REASON-OTHER-04': { parity: 'none', assets: [] },
}

describe('core checker ↔ patent-rule asset parity', () => {
  it('矩阵逐条覆盖全部 core 规则', () => {
    const coreIds = defaultPatentRules().map(rule => rule.id).sort()
    expect(coreIds).toHaveLength(71)
    expect(Object.keys(CORE_TO_ASSET).sort()).toEqual(coreIds)
  })

  it('映射的资产 id 全部存在；partial 必须有资产，none 必须为空', () => {
    const assetIds = new Set(loadPatentFullRuleSet().ruleSet.rules.map(rule => rule.id))
    for (const [coreId, entry] of Object.entries(CORE_TO_ASSET)) {
      if (entry.parity === 'none') {
        expect(entry.assets, coreId).toEqual([])
        continue
      }
      expect(entry.assets.length, coreId).toBeGreaterThan(0)
      for (const assetId of entry.assets) {
        expect(assetIds.has(assetId), `${coreId} → ${assetId}`).toBe(true)
      }
    }
  })

  it('两套规则没有共用检查类型：不存在等价实现', () => {
    const coreTypes = new Set<string>(defaultPatentRules().map(rule => rule.checkType))
    const assetTypes = new Set<string>(loadPatentFullRuleSet().ruleSet.rules.map(rule => rule.check.type))
    expect([...coreTypes].filter(type => assetTypes.has(type))).toEqual([])
  })
})

describe('checker 规则门评估基线（迁移金标）', () => {
  const evaluator = createCheckerRuleEvaluator()
  const cases = [
    {
      name: '新颖性违规',
      text: '结合多份对比文件结合，可认定本申请不具备新颖性。',
      domains: ['patent_novelty'],
      failing: [
        'NOVELTY-SINGLE-COMPARISON',
        'NOVELTY-FEATURE-COVERAGE',
        'PRIORITY-01',
        'PRIORITY-03',
        'PRIORITY-04',
        'PRIORITY-05',
        'PUBACC-01',
        'PUBACC-02',
        'PUBACC-03',
        'PUBACC-04',
        'PUBACC-05',
        'REASON-NOVELTY-01A',
        'REASON-NOVELTY-01B',
        'REASON-NOVELTY-02A',
        'REASON-NOVELTY-02B',
        'REASON-NOVELTY-03A',
        'REASON-NOVELTY-03B',
      ],
      evaluatedRules: 17,
    },
    {
      name: '新颖性规范文本',
      text:
        '新颖性分析：将权利要求1与对比文件D1进行单独对比。' +
        '逐项比对技术特征，权利要求1的所有技术特征均已被D1公开，故不具备新颖性。',
      domains: ['patent_novelty'],
      failing: [
        'PRIORITY-01',
        'PRIORITY-03',
        'PRIORITY-04',
        'PRIORITY-05',
        'PUBACC-01',
        'PUBACC-02',
        'PUBACC-03',
        'PUBACC-04',
        'PUBACC-05',
        'REASON-NOVELTY-01A',
        'REASON-NOVELTY-01B',
        'REASON-NOVELTY-02A',
        'REASON-NOVELTY-02B',
        'REASON-NOVELTY-03A',
        'REASON-NOVELTY-03B',
      ],
      evaluatedRules: 17,
    },
    {
      name: '创造性三步法文本',
      text:
        '创造性分析（三步法）：首先确定最接近的现有技术为D1；' +
        '其次，权利要求1相对于D1的区别技术特征为X，本发明实际解决的技术问题是把装配偏差从0.5mm降到0.1mm；' +
        '最后，D2给出了将X应用于D1的技术启示，故不具备创造性。',
      domains: ['patent_inventiveness'],
      failing: [
        'REASON-CREATIVITY-03',
        'REASON-CREATIVITY-04',
        'REASON-CREATIVITY-05',
        'REASON-CREATIVITY-06',
      ],
      evaluatedRules: 12,
    },
    {
      name: '说明书最小文本',
      text: '本发明公开了一种装置。',
      domains: ['patent_spec'],
      failing: [
        'SPEC-SECTIONS',
        'SPEC-CONTENT-TRIPLE',
        'SPEC-EMBODIMENTS',
        'SPEC-EFFECT-DATA',
        'SPEC-DRAWING-MARKS',
        'SPEC-ABSTRACT',
      ],
      evaluatedRules: 8,
    },
    {
      name: '权利要求最小文本',
      text: '权利要求1：一种装置，其特征在于包括处理模块。',
      domains: ['patent_claims'],
      failing: [
        'CLAIM-CLARITY-SUPPORT',
        'CLAIM-ESSENTIAL-FEATURES',
        'REASON-CLAIMS-01',
        'REASON-CLAIMS-02',
        'REASON-CLAIMS-03',
      ],
      evaluatedRules: 5,
    },
    {
      name: '多域合并',
      text: '本发明公开了一种装置。',
      domains: ['patent_spec', 'patent_claims'],
      failing: [
        'CLAIM-CLARITY-SUPPORT',
        'CLAIM-ESSENTIAL-FEATURES',
        'SPEC-SECTIONS',
        'SPEC-CONTENT-TRIPLE',
        'SPEC-EMBODIMENTS',
        'SPEC-EFFECT-DATA',
        'SPEC-DRAWING-MARKS',
        'SPEC-ABSTRACT',
        'REASON-CLAIMS-01',
        'REASON-CLAIMS-02',
        'REASON-CLAIMS-03',
      ],
      evaluatedRules: 13,
    },
  ] as const

  for (const entry of cases) {
    it(entry.name, () => {
      const assessment = evaluator.evaluate({ text: entry.text, domains: entry.domains })
      expect(assessment.failures.map(failure => failure.ruleId)).toEqual(entry.failing)
      expect(assessment.verdict).toBe('blocked')
      expect(assessment.evaluatedRules).toBe(entry.evaluatedRules)
    })
  }
})
