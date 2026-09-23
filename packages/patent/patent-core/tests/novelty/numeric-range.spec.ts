import { describe, expect, it } from 'vitest'
import {
  analyzeNumericRanges,
  crossCheckNumericVerdict,
  extractNumericFindings,
  extractNumericRanges,
  isNumericVerdict,
  readNumericVerdict,
  type NumericRangeAnalysis,
} from '../../src/novelty/index.ts'

// 用例表按 Mady domains/novelty/numeric_range_test.go 的情形划分重写（MIT，同作者）；
// 重叠情形改用语义命名，不断言审查指南的条文编号。

const prior = (text: string): { docId: string; text: string } => ({ docId: 'prior_art_1', text })
const claim = (text: string): { id: string; text: string } => ({ id: 'claim', text })

const analyze = (claimText: string, priorText: string): NumericRangeAnalysis =>
  analyzeNumericRanges({ claims: [claim(claimText)], priorArt: [prior(priorText)] })

describe('extractNumericFindings: 数值表述提取', () => {
  it('识别区间写法（连字符/波浪号/至/到/破折号）并归一上下界', () => {
    const findings = extractNumericFindings('温度为 90-20℃，厚度 5～10mm，长度 5~10cm，宽度 5至10m，高度 5到10mm')
    expect(findings.map(f => [f.expression, f.lower, f.upper])).toEqual([
      ['90-20', 20, 90],
      ['5～10', 5, 10],
      ['5~10', 5, 10],
      ['5至10', 5, 10],
      ['5到10', 5, 10],
    ])
  })

  it('识别单边表述，长方向词优先不被截断', () => {
    const findings = extractNumericFindings('温度不低于10℃，压力大于等于 2MPa，厚度至少 5mm，速度 >10m/s，时间不超过 30min')
    expect(findings.map(f => f.expression)).toEqual(['不低于10', '大于等于 2', '至少 5', '>10', '不超过 30'])
  })

  it('带单位即强发现，单位归一化并排除非单位汉字', () => {
    const byExpression = new Map(extractNumericFindings('50-80°C 时 60℃ 与 70°C 对比，厚度 5mm，编号 3个，温度 100度')
      .map(finding => [finding.expression, finding]))
    expect(byExpression.get('50-80')?.unit).toBe('°')
    expect(byExpression.get('60')?.unit).toBe('°')
    expect(byExpression.get('70')?.unit).toBe('°')
    expect(byExpression.get('5')?.unit).toBe('mm')
    expect(byExpression.get('3')?.unit).toBe('')
    expect(byExpression.get('100')?.unit).toBe('度')
    expect(byExpression.get('3')?.strong).toBe(false)
  })

  it('无单位数值仍记录（弱发现），不参与判定', () => {
    const findings = extractNumericFindings('权利要求1-3任一项所述', { claimId: 'claim_1' })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ expression: '1-3', unit: '', strong: false, claimId: 'claim_1' })
  })

  it('按出现位置排序，范围与单边表述混排', () => {
    const findings = extractNumericFindings('温度为 50-80°C，厚度至少 5mm，重量 1.5-2.5kg')
    expect(findings.map(f => f.expression)).toEqual(['50-80', '至少 5', '1.5-2.5'])
  })

  it('无范围/单边表述时兜底提取独立数值（数值点）', () => {
    const findings = extractNumericFindings('温度为 70℃ 时')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ expression: '70', isPoint: true, unit: '°', strong: true })
  })

  it('对比文件侧发现带 docId', () => {
    expect(extractNumericFindings('50-80℃', { docId: 'prior_art_2' })[0]?.docId).toBe('prior_art_2')
  })
})

