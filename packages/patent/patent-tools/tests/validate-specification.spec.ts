import { describe, expect, it } from 'vitest'
import {
  checkChemicalCharacterization,
  checkEffectQuantification,
  checkFigureMarkConsistency,
  checkNumericRangeCoverage,
  checkSmilesValidity,
  computeSpecScore,
  createValidateSpecificationTool,
  extractClaimFeatures,
  extractNumericRanges,
  renderSpecification,
  validateSpecification,
} from '../src/tool/validate-specification.ts'

/** A specification text that passes every deterministic rule. */
const VALID_SPEC = [
  '## 技术领域',
  '本发明涉及一种检测装置。',
  '## 背景技术',
  '现有检测装置存在精度不足的问题。',
  '## 发明内容',
  '本发明提供一种高精度检测装置。',
  '## 附图说明',
  '图1是本发明实施例的结构示意图。',
  '## 具体实施方式',
  '实施例1：如图1所示，本实施例提供一种检测装置，包括壳体。',
].join('\n')

describe('validateSpecification', () => {
  it('passes a complete specification', () => {
    const out = validateSpecification({ text: VALID_SPEC })
    expect(out).toEqual({ passed: true, score: 1, violations: [] })
  })

  it('reports missing required sections', () => {
    const out = validateSpecification({ text: '## 技术领域\n本发明涉及一种装置。' })
    const v = out.violations.find(x => x.rule === 'sections')
    expect(out.passed).toBe(false)
    expect(v?.severity).toBe('error')
    expect(v?.message).toContain('缺少必要章节')
  })

  it('reports an empty specification text', () => {
    const out = validateSpecification({ text: '' })
    const v = out.violations.find(x => x.rule === 'sections')
    expect(v?.message).toContain('text 为空')
  })

  it('reports a title over 25 characters', () => {
    const out = validateSpecification({ text: VALID_SPEC, title: '一'.repeat(26) })
    const v = out.violations.find(x => x.rule === 'title_length')
    expect(v?.severity).toBe('error')
    expect(v?.message).toContain('26')
  })

  it('reports an abstract over 300 characters', () => {
    const out = validateSpecification({ text: VALID_SPEC, abstract: '字'.repeat(301) })
    const v = out.violations.find(x => x.rule === 'abstract_length')
    expect(v?.severity).toBe('error')
  })

  it('reports an abstract without keywords', () => {
    const out = validateSpecification({ text: VALID_SPEC, abstract: '一种检测装置的摘要。' })
    const v = out.violations.find(x => x.rule === 'abstract_keywords')
    expect(v?.severity).toBe('warning')
  })

  it('reports an abstract without a drawing reference', () => {
    const out = validateSpecification({ text: VALID_SPEC, abstract: '摘要内容。关键词：检测。' })
    const v = out.violations.find(x => x.rule === 'abstract_drawing')
    expect(v?.severity).toBe('warning')
  })

  it('reports vague wording', () => {
    const out = validateSpecification({ text: VALID_SPEC + '约 10% 的实施例。' })
    const v = out.violations.find(x => x.rule === 'clarity')
    expect(v?.severity).toBe('warning')
    expect(v?.message).toContain('约')
  })

  it('reports body figure references without a drawing section', () => {
    const text = '## 技术领域\n本发明涉及一种装置。\n## 背景技术\n背景。\n## 发明内容\n发明内容，如图1所示。\n## 具体实施方式\n实施例1：装置。'
    const out = validateSpecification({ text })
    const v = out.violations.find(x => x.rule === 'drawings')
    expect(v?.severity).toBe('warning')
    expect(v?.message).toContain('缺少附图说明章节')
  })

  it('reports a specification without embodiments', () => {
    const text = '## 技术领域\n本发明涉及一种装置。\n## 背景技术\n背景。\n## 发明内容\n发明内容。\n## 附图说明\n无附图。\n## 具体实施方式\n实施过程描述。'
    const out = validateSpecification({ text })
    const v = out.violations.find(x => x.rule === 'embodiments')
    expect(v?.severity).toBe('error')
  })

  it('reports numeric-range endpoint and midpoint gaps', () => {
    const out = validateSpecification({ text: VALID_SPEC + '\n所述温度为20-90℃。' })
    const endpoints = out.violations.find(x => x.rule === 'numeric_range_endpoints')
    const midpoints = out.violations.find(x => x.rule === 'numeric_range_midpoint')
    expect(endpoints?.severity).toBe('error')
    expect(midpoints?.severity).toBe('warning')
  })

  it('reports unquantified effect claims', () => {
    const out = validateSpecification({ text: VALID_SPEC + '\n所述装置效果显著提升。' })
    const v = out.violations.find(x => x.rule === 'effect_data_quantified')
    expect(v?.severity).toBe('warning')
  })

  it('reports missing chemical characterization for chemical domain', () => {
    const out = validateSpecification({ text: VALID_SPEC, tech_domain: 'chemical' })
    const v = out.violations.find(x => x.rule === 'chemical_characterization')
    expect(v?.severity).toBe('warning')
  })

  it('skips chemical characterization when any technique is present', () => {
    const out = validateSpecification({ text: VALID_SPEC + '\n经NMR表征。', tech_domain: 'chemical' })
    expect(out.violations.find(x => x.rule === 'chemical_characterization')).toBeUndefined()
  })

  it('skips chemical characterization for non-chemical domains', () => {
    const out = validateSpecification({ text: VALID_SPEC, tech_domain: 'mechanical' })
    expect(out.violations.find(x => x.rule === 'chemical_characterization')).toBeUndefined()
  })

  it('reports claim features missing from the specification', () => {
    const claims = '一种检测装置，其特征在于，包括所述壳体、所述传感器、所述支架。'
    const out = validateSpecification({ text: VALID_SPEC, claims })
    const v = out.violations.find(x => x.rule === 'claim_coverage')
    expect(v?.severity).toBe('error')
    expect(v?.message).toContain('2/3')
  })
})

