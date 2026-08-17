import { describe, expect, it } from 'vitest'
import type { ConstitutionalRule, RuleSet } from '@deepseek-ai/dsh-patent-core'
import { evaluateText, groupByAction } from '@deepseek-ai/dsh-patent-rule'

function ruleSet(rules: ConstitutionalRule[]): RuleSet {
  return { rules }
}

describe('RuleEngine', () => {
  it('keyword_blocklist flags matching keywords', () => {
    const set = ruleSet([
      {
        id: 'CON-102',
        name: '违法排除',
        severity: 'critical',
        action: 'block',
        check: { type: 'keyword_blocklist', keywords: ['赌博|博彩', '毒品'] },
      },
    ])
    const result = evaluateText('该装置用于赌博检测。', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.ruleId).toBe('CON-102')
    expect(result.violations[0]?.evidence).toContain('赌博')
  })

  it('keyword_blocklist negation_context allows negated mentions', () => {
    const set = ruleSet([
      {
        id: 'CON-102',
        name: '违法排除',
        severity: 'critical',
        action: 'block',
        check: { type: 'keyword_blocklist', keywords: ['赌博|博彩'], negationContext: true },
      },
    ])
    expect(evaluateText('本发明用于防止赌博成瘾。', set).violations.length).toBe(0)
    expect(evaluateText('本发明用于赌博检测。', set).violations.length).toBe(1)
  })

  it('keyword_blocklist without negation_context still flags negated mentions', () => {
    const set = ruleSet([
      {
        id: 'CON-102',
        name: '违法排除',
        severity: 'critical',
        action: 'block',
        check: { type: 'keyword_blocklist', keywords: ['赌博'] },
      },
    ])
    expect(evaluateText('本发明用于防止赌博。', set).violations.length).toBe(1)
  })

  it('pattern_analysis flags matching regex with minMatches', () => {
    const set = ruleSet([
      {
        id: 'CON-201',
        name: '禁止引用式权利要求',
        severity: 'major',
        action: 'warn',
        check: { type: 'pattern_analysis', patterns: ['如权利要求[0-9]+所述'], minMatches: 1 },
      },
    ])
    const result = evaluateText('该方案如权利要求2所述。', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.action).toBe('warn')
  })

  it('pattern_analysis respects minMatches threshold', () => {
    const set = ruleSet([
      {
        id: 'CON-202',
        name: '双模式',
        severity: 'minor',
        action: 'log',
        check: { type: 'pattern_analysis', patterns: ['实施例'], minMatches: 2 },
      },
    ])
    expect(evaluateText('仅一个实施例。', set).violations.length).toBe(0)
    expect(evaluateText('实施例一与实施例二。', set).violations.length).toBe(1)
  })

  it('structural_analysis flags missing elements below minConfidence', () => {
    const set = ruleSet([
      {
        id: 'CON-101',
        name: '技术方案三要素',
        severity: 'critical',
        action: 'block',
        check: {
          type: 'structural_analysis',
          requiresAll: [
            { element: 'technical_means', patterns: ['装置|设备|系统|模块'] },
            { element: 'technical_problem', patterns: ['问题|不足|缺陷'] },
            { element: 'technical_effect', patterns: ['提高|改善|增强|优化'] },
          ],
          minConfidence: 0.66,
        },
      },
    ])
    expect(evaluateText('本装置解决现有技术问题，提高了效率。', set).violations.length).toBe(0)
    const fail = evaluateText('一种模块化设计。', set)
    expect(fail.violations.length).toBe(1)
    expect(fail.violations[0]?.message).toMatch(/缺失/)
  })

  it('citation_analysis flags out-of-range article numbers (R1)', () => {
    const set = ruleSet([
      {
        id: 'CON-301',
        name: '法条范围',
        severity: 'major',
        action: 'warn',
        check: { type: 'citation_analysis', statutes: { 专利法: { max: 78 } } },
      },
    ])
    expect(evaluateText('依据专利法第22条。', set).violations.length).toBe(0)
    const result = evaluateText('依据专利法第99条。', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.message).toMatch(/超出范围/)
  })

  it('groupByAction buckets violations by action', () => {
    const set = ruleSet([
      { id: 'R1', name: 'block 规则', severity: 'critical', action: 'block', check: { type: 'keyword_blocklist', keywords: ['炸弹'] } },
      { id: 'R2', name: 'review 规则', severity: 'major', action: 'review', check: { type: 'keyword_blocklist', keywords: ['专利结论'] } },
      { id: 'R3', name: 'warn 规则', severity: 'minor', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['绝对'] } },
    ])
    const grouped = groupByAction(evaluateText('本结论涉及炸弹与专利结论，绝对可靠。', set))
    expect(grouped.block?.length).toBe(1)
    expect(grouped.review?.length).toBe(1)
    expect(grouped.warn?.length).toBe(1)
  })
})
