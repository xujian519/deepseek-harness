// `patent_eval`'s slop penalty and the rule gate's PAT-ABS-001 flag the same
// absolute phrasings; the two lists must not drift, or a score and a gate
// verdict disagree about the same document.

import { describe, expect, it } from 'vitest'
import { loadPatentComplianceRuleSet } from '@deepseek-ai/dsh-patent-rule'
import { ABSOLUTE_PHRASES } from '../src/tool/patent-eval.ts'

describe('patent_eval absolute phrases', () => {
  it('matches the keyword list of the shipped PAT-ABS-001 rule', () => {
    const rule = loadPatentComplianceRuleSet().ruleSet.rules.find(candidate => candidate.id === 'PAT-ABS-001')
    expect(rule).toBeDefined()
    expect(rule?.check.type).toBe('keyword_blocklist')
    const keywords = rule?.check.type === 'keyword_blocklist' ? rule.check.keywords : []
    expect([...keywords]).toEqual([...ABSOLUTE_PHRASES])
  })
})