describe('numeric range helpers', () => {
  it('extracts numeric ranges and normalizes temperature units', () => {
    expect(extractNumericRanges('温度为20-90℃，压力为0.1-2MPa。')).toEqual([
      { min: 20, max: 90, unit: '°' },
      { min: 0.1, max: 2, unit: 'MPa' },
    ])
  })

  it('detects missing endpoints and midpoints', () => {
    const r = checkNumericRangeCoverage('温度为20-90℃。')
    expect(r.endpointMissing).toEqual([{ min: 20, max: 90, unit: '°' }])
    expect(r.midpointMissing).toEqual([{ min: 20, max: 90, unit: '°' }])
  })

  it('passes when endpoints and midpoint are present', () => {
    const r = checkNumericRangeCoverage('温度为20-90℃，优选20℃、60℃、90℃。')
    expect(r.endpointMissing).toEqual([])
    expect(r.midpointMissing).toEqual([])
  })
})

describe('effect quantification', () => {
  it('flags unquantified effect sentences', () => {
    expect(checkEffectQuantification('所述装置效果显著提升。')).toEqual(['所述装置效果显著提升'])
    expect(checkEffectQuantification('所述装置效果提升了20%。')).toEqual([])
  })
})

describe('chemical characterization', () => {
  it('returns the fully-missing characterization terms', () => {
    const missing = checkChemicalCharacterization('经NMR和MS表征。')
    expect(missing).not.toContain('NMR')
    expect(missing).not.toContain('MS')
    expect(checkChemicalCharacterization('')).toHaveLength(21)
  })
})

describe('claim feature extraction', () => {
  it('dedupes features and filters generic terms', () => {
    const features = extractClaimFeatures('所述壳体与所述壳体连接，还包括所述装置。')
    expect(features).toContain('壳体')
    expect(features).not.toContain('装置')
  })
})

describe('figure mark consistency', () => {
  const FIGURE_SPEC = '## 技术领域\n本发明涉及一种装置。\n## 背景技术\n背景。\n## 发明内容\n内容。\n## 附图说明\n图1是结构示意图；图中：1-壳体；2-缓冲层；\n## 具体实施方式\n实施例1：如图1所示。'

  it('reports missing and dangling figure marks', () => {
    const figures = [{ usable: true, components: [{ refNumber: '1' }, { refNumber: '3' }] }]
    const out = validateSpecification({ text: FIGURE_SPEC, figure_analysis: figures })
    const missing = out.violations.find(x => x.rule === 'figure_mark_consistency' && x.severity === 'warning')
    const dangling = out.violations.find(x => x.rule === 'figure_mark_consistency' && x.severity === 'error')
    expect(missing?.message).toContain('3')
    expect(dangling?.message).toContain('2')
  })

  it('warns when figures are unusable', () => {
    const figures = [{ usable: false, components: [] }]
    const out = checkFigureMarkConsistency(FIGURE_SPEC, figures)
    expect(out[0]?.message).toContain('不可用')
  })
})

describe('checkSmilesValidity', () => {
  it('reports nothing when RDKit is unavailable (dsh default)', () => {
    expect(checkSmilesValidity('CC(=O)O', () => false)).toEqual([])
  })

  it('reports nothing even when an availability override is injected', () => {
    expect(checkSmilesValidity('CC(=O)O', () => true)).toEqual([])
  })
})

describe('computeSpecScore', () => {
  it('scores errors and warnings', () => {
    expect(computeSpecScore([])).toEqual({ passed: true, score: 1 })
    expect(computeSpecScore([{ rule: 'x', severity: 'error', message: '' }])).toEqual({ passed: false, score: 0.75 })
    expect(computeSpecScore([{ rule: 'x', severity: 'warning', message: '' }])).toEqual({ passed: true, score: 0.9 })
  })
})

describe('renderSpecification', () => {
  it('renders pass and violation prose', () => {
    expect(renderSpecification({ passed: true, score: 1, violations: [] })).toContain('通过')
    const fail = { passed: false, score: 0.75, violations: [{ rule: 'sections', severity: 'error' as const, message: '缺少必要章节', suggestion: '请补充' }] }
    expect(renderSpecification(fail)).toContain('未通过')
    expect(renderSpecification(fail)).toContain('请补充')
  })
})

describe('createValidateSpecificationTool', () => {
  it('returns the validate_specification tool definition', async () => {
    const tool = createValidateSpecificationTool()
    expect(tool.name).toBe('validate_specification')
    expect(typeof tool.execute).toBe('function')
    expect(typeof tool.output.render).toBe('function')
    const value = await tool.execute({ text: VALID_SPEC }, {} as never)
    expect(value).toEqual({ passed: true, score: 1, violations: [] })
  })

  it('renders model-facing text', () => {
    const tool = createValidateSpecificationTool()
    const blocks = tool.output.render({}, { passed: true, score: 1, violations: [] })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('通过') }])
  })

  it('wires the injectable isRdkitAvailable dependency', async () => {
    let called = false
    const tool = createValidateSpecificationTool({ isRdkitAvailable: () => { called = true; return false } })
    await tool.execute({ text: VALID_SPEC }, {} as never)
    expect(called).toBe(true)
  })
})
