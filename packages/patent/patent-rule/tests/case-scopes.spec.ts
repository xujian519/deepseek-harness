import { describe, expect, it } from 'vitest'
import {
  PATENT_CASE_DOMAINS,
  evaluateText,
  loadPatentFullRuleSet,
  patentCaseDomains,
  type PatentCaseScope,
} from '@deepseek-ai/dsh-patent-rule'

/**
 * 作业 scope（四类作业的规则门）：域表覆盖性、越域排除与逐作业命中。
 * 域表语义见 `src/runtime/patent-compliance.ts` 的 `PATENT_CASE_DOMAINS`。
 */
const CASE_SCOPES: readonly PatentCaseScope[] = [
  'patent-oa-response',
  'patent-invalidation',
  'patent-reexamination',
  'patent-infringement',
]

/** 断言用文本：同时含答复要素、无效理由、侵权比对与两年时效措辞，让越域漏检必然显形。 */
const PROBE_TEXT = [
  '意见陈述书：逐条答复审查意见。权利要求 1 具备创造性，区别技术特征为螺旋通道，现有技术未给出结合启示。',
  '请求宣告权利要求 1 无效：对比文件 1 公开了全部技术特征，权利要求 1 的保护范围不清楚。',
  '被控产品落入权利要求 1 的保护范围，三者手段基本相同、功能基本相同、效果基本相同。',
  '侵权诉讼时效为两年，自权利人知道或应当知道之日起算。',
].join('\n')

const full = loadPatentFullRuleSet()
const ruleById = new Map(full.ruleSet.rules.map(rule => [rule.id, rule]))

function evaluateScope(scope: PatentCaseScope, text: string): string[] {
  const domains = patentCaseDomains(scope)
  expect(domains, scope).toBeDefined()
  return evaluateText(text, full.ruleSet, undefined, { domain: domains ?? [] }).violations.map(v => v.ruleId)
}

describe('patent job scopes (PATENT_CASE_DOMAINS)', () => {
  it('names exactly the four job scopes', () => {
    expect(Object.keys(PATENT_CASE_DOMAINS).sort()).toEqual([...CASE_SCOPES].sort())
  })

  it('lists only domains that the bundled assets declare', () => {
    const assetDomains = new Set(full.ruleSet.rules.map(rule => rule.domain))
    for (const [scope, domains] of Object.entries(PATENT_CASE_DOMAINS)) {
      expect(domains.length, scope).toBeGreaterThan(0)
      // 拼写错的域不会报警：评估期按域跳过，整条规则静默消失。
      for (const domain of domains) expect(assetDomains.has(domain), `${scope}: ${domain}`).toBe(true)
    }
  })

  it('covers every domain of the full asset set across the four scopes', () => {
    const scoped = new Set(Object.values(PATENT_CASE_DOMAINS).flat())
    const uncovered = [...new Set(full.ruleSet.rules.map(rule => rule.domain))].filter(
      domain => domain !== undefined && !scoped.has(domain),
    )
    expect(uncovered).toEqual([])
  })

  it('never reports a rule from a domain outside the scope', () => {
    for (const scope of CASE_SCOPES) {
      const domains = PATENT_CASE_DOMAINS[scope]
      const outside = evaluateScope(scope, PROBE_TEXT).filter((id) => {
        const domain = ruleById.get(id)?.domain
        return domain !== undefined && !domains.includes(domain)
      })
      expect(outside, scope).toEqual([])
    }
  })

  it('runs rules without a domain in every scope', () => {
    const universal = full.ruleSet.rules.filter(rule => rule.domain === undefined)
    expect(universal.map(rule => rule.id)).toEqual(['CON-102'])
    const text = '本案不得编造对比文件。'
    for (const scope of CASE_SCOPES) expect(evaluateScope(scope, text), scope).toContain('CON-102')
  })

  it('infringement scope keeps the infringement domain and drops the drafting domains', () => {
    const ids = evaluateScope('patent-infringement', PROBE_TEXT)
    expect(ids).toContain('LAW-TIMELIMIT-001')
    expect(ids).toContain('JD-INF-001')
    expect(ids).not.toContain('PR-OA-001')
    expect(ids).not.toContain('CON-103')
  })

  it('answer scopes keep the answer-practice domain, invalidation does not', () => {
    for (const scope of ['patent-oa-response', 'patent-reexamination'] as const) {
      const ids = evaluateScope(scope, PROBE_TEXT)
      expect(ids, scope).toContain('CON-702')
      expect(ids, scope).not.toContain('LAW-TIMELIMIT-001')
    }
    const invalidation = evaluateScope('patent-invalidation', PROBE_TEXT)
    expect(invalidation).toContain('P-NOV-001')
    expect(invalidation).toContain('P-PRC-003')
    expect(invalidation).not.toContain('CON-702')
    expect(invalidation).not.toContain('LAW-TIMELIMIT-001')
  })

  it('resolves only the four job scopes, not every caller string', () => {
    for (const scope of CASE_SCOPES) expect(patentCaseDomains(scope)).toBe(PATENT_CASE_DOMAINS[scope])
    for (const other of ['patent', 'patent-electrical', 'patent-full', 'pack', '', 'bogus', 'toString', 'constructor']) {
      expect(patentCaseDomains(other), other).toBeUndefined()
    }
  })
})
