import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-patent-rule'

describe('@deepseek-ai/dsh-patent-rule', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('patent-rule')
    expect(Pkg.inject).toEqual(['tools'])
    expect(Pkg.Config).toBeDefined()
    expect(typeof Pkg.apply).toBe('function')
    expect('default' in Pkg).toBe(false)
  })

  it('exports the rule-engine library API', () => {
    expect(typeof Pkg.evaluateText).toBe('function')
    expect(typeof Pkg.parseRuleSetFromYaml).toBe('function')
    expect(typeof Pkg.loadPatentFullRuleSet).toBe('function')
    expect(typeof Pkg.loadRulePack).toBe('function')
    expect(typeof Pkg.RuleOutputGate).toBe('function')
    expect(typeof Pkg.rulesToPolicyDenyRules).toBe('function')
    expect(typeof Pkg.createEvidenceComplianceGuards).toBe('function')
  })
})
