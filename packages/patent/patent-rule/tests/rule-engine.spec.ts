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

  it('keyword_blocklist truncates evidence longer than 80 chars', () => {
    const longWord = 'X'.repeat(90)
    const set = ruleSet([
      { id: 'LONG', name: '长关键词', severity: 'major', action: 'warn', check: { type: 'keyword_blocklist', keywords: [longWord] } },
    ])
    const result = evaluateText(longWord, set)
    expect(result.violations[0]?.evidence).toEqual(['X'.repeat(80) + '…'])
  })

  it('keyword_blocklist tolerates entries with only separators', () => {
    const set = ruleSet([
      { id: 'SEP', name: '空备选词', severity: 'major', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['|'] } },
    ])
    expect(evaluateText('包含 | 分隔符', set).violations.length).toBe(0)
  })

  it('keyword_blocklist scan stops when a match reaches the text end', () => {
    const set = ruleSet([
      { id: 'END', name: '尾词', severity: 'minor', action: 'log', check: { type: 'keyword_blocklist', keywords: ['X'] } },
    ])
    const result = evaluateText('X', set)
    expect(result.violations[0]?.evidence).toEqual(['X'])
  })

  it('keyword_blocklist picks the earliest match among multiple alternatives', () => {
    const set = ruleSet([
      { id: 'ALT', name: '多备选', severity: 'minor', action: 'log', check: { type: 'keyword_blocklist', keywords: ['赌博|博彩'] } },
    ])
    const result = evaluateText('文本含赌博和博彩。', set)
    expect(result.violations[0]?.evidence).toEqual(['赌博', '博彩'])
  })

  it('pattern_analysis defaults minMatches to 1', () => {
    const set = ruleSet([
      { id: 'PM1', name: '缺省匹配数', severity: 'minor', action: 'log', check: { type: 'pattern_analysis', patterns: ['实施例'] } },
    ])
    expect(evaluateText('实施例一。', set).violations.length).toBe(1)
  })

  it('pattern_analysis caps evidence at four matches', () => {
    const set = ruleSet([
      { id: 'PM4', name: '证据上限', severity: 'minor', action: 'log', check: { type: 'pattern_analysis', patterns: ['实施例[一二三四五]'] } },
    ])
    const result = evaluateText('实施例一、实施例二、实施例三、实施例四、实施例五。', set)
    expect(result.violations[0]?.evidence).toEqual(['实施例一', '实施例二', '实施例三', '实施例四'])
  })

  it('pattern_analysis tolerates zero-length matches', () => {
    const set = ruleSet([
      { id: 'PM0', name: '空匹配', severity: 'minor', action: 'log', check: { type: 'pattern_analysis', patterns: [''] } },
    ])
    const result = evaluateText('abc', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.evidence).toEqual([''])
  })

  it('structural_analysis treats an invalid element regex as missing', () => {
    const set = ruleSet([
      {
        id: 'ST-BAD-RE',
        name: '坏正则',
        severity: 'critical',
        action: 'block',
        check: {
          type: 'structural_analysis',
          requiresAll: [{ element: 'tech', patterns: ['('] }],
          minConfidence: 1,
        },
      },
    ])
    const result = evaluateText('有内容', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.message).toMatch(/缺失 tech/)
  })

  it('structural_analysis with no required elements always passes', () => {
    const set = ruleSet([
      { id: 'ST-EMPTY', name: '空要素', severity: 'critical', action: 'block', check: { type: 'structural_analysis', requiresAll: [] } },
    ])
    expect(evaluateText('任意文本', set).violations.length).toBe(0)
  })

  it('structural_analysis without minConfidence defaults to 1', () => {
    const set = ruleSet([
      {
        id: 'ST-NOMIN',
        name: '缺省置信度',
        severity: 'critical',
        action: 'block',
        check: { type: 'structural_analysis', requiresAll: [{ element: 'tech', patterns: ['装置'] }] },
      },
    ])
    const result = evaluateText('本方案没有要素。', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.message).toMatch(/置信度 0% < 100%/)
  })

  it('citation_analysis checks 实施细则 citations against their own max', () => {
    const set = ruleSet([
      {
        id: 'CON-302',
        name: '细则范围',
        severity: 'major',
        action: 'warn',
        check: { type: 'citation_analysis', statutes: { 专利法实施细则: { max: 80 } } },
      },
    ])
    expect(evaluateText('依据专利法实施细则第22条。', set).violations.length).toBe(0)
    const result = evaluateText('依据专利法实施细则第99条。', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.evidence).toEqual(['专利法实施细则第99条'])
  })

  it('citation_analysis skips unparsable article numbers', () => {
    const set = ruleSet([
      { id: 'CON-303', name: '混合数字', severity: 'major', action: 'warn', check: { type: 'citation_analysis', statutes: { 专利法: { max: 78 } } } },
    ])
    expect(evaluateText('依据专利法第1十条。', set).violations.length).toBe(0)
  })

  it('synonym_match without minConfidence defaults to 1', () => {
    const set = ruleSet([
      {
        id: 'SYN-NOMIN',
        name: '同义缺省置信度',
        severity: 'major',
        action: 'warn',
        check: { type: 'synonym_match', requirements: [{ element: 'novelty', keywords: ['新颖性'] }] },
      },
    ])
    const result = evaluateText('缺少同义要素', set)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.message).toMatch(/缺失 novelty/)
  })
})
