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
    // vitest asymmetric matcher is typed any; the literal text field holds the matcher object
    const textMatcher = expect.stringContaining('通过') as string
    expect(blocks).toEqual([{ type: 'text', text: textMatcher }])
  })

  it('wires the injectable isRdkitAvailable dependency', async () => {
    let called = false
    const tool = createValidateSpecificationTool({ isRdkitAvailable: () => { called = true; return false } })
    await tool.execute({ text: VALID_SPEC }, {} as never)
    expect(called).toBe(true)
  })

  it('validates without a text field', () => {
    const out = validateSpecification({ title: '一种装置' })
    const v = out.violations.find(x => x.rule === 'sections')
    expect(v?.message).toContain('text 为空')
  })
})

describe('numeric range edge cases', () => {
  it('drops reversed ranges and keeps non-temperature units in the endpoint report', () => {
    const ranges = extractNumericRanges('温度90-20℃，压力为0.1-2MPa。')
    expect(ranges).toEqual([{ min: 0.1, max: 2, unit: 'MPa' }])
    const out = validateSpecification({ text: VALID_SPEC + '\n温度90-20℃，压力为0.1-2MPa。' })
    const v = out.violations.find(x => x.rule === 'numeric_range_endpoints')
    expect(v?.message).toContain('0.1-2MPa')
    expect(v?.message).not.toContain('20-90')
  })

  it('treats an overflowing number as not finite', () => {
    const coverage = checkNumericRangeCoverage('9'.repeat(400) + '℃')
    expect(coverage.endpointMissing).toEqual([])
  })

  it('evaluates both endpoint operands when values miss the range min', () => {
    const covered = checkNumericRangeCoverage('温度为20-90℃，优选30℃、50℃。')
    expect(covered.endpointMissing).toHaveLength(1)
    expect(covered.midpointMissing).toEqual([])
    const both = checkNumericRangeCoverage('温度为20-90℃，优选20℃、60℃、90℃。')
    expect(both.endpointMissing).toEqual([])
  })
})

describe('figure mark consistency edge cases', () => {
  const NO_DRAWING_SPEC = '## 技术领域\n本发明涉及一种装置。\n## 背景技术\n背景。\n## 发明内容\n内容。\n## 具体实施方式\n实施例1：装置。'

  it('accepts an empty figure analysis list', () => {
    expect(checkFigureMarkConsistency(VALID_SPEC, [])).toEqual([])
  })

  it('warns when the spec lacks a drawing section', () => {
    const figures = [{ usable: true, components: [{ refNumber: '1' }] }]
    const out = checkFigureMarkConsistency(NO_DRAWING_SPEC, figures)
    expect(out[0]?.message).toContain('缺少附图说明章节')
  })

  it('skips non-numeric marks and reports no missing or dangling marks', () => {
    const figures = [{ usable: true, components: [{ refNumber: '1' }, { refNumber: '2' }, { refNumber: 'U1' }] }]
    const out = checkFigureMarkConsistency('## 附图说明\n图中：1-壳体；2-缓冲层；', figures)
    expect(out).toEqual([])
  })

  it('flags a non-numeric mark in an unusable figure analysis', () => {
    const figures = [{ usable: false, components: [{ refNumber: 'x' }] }]
    const out = checkFigureMarkConsistency('## 附图说明\n图中：1-壳体；', figures)
    expect(out[0]?.severity).toBe('warning')
  })
})