describe('extractNumericFindings: 连接符前的单位（词表与 validate_specification 共享）', () => {
  it('「数值+单位+连接符+数值」读成一个区间，不拆成两个数值点', () => {
    const findings = extractNumericFindings('温度 20℃ 至 90℃，厚度 5mg-10mg，宽度 10mm~20mm')
    expect(findings.map(f => ({
      expression: f.expression,
      lower: f.lower,
      upper: f.upper,
      unit: f.unit,
      isPoint: f.isPoint,
    }))).toEqual([
      { expression: '20℃ 至 90', lower: 20, upper: 90, unit: '°', isPoint: false },
      { expression: '5mg-10', lower: 5, upper: 10, unit: 'mg', isPoint: false },
      { expression: '10mm~20', lower: 10, upper: 20, unit: 'mm', isPoint: false },
    ])
  })

  it('连接符集含 en dash 与「到」', () => {
    const findings = extractNumericFindings('温度 20–90℃，压力 20到30MPa')
    expect(findings.map(f => [f.lower, f.upper, f.unit])).toEqual([
      [20, 90, '°'],
      [20, 30, 'mpa'],
    ])
  })

  it('尾随单位缺席时用连接符前写的单位，不把强发现降级为弱发现', () => {
    const findings = extractNumericFindings('温度 20℃至90，成功率约 70%—75，重量比 50-80')
    expect(findings.map(f => ({ expression: f.expression, unit: f.unit, strong: f.strong }))).toEqual([
      { expression: '20℃至90', unit: '°', strong: true },
      { expression: '70%—75', unit: '%', strong: true },
      { expression: '50-80', unit: '', strong: false },
    ])
  })
})

describe('extractNumericRanges: 面向模型的片段清单', () => {
  it('只保留范围与单边表述，去重且按位置排序', () => {
    expect(extractNumericRanges('温度范围为 50-80°C，厚度至少 5mm，速度大于 10m/s，压力 ≤ 2MPa，重量 1.5-2.5kg'))
      .toEqual(['50-80', '至少 5', '大于 10', '≤ 2', '1.5-2.5'])
    expect(extractNumericRanges('温度为 70℃')).toEqual([])
    expect(extractNumericRanges('50-80℃ 与 50-80℃')).toEqual(['50-80'])
    expect(extractNumericRanges('无任何数值')).toEqual([])
  })
})

describe('analyzeNumericRanges: 区间重叠判定', () => {
  it('区间重叠 → overlapped', () => {
    const analysis = analyze('温度为 50-80℃', 'D1 公开温度为 60-90℃')
    expect(analysis.verdict).toBe('overlapped')
    expect(analysis.overlaps).toHaveLength(1)
    expect(analysis.overlaps[0]?.kind).toBe('overlapped')
    expect(analysis.overlaps[0]?.note).toContain('破坏新颖性')
    expect(analysis.summary).toContain('权利要求 1 处数值表述（强 1）')
  })

  it('数值点落在对比文件范围内且无共同端点 → inside_without_endpoint', () => {
    const analysis = analyze('温度为 70℃', 'D1 公开温度为 60-90℃')
    expect(analysis.verdict).toBe('inside_without_endpoint')
    expect(analysis.overlaps[0]?.kind).toBe('inside_without_endpoint')
    expect(analysis.overlaps[0]?.note).toContain('不破坏新颖性')
  })

  it('数值点与对比文件范围共有端点 → 仍为破坏性重叠', () => {
    const analysis = analyze('温度为 60℃', 'D1 公开温度为 60-90℃')
    expect(analysis.verdict).toBe('overlapped')
    expect(analysis.overlaps[0]?.kind).toBe('overlapped')
  })

  it('区间不相交 → no_overlap', () => {
    const analysis = analyze('温度为 50-80℃', 'D1 公开温度为 100-200℃')
    expect(analysis.verdict).toBe('no_overlap')
    expect(analysis.overlaps).toEqual([])
    expect(analysis.summary).toContain('未发现数值范围重叠')
  })

  it('单位不同不可比 → no_overlap 且不记录重叠对', () => {
    const analysis = analyze('长度为 50-80mm', 'D1 公开温度为 50-80℃')
    expect(analysis.verdict).toBe('no_overlap')
    expect(analysis.overlaps).toEqual([])
  })

  it('单边表述按 ±Infinity 参与区间相交', () => {
    expect(analyze('温度不低于 70℃', 'D1 公开温度为 100-200℃').verdict).toBe('overlapped')
    expect(analyze('温度不超过 80℃', 'D1 公开温度为 100-200℃').verdict).toBe('no_overlap')
  })

  it('任一强发现缺失 → inconclusive', () => {
    expect(analyze('温度为 50-80', 'D1 公开温度为 60-90℃').verdict).toBe('inconclusive')
    expect(analyze('温度为 50-80℃', 'D1 公开了加热装置').verdict).toBe('inconclusive')
    expect(analyze('温度为 50-80℃', '').verdict).toBe('inconclusive')
    expect(analyze('温度为 50-80', 'D1 公开温度为 60-90').verdict).toBe('inconclusive')
    expect(analyzeNumericRanges({ claims: [], priorArt: [] }).verdict).toBe('inconclusive')
  })

  it('同时存在破坏性与提示性重叠 → 取破坏性结论并列出全部重叠对', () => {
    const analysis = analyze('温度为 50-80℃，湿度为 70%', 'D1 公开温度为 60-90℃，湿度为 50-90%')
    expect(analysis.verdict).toBe('overlapped')
    expect(analysis.overlaps).toHaveLength(2)
    expect(analysis.summary).toContain('[claim × prior_art_1]')
    expect(analysis.summary).toContain('（inside_without_endpoint）')
  })

  it('inconclusive 的摘要说明无法判定', () => {
    expect(analyze('温度为 50-80', '').summary).toContain('未提取到足够的带单位数值表述，无法判定')
  })
})

