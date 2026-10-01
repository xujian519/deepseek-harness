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

  it('违规带最早字面命中的行号与命中句（调用方据此在原处裁决）', () => {
    const set = ruleSet([
      {
        id: 'PAT-RISK-001',
        name: '专利风险结论免责声明',
        severity: 'major',
        action: 'warn',
        check: { type: 'keyword_blocklist', keywords: ['专利性'] },
      },
    ])
    const text = [
      '## 技术领域',
      '本发明涉及一种装置。',
      '本分析由 AI 辅助生成，不构成正式法律意见。专利申请和专利性判断应由专利代理确认。',
    ].join('\n')
    const violation = evaluateText(text, set).violations[0]
    expect(violation?.line).toBe(3)
    expect(violation?.matchedSentence).toBe('专利申请和专利性判断应由专利代理确认。')
  })

  it('无字面命中的检查不带行号（缺项类违规无从定位）', () => {
    const set = ruleSet([
      {
        id: 'CON-101',
        name: '技术方案三要素',
        severity: 'critical',
        action: 'block',
        check: {
          type: 'structural_analysis',
          requiresAll: [{ element: 'technical_means', patterns: ['装置|设备'] }],
          minConfidence: 1,
        },
      },
    ])
    const violation = evaluateText('一种模块化设计。', set).violations[0]
    expect(violation?.evidence).toEqual([])
    expect(violation?.line).toBeUndefined()
    expect(violation?.matchedSentence).toBeUndefined()
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

describe('RuleEngine 适用前提（premise）', () => {
  const gated = ruleSet([
    {
      id: 'T-PRE-001',
      name: '创造性完整性',
      severity: 'major',
      action: 'warn',
      premise: ['创造性', '三步法'],
      check: { type: 'structural_analysis', requiresAll: [{ element: 'framework', patterns: ['三步法', '最接近的现有技术', '技术启示'] }] },
    },
  ])

  it('前提不满足 → 不评估（完整性规则在未触及该主题的文本上保持沉默）', () => {
    expect(evaluateText('本申请说明书公开充分，本领域技术人员能够实现。', gated).violations.length).toBe(0)
  })

  it('前提满足 → 照常评估（主题被触及后，缺失要素仍报出）', () => {
    const result = evaluateText('审查员认为本申请不具备创造性。', gated)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.ruleId).toBe('T-PRE-001')
  })

  it('前提大小写不敏感，且空数组视同未声明（始终评估）', () => {
    const cased = ruleSet([
      { id: 'T-PRE-002', name: 'x', severity: 'minor', action: 'warn', premise: ['patent act'], check: { type: 'keyword_blocklist', keywords: ['绝对'] } },
    ])
    expect(evaluateText('该结论绝对成立。', cased).violations.length).toBe(0)
    expect(evaluateText('See PATENT ACT art. 22. 该结论绝对成立。', cased).violations.length).toBe(1)
    const empty = ruleSet([
      { id: 'T-PRE-003', name: 'x', severity: 'minor', action: 'warn', premise: [], check: { type: 'keyword_blocklist', keywords: ['绝对'] } },
    ])
    expect(evaluateText('该结论绝对成立。', empty).violations.length).toBe(1)
  })

  it('前提命中引号内的引文也算（前提问的是「讨论到了」）', () => {
    const quoted = '审查员指出「该方案不具备创造性」。'
    expect(evaluateText(quoted, gated).violations.length).toBe(1)
  })
})

describe('RuleEngine 引述范围放行（quoteImmune）', () => {
  const quoted = ruleSet([
    {
      id: 'T-QIM-001',
      name: '回避绝对化表述',
      severity: 'minor',
      action: 'warn',
      check: { type: 'keyword_blocklist', keywords: ['一定'], quoteImmune: true },
    },
  ])

  it('引号内的命中被放行（引述他人原文不等于自己下结论）', () => {
    expect(evaluateText('审查员指出「该参数一定能够提高效率」，申请人认为该认定缺乏依据。', quoted).violations.length).toBe(0)
    expect(evaluateText('审查员指出『该参数一定能够提高效率』。', quoted).violations.length).toBe(0)
    expect(evaluateText('审查员指出“该参数一定能够提高效率”。', quoted).violations.length).toBe(0)
  })

  it('引号外的命中照常报出', () => {
    expect(evaluateText('该参数一定能够提高效率。', quoted).violations.length).toBe(1)
    expect(evaluateText('审查员指出「该参数能够提高效率」，该结论一定成立。', quoted).violations.length).toBe(1)
  })

  it('引号未闭合不豁免（失败方向指向检出，不指向放行）', () => {
    const unclosed = '审查员指出「该参数一定能够提高效率，申请人认为该认定缺乏依据。'
    expect(evaluateText(unclosed, quoted).violations.length).toBe(1)
  })

  it('未声明 quoteImmune 时引号不豁免', () => {
    const plain = ruleSet([
      { id: 'T-QIM-002', name: 'x', severity: 'minor', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['一定'] } },
    ])
    expect(evaluateText('审查员指出「该参数一定能够提高效率」。', plain).violations.length).toBe(1)
  })
})