describe('abstract and claim coverage edge cases', () => {
  it('accepts an abstract naming the summary figure', () => {
    const out = validateSpecification({ text: VALID_SPEC, abstract: '摘要内容。摘要附图为图1。关键词：检测。' })
    expect(out.violations.find(x => x.rule === 'abstract_drawing')).toBeUndefined()
  })

  it('warns at 50% claim coverage and passes when fully covered', () => {
    const half = validateSpecification({
      text: VALID_SPEC + '\n壳体、支架。',
      claims: '一种装置，其特征在于，包括所述壳体、所述支架、所述电路、所述传感器。',
    })
    const coverage = half.violations.find(x => x.rule === 'claim_coverage')
    expect(coverage?.severity).toBe('warning')
    expect(coverage?.message).toContain('2/4')

    const full = validateSpecification({
      text: VALID_SPEC + '\n壳体、支架、电路、传感器。',
      claims: '一种装置，其特征在于，包括所述壳体、所述支架、所述电路、所述传感器。',
    })
    expect(full.violations.find(x => x.rule === 'claim_coverage')).toBeUndefined()
  })
})

describe('validateSpecification: 结构化权利要求（单一性 A31.1）', () => {
  const UNRELATED = [
    { number: 1, kind: 'independent' as const, preamble: '一种太阳能发电装置', characterized: '包括光伏板、逆变器和支架' },
    { number: 2, kind: 'independent' as const, preamble: '一种中药煎煮设备', characterized: '包括药罐、加热盘和温控器' },
  ]

  it('技术主题无关的独立权利要求 → error，未通过', () => {
    const out = validateSpecification({ text: VALID_SPEC, claim_units: UNRELATED })
    const unity = out.violations.find(v => v.rule === 'claim_unity')
    expect(unity?.severity).toBe('error')
    expect(unity?.section).toBe('权利要求书')
    expect(unity?.message).toContain('独立权利要求 1 与 2')
    expect(unity?.message).toContain('低于 60% 阈值')
    expect(unity?.suggestion).toContain('专利法第31条第1款')
    expect(out.passed).toBe(false)
  })

  it('技术关联度偏低但达阈值 → warning', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      claim_units: [
        {
          number: 1,
          kind: 'independent',
          preamble: '一种智能门锁',
          characterized: '包括锁体、指纹识别模块、控制模块和驱动电机，指纹识别模块采集指纹后由控制模块驱动电机开合锁体',
        },
        {
          number: 2,
          kind: 'independent',
          preamble: '一种智能门锁的指纹解锁方法',
          characterized: '通过指纹识别模块采集指纹，由控制模块比对指纹特征后驱动电机开合锁体',
        },
      ],
    })
    const unity = out.violations.find(v => v.rule === 'claim_unity')
    expect(unity?.severity).toBe('warning')
    expect(unity?.message).toContain('接近 60% 阈值')
  })

  it('单一性良好时不产生违规', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      claim_units: [
        { number: 1, kind: 'independent', preamble: '一种智能门锁', characterized: '包括锁体、指纹识别模块、控制模块和驱动电机' },
        {
          number: 2,
          kind: 'independent',
          preamble: '一种智能门锁',
          characterized: '包括锁体、指纹识别模块、控制模块、驱动电机和报警模块',
        },
        { number: 3, kind: 'dependent', preamble: '根据权利要求1所述的智能门锁', characterized: '报警模块为声光报警器' },
      ],
    })
    expect(out.violations.find(v => v.rule === 'claim_unity')).toBeUndefined()
  })

  it('claim_units 为空数组时不执行单一性检查', () => {
    const out = validateSpecification({ text: VALID_SPEC, claim_units: [] })
    expect(out.violations.find(v => v.rule === 'claim_unity')).toBeUndefined()
  })
})