describe('crossCheckNumericVerdict: 与语义轨对照', () => {
  it('结论相同 → agree', () => {
    const analysis = analyze('温度为 50-80℃', 'D1 公开温度为 60-90℃')
    expect(crossCheckNumericVerdict(analysis, 'overlapped').llmAgreement).toBe('agree')
  })

  it('具体结论不同 → disagree 且在摘要中提示复核', () => {
    const analysis = analyze('温度为 50-80℃', 'D1 公开温度为 60-90℃')
    const checked = crossCheckNumericVerdict(analysis, 'no_overlap')
    expect(checked.llmAgreement).toBe('disagree')
    expect(checked.summary).toContain('与语义轨结论不一致，请重点复核')
    expect(checked.verdict).toBe('overlapped')
  })

  it('确定性结论无法判定或 LLM 结论缺失 → n_a', () => {
    const inconclusive = analyze('温度为 50-80', '')
    expect(crossCheckNumericVerdict(inconclusive, 'overlapped').llmAgreement).toBe('n_a')
    const determinate = analyze('温度为 50-80℃', 'D1 公开温度为 60-90℃')
    expect(crossCheckNumericVerdict(determinate, undefined).llmAgreement).toBe('n_a')
    expect(crossCheckNumericVerdict(determinate, 'bogus').llmAgreement).toBe('n_a')
    expect(crossCheckNumericVerdict(determinate, undefined).summary).not.toContain('与语义轨')
  })
})

describe('readNumericVerdict / isNumericVerdict', () => {
  it('读取 JSON 结论，容忍代码围栏', () => {
    expect(readNumericVerdict('{"verdict":"overlapped","assessments":[]}')).toBe('overlapped')
    expect(readNumericVerdict('```json\n{"verdict":"no_overlap"}\n```')).toBe('no_overlap')
  })

  it('无法识别时返回 undefined', () => {
    expect(readNumericVerdict('')).toBeUndefined()
    expect(readNumericVerdict('不是 JSON')).toBeUndefined()
    expect(readNumericVerdict('[1,2]')).toBeUndefined()
    expect(readNumericVerdict('{"verdict":"maybe"}')).toBeUndefined()
    expect(readNumericVerdict('{"assessments":[]}')).toBeUndefined()
  })

  it('类型守卫只接受四个枚举值', () => {
    expect(isNumericVerdict('inside_without_endpoint')).toBe(true)
    expect(isNumericVerdict('inconclusive')).toBe(true)
    expect(isNumericVerdict('overlapped ')).toBe(false)
    expect(isNumericVerdict(undefined)).toBe(false)
  })
})
