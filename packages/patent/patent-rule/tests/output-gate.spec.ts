import { describe, expect, it } from 'vitest'
import { loadPatentFullRuleSet, RuleOutputGate, selectGateRules } from '@deepseek-ai/dsh-patent-rule'

/** 构造 B 链规则门禁：keyword_blocklist 子集（排除 compliance PAT-* 与 structural）。 */
function makeRuleGate(): RuleOutputGate {
  return new RuleOutputGate(selectGateRules(loadPatentFullRuleSet().ruleSet))
}

describe('RuleOutputGate', () => {
  it('selectGateRules keeps only nuo keyword_blocklist rules (excluding PAT-* and structural)', () => {
    const gateRules = selectGateRules(loadPatentFullRuleSet().ruleSet)
    expect(gateRules.rules.length).toBe(9)
    for (const r of gateRules.rules) {
      expect(r.check.type).toBe('keyword_blocklist')
      expect(r.id.startsWith('PAT-')).toBe(false)
    }
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
