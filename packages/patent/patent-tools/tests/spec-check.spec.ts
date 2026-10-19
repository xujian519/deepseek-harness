import { describe, expect, it } from 'vitest'
import type { SpecViolation } from '../src/tool/spec-types.ts'
import { SpecCheckHandler } from '../src/atoms/spec-check.ts'

const handler = new SpecCheckHandler()

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

const run = (state: Record<string, unknown>) => handler.execute({ state })

describe('SpecCheckHandler', () => {
  it('spec mode passes a complete specification and reports the spec rule set', async () => {
    const out = await run({ mode: 'spec', text: VALID_SPEC })
    expect(out.spec_check_passed).toBe(true)
    expect(out.spec_check_score).toBe(1)
    expect(out.spec_check_violations).toEqual([])
    expect(String(out.spec_check_report)).toContain('说明书合规检查')
    expect(String(out.spec_check_report)).toContain('通过')
    expect(out.specification_check_passed).toBe(true)
    expect(out.specification_check_report).toBe(out.spec_check_report)
  })

  it('spec mode reports a missing required section as an error', async () => {
    const out = await run({ mode: 'spec', text: '## 技术领域\n本发明涉及一种检测装置。' })
    expect(out.spec_check_passed).toBe(false)
    const violations = out.spec_check_violations as SpecViolation[]
    const sections = violations.find(v => v.rule === 'sections')
    expect(sections?.severity).toBe('error')
    expect(String(out.spec_check_report)).toContain('缺少必要章节')
    expect(out.specification_check_passed).toBe(false)
  })

  it('claims mode rejects claim features absent from the specification (A26.4)', async () => {
    const claims = '1. 一种检测装置，其特征在于，包括所述壳体、所述弹簧和所述电机。'
    const out = await run({ mode: 'claims', text: VALID_SPEC, claims })
    expect(out.spec_check_passed).toBe(false)
    const violations = out.spec_check_violations as SpecViolation[]
    const coverage = violations.find(v => v.rule === 'claim_coverage')
    expect(coverage?.severity).toBe('error')
    expect(coverage?.message).toContain('弹簧')
    expect(String(out.spec_check_report)).toContain('权利要求合规检查')
    // claims 模式不写 A26.3 的说明书报告，避免 legal-gaps 把权项检查当成充分公开检查。
    expect(out.specification_check_report).toBeUndefined()
    expect(out.specification_check_passed).toBeUndefined()
  })

  it('claims mode passes when every claim feature is recorded in the specification', async () => {
    const claims = '1. 一种检测装置，其特征在于，包括所述壳体、所述弹簧和所述电机。'
    const out = await run({ mode: 'claims', text: `${VALID_SPEC}\n本实施例的壳体、弹簧和电机协同工作。`, claims })
    expect(out.spec_check_passed).toBe(true)
    expect(out.spec_check_violations).toEqual([])
  })

  it('claims mode reports independent-claim unity with structured claim units (A31.1)', async () => {
    const out = await run({
      mode: 'claims',
      text: VALID_SPEC,
      claims: '1. 一种检测装置。\n2. 一种通信方法。',
      claim_units: [
        { number: 1, kind: 'independent', preamble: '一种检测装置', characterized: '包括壳体与弹簧' },
        { number: 2, kind: 'independent', preamble: '一种通信方法', characterized: '发送数据包' },
      ],
    })
    expect(out.spec_check_passed).toBe(false)
    const violations = out.spec_check_violations as SpecViolation[]
    const unity = violations.find(v => v.rule === 'claim_unity')
    expect(unity?.severity).toBe('error')
    expect(unity?.message).toContain('单一性')
  })

  it('reads the text and claims from the configured keys', async () => {
    const out = await run({
      mode: 'claims',
      text_key: 'source_text',
      claims_key: 'draft',
      source_text: VALID_SPEC,
      draft: '1. 一种检测装置，其特征在于，包括所述壳体。',
    })
    expect(out.spec_check_passed).toBe(true)
  })

  it('reads claim units, coverage entries and tech domain through their configured keys', async () => {
    const out = await run({
      mode: 'claims',
      text: VALID_SPEC,
      claims: '1. 一种检测装置。\n2. 一种通信方法。',
      tech_domain: 'mechanical',
      claim_units_key: 'units',
      coverage_entries_key: 'coverage',
      units: [
        { number: 1, kind: 'independent', preamble: '一种检测装置', characterized: '包括壳体与弹簧' },
        { number: 2, kind: 'independent', preamble: '一种通信方法', characterized: '发送数据包' },
      ],
      coverage: [{ claim_id: 'claim_1', features: ['壳体'], embodiment_refs: ['壳体'] }],
    })
    const violations = out.spec_check_violations as SpecViolation[]
    expect(violations.find(v => v.rule === 'claim_unity')).toBeDefined()
    expect(violations.find(v => v.rule === 'claim_embodiment_coverage')).toBeUndefined()
  })

  it('reads coverage entries from the default key', async () => {
    const out = await run({
      mode: 'claims',
      text: VALID_SPEC,
      claims: '1. 一种检测装置，其特征在于，包括所述壳体。',
      coverage_entries: [{ claim_id: 'claim_1', features: ['壳体'], embodiment_refs: ['壳体'] }],
    })
    expect(out.spec_check_passed).toBe(true)
  })

  it('fails loud as degraded when the specification text is missing', async () => {
    const out = await run({ mode: 'spec' })
    expect(String(out._error)).toContain('[spec-check]')
    expect(String(out._error)).toContain('说明书文本缺失')
  })

  it('fails loud as degraded when claims mode has no claims text', async () => {
    const out = await run({ mode: 'claims', text: VALID_SPEC })
    expect(String(out._error)).toContain('[spec-check]')
    expect(String(out._error)).toContain('权利要求文本缺失')
  })

  it('rejects an unknown mode instead of silently falling back', async () => {
    const out = await run({ mode: 'claims2', text: VALID_SPEC })
    expect(String(out._error)).toContain('[spec-check]')
    expect(String(out._error)).toContain('未知 mode')
  })
})
