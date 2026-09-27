import { describe, expect, it } from 'vitest'
import { loadPatentFullRuleSet, RuleOutputGate, selectGateRules } from '@deepseek-ai/dsh-patent-rule'

/** 构造规则门禁：keyword_blocklist 子集（含 compliance PAT-*，不含 structural/citation）。 */
function makeRuleGate(): RuleOutputGate {
  return new RuleOutputGate(selectGateRules(loadPatentFullRuleSet().ruleSet))
}

describe('RuleOutputGate', () => {
  it('selectGateRules keeps every keyword_blocklist rule, including compliance PAT-*', () => {
    const gateRules = selectGateRules(loadPatentFullRuleSet().ruleSet)
    // 11 条 nuo 镜像与并入禁令 + 3 条 compliance 关键词规则（PAT-RISK-001 / PAT-APPROVAL-001 / PAT-ABS-001）
    expect(gateRules.rules.length).toBe(14)
    for (const r of gateRules.rules) {
      expect(r.check.type).toBe('keyword_blocklist')
    }
    expect(gateRules.rules.map(r => r.id).filter(id => id.startsWith('PAT-')).sort())
      .toEqual(['PAT-ABS-001', 'PAT-APPROVAL-001', 'PAT-RISK-001'])
  })

  it('hits the compliance rules: approval keyword → needsApproval, absolute phrasing → warn', () => {
    const gate = makeRuleGate()
    const review = gate.process('以下是本次侵权判断的最终建议。')
    expect(review.needsApproval).toBe(true)
    expect(review.reviewHits).toContain('PAT-APPROVAL-001')
    const warn = gate.process('该方案绝对可行。')
    expect(warn.needsApproval).toBe(false)
    expect(warn.warnHits).toContain('PAT-ABS-001')
  })

  it('block hit (placeholder patent number) → needsApproval + blockHits', () => {
    const gate = makeRuleGate()
    const result = gate.process('现有技术 CNXXXXXX 公开了一种方法。')
    expect(result.needsApproval).toBe(true)
    expect(result.blockHits).toContain('CON-COMP-0101')
  })

  it('warn hit (clarity wording) → appended hint, no approval', () => {
    const gate = makeRuleGate()
    const result = gate.process('该装置大约为 10 厘米。')
    expect(result.needsApproval).toBe(false)
    expect(result.text).toMatch(/合规提示/)
    expect(result.warnHits.length).toBeGreaterThan(0)
  })

  it('clean text → zero violations, text unchanged (no structural noise regression)', () => {
    const gate = makeRuleGate()
    const clean = '本发明提供一种基于深度学习的图像分类方法，有效提高了分类准确率。'
    const result = gate.process(clean)
    expect(result.needsApproval).toBe(false)
    expect(result.text).toBe(clean)
  })

  it('empty rule set → degrade to pass-through (load-failure semantics)', () => {
    const gate = new RuleOutputGate({ rules: [] })
    const result = gate.process('现有技术 CNXXXXXX 公开了一种方法。')
    expect(result.needsApproval).toBe(false)
    expect(result.text).toBe('现有技术 CNXXXXXX 公开了一种方法。')
  })
})