describe('validateSpecification: 权项—实施例覆盖矩阵', () => {
  it('全部特征未获实施例支持 → error', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      coverage_entries: [{ claim_id: 'claim_1', features: ['导电涂层', '散热结构'], embodiment_refs: [] }],
    })
    const coverage = out.violations.find(v => v.rule === 'claim_embodiment_coverage')
    expect(coverage?.severity).toBe('error')
    expect(coverage?.section).toBe('具体实施方式')
    expect(coverage?.message).toContain('权利要求 claim_1 的 2/2 项特征未获实施例支持：导电涂层、散热结构')
    expect(out.passed).toBe(false)
  })

  it('部分特征未获支持 → warning 并列出未覆盖特征', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      coverage_entries: [
        { claim_id: 'claim_2', features: ['导电涂层', '散热结构'], embodiment_refs: ['实施例1记载导电涂层采用石墨烯'] },
      ],
    })
    const coverage = out.violations.find(v => v.rule === 'claim_embodiment_coverage')
    expect(coverage?.severity).toBe('warning')
    expect(coverage?.message).toContain('1/2')
    expect(coverage?.message).toContain('散热结构')
  })

  it('全部特征获支持时不产生违规', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      coverage_entries: [
        { claim_id: 'claim_1', features: ['导电涂层'], embodiment_refs: ['实施例1记载导电涂层采用石墨烯'] },
      ],
    })
    expect(out.violations.find(v => v.rule === 'claim_embodiment_coverage')).toBeUndefined()
  })

  it('条目编号非法 → 逐条报错而不是静默丢弃', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      coverage_entries: [{ claim_id: 'claim_x', features: ['导电涂层'], embodiment_refs: ['导电涂层'] }],
    })
    const entry = out.violations.find(v => v.rule === 'claim_coverage_entry')
    expect(entry?.severity).toBe('error')
    expect(entry?.message).toContain('claim_x')
    expect(entry?.message).toContain('claim id 格式非法')
    expect(out.violations.find(v => v.rule === 'claim_embodiment_coverage')).toBeUndefined()
  })

  it('claim_units 提供时按权利要求总数约束覆盖条目编号', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      claim_units: [{ number: 1, kind: 'independent', preamble: '一种装置' }],
      coverage_entries: [{ claim_id: 'claim_7', features: ['壳体'], embodiment_refs: ['壳体'] }],
    })
    const entry = out.violations.find(v => v.rule === 'claim_coverage_entry')
    expect(entry?.message).toContain('claim 编号超出权利要求数量')
  })

  it('条目缺少技术特征 → 按条目非法报出，不给覆盖率读数', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      coverage_entries: [{ claim_id: 'claim_1', features: [], embodiment_refs: ['实施例1记载导电涂层采用石墨烯'] }],
    })
    const entry = out.violations.find(v => v.rule === 'claim_coverage_entry')
    expect(entry?.message).toContain('未提供技术特征')
    expect(out.violations.find(v => v.rule === 'claim_embodiment_coverage')).toBeUndefined()
  })

  it('条目编号断档 → 报出缺失的权利要求编号', () => {
    const out = validateSpecification({
      text: VALID_SPEC,
      claim_units: [
        { number: 1, kind: 'independent', preamble: '一种装置' },
        { number: 2, kind: 'dependent', preamble: '根据权利要求 1' },
        { number: 3, kind: 'dependent', preamble: '根据权利要求 1' },
      ],
      coverage_entries: [
        { claim_id: 'claim_1', features: ['导电涂层'], embodiment_refs: ['实施例1记载导电涂层'] },
        { claim_id: 'claim_3', features: ['散热结构'], embodiment_refs: ['实施例2记载散热结构'] },
      ],
    })
    const gap = out.violations.find(v => v.rule === 'claim_coverage_gap')
    expect(gap?.severity).toBe('warning')
    expect(gap?.message).toContain('缺少权利要求 2')
  })
})

describe('renderSpecification with section and no suggestion', () => {
  it('renders section markers and bare lines', () => {
    const out = renderSpecification({
      passed: false,
      score: 0.9,
      violations: [
        { rule: 'sections', severity: 'error' as const, section: '摘要', message: '摘要过长', suggestion: '压缩' },
        { rule: 'clarity', severity: 'warning' as const, message: '模糊表述' },
      ],
    })
    expect(out).toContain('（摘要）')
    expect(out).toContain('压缩')
    expect(out).not.toContain('模糊表述（')
  })
})