describe('RuleEngine 重复引证（quote_repetition）', () => {
  const repeated = ruleSet([
    { id: 'T-QRP-001', name: '重复引证', severity: 'minor', action: 'warn', check: { type: 'quote_repetition' } },
  ])
  const quote = '「如何对喷漆、烘干时间进行控制」'

  it('同一引文出现两次即报出，证据带次数', () => {
    const result = evaluateText(`审查员认为${quote}属于公知常识。申请人认为${quote}并非公知常识。`, repeated)
    expect(result.violations.length).toBe(1)
    expect(result.violations[0]?.evidence[0]).toContain('（2 次）')
  })

  it('只出现一次的引文不报出', () => {
    expect(evaluateText(`审查员认为${quote}属于公知常识。`, repeated).violations.length).toBe(0)
  })

  it('短于 minLength 的引文不参与计数', () => {
    const short = '「控制」与「控制」重复出现。'
    expect(evaluateText(short, repeated).violations.length).toBe(0)
  })

  it('归一化空白与省略号后仍视为同一引文', () => {
    const a = '「如何对喷漆、烘干时间进行控制」'
    const b = '「如何对喷漆、\n烘干时间进行控制」'
    const c = '「如何对喷漆、…烘干时间进行控制」'
    expect(evaluateText(`${a}…${b}`, repeated).violations.length).toBe(1)
    expect(evaluateText(`${a}…${c}`, repeated).violations.length).toBe(1)
  })

  it('minLength / minOccurrences 可配置，minOccurrences 3 要求第三次出现', () => {
    const strict = ruleSet([
      { id: 'T-QRP-002', name: 'x', severity: 'minor', action: 'warn', check: { type: 'quote_repetition', minLength: 6, minOccurrences: 3 } },
    ])
    expect(evaluateText(`${quote}${quote}`, strict).violations.length).toBe(0)
    expect(evaluateText(`${quote}${quote}${quote}`, strict).violations.length).toBe(1)
  })

  it('超长引文在证据与消息中一并截断（80 字符加省略号）', () => {
    const inner = '蓄热式喷漆装置通过螺旋通道与回流腔体的配合实现对喷漆、烘干时间的精确控制并提高效率的完整说明'.repeat(2)
    const span = `「${inner}」`
    const result = evaluateText(`${span}${span}`, repeated)
    expect(result.violations.length).toBe(1)
    const truncated = `${inner}（2 次）`.slice(0, 80) + '…'
    expect(result.violations[0]?.evidence).toEqual([truncated])
    expect(result.violations[0]?.message).toBe(`重复引证：同一引文重复出现（${truncated}）`)
  })

  it('未闭合引号不参与计数（不是一对完整引文）', () => {
    expect(evaluateText(`审查员认为${quote}属于公知常识。申请人认为${quote.slice(0, -1)}并非公知常识。`, repeated).violations.length).toBe(0)
  })
})

describe('RuleEngine domain filter', () => {
  const domains = ruleSet([
    { id: 'D-NOV', name: '新颖性域', domain: 'patent_novelty', severity: 'major', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['单独对比'] } },
    { id: 'D-INF', name: '侵权域', domain: 'patent_infringement', severity: 'major', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['等同'] } },
    { id: 'D-UNI', name: '通用域', severity: 'major', action: 'warn', check: { type: 'keyword_blocklist', keywords: ['编造'] } },
  ])
  const text = '单独对比与等同的认定，不得编造。'

  const ids = (domain?: string | readonly string[]): string[] =>
    evaluateText(text, domains, undefined, domain === undefined ? undefined : { domain }).violations.map(v => v.ruleId)

  it('evaluates every rule without a filter', () => {
    expect(ids()).toEqual(['D-NOV', 'D-INF', 'D-UNI'])
  })

  it('keeps only the named domain plus rules without a domain', () => {
    expect(ids('patent_novelty')).toEqual(['D-NOV', 'D-UNI'])
  })

  it('keeps every named domain when passed a list, plus rules without a domain', () => {
    expect(ids(['patent_infringement', 'patent_novelty'])).toEqual(['D-NOV', 'D-INF', 'D-UNI'])
  })

  it('treats an empty string or empty list as no filter', () => {
    expect(ids('')).toEqual(['D-NOV', 'D-INF', 'D-UNI'])
    expect(ids([])).toEqual(['D-NOV', 'D-INF', 'D-UNI'])
  })
})
