import { describe, expect, it } from 'vitest'
import type { ConstitutionalRule, RuleSet } from '@deepseek-ai/dsh-patent-core'
import { loadPatentComplianceRuleSet, rulesToPolicyDenyRules } from '@deepseek-ai/dsh-patent-rule'

function ruleSet(rules: ConstitutionalRule[]): RuleSet {
  return { rules }
}

const BLOCK_KEYWORD_RULE: ConstitutionalRule = {
  id: 'CON-102',
  name: '违法排除',
  severity: 'critical',
  action: 'block',
  check: { type: 'keyword_blocklist', keywords: ['赌博|博彩', '毒品'] },
}

describe('rulesToPolicyDenyRules', () => {
  it('compiles block keyword rules to policy deny rules', () => {
    const { rules, skipped } = rulesToPolicyDenyRules(ruleSet([BLOCK_KEYWORD_RULE]))
    expect(rules.length).toBe(1)
    expect(rules[0]?.source).toBe('policy')
    expect(rules[0]?.behavior).toBe('deny')
    expect(rules[0]?.toolName).toBe('*')
    expect(rules[0]?.pattern).toBe('text:赌博|博彩|毒品')
    expect(skipped.length).toBe(0)
  })

  it('skips non-block actions', () => {
    const { rules, skipped } = rulesToPolicyDenyRules(
      ruleSet([{ id: 'W1', name: 'warn', severity: 'minor', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['绝对'] } }]),
    )
    expect(rules.length).toBe(0)
    expect(skipped[0]?.ruleId).toBe('W1')
  })

  it('skips negationContext rules by default, opt-in includes them', () => {
    const negationRule: ConstitutionalRule = {
      id: 'CON-102',
      name: '否定语境',
      severity: 'critical',
      action: 'block',
      check: { type: 'keyword_blocklist', keywords: ['赌博'], negationContext: true },
    }
    const skipped = rulesToPolicyDenyRules(ruleSet([negationRule]))
    expect(skipped.rules.length).toBe(0)
    expect(skipped.skipped[0]?.ruleId).toBe('CON-102')
    const included = rulesToPolicyDenyRules(ruleSet([negationRule]), { includeNegationContext: true })
    expect(included.rules.length).toBe(1)
  })

  it('skips unsupported check types', () => {
    const { rules, skipped } = rulesToPolicyDenyRules(
      ruleSet([{ id: 'C1', name: 'citation', severity: 'critical', action: 'block', check: { type: 'citation_analysis', statutes: { 专利法: { max: 78 } } } }]),
    )
    expect(rules.length).toBe(0)
    expect(skipped[0]?.reason).toMatch(/暂不支持/)
  })

  it('respects maxKeywordsPerRule', () => {
    const { rules } = rulesToPolicyDenyRules(ruleSet([BLOCK_KEYWORD_RULE]), { maxKeywordsPerRule: 1 })
    expect(rules[0]?.pattern).toBe('text:赌博')
  })

  it('on the bundled patent compliance asset yields no policy rules (all warn/review)', () => {
    const { ruleSet } = loadPatentComplianceRuleSet()
    const { rules, skipped } = rulesToPolicyDenyRules(ruleSet)
    expect(rules.length).toBe(0)
    expect(skipped.length).toBeGreaterThanOrEqual(4)
  })
})
