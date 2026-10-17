import { describe, expect, it } from 'vitest'
import { DraftSpecificationHandler } from '../src/atoms/draft-specification.ts'
import { SpecCheckHandler } from '../src/atoms/spec-check.ts'

const handler = new DraftSpecificationHandler()
const run = (state: Record<string, unknown>) => handler.execute({ state })

describe('DraftSpecificationHandler', () => {
  it('assembles the five specification parts from the workflow state', async () => {
    const out = await run({
      title: '一种检测装置',
      source_text: '本实施例提供一种检测装置，包括壳体和设置在壳体内的弹簧。',
      problems: ['检测精度不足', 42, ''],
      effects: ['提高检测精度，误差由 2 毫米降至 1 毫米。'],
      embodiments: ['本实施例提供一种检测装置，包括壳体和设置在壳体内的弹簧。'],
      drawing_descriptions: ['整体结构示意图'],
      background: '现有检测装置的检测精度不足。',
      tech_domain: 'mechanical',
      patent_type: 'invention',
      has_drawings: true,
    })
    const specification = String(out.specification)
    for (const heading of ['技术领域', '背景技术', '发明内容', '附图说明', '具体实施方式']) {
      expect(specification).toContain(`## ${heading}`)
    }
    expect(specification).toContain('机械技术领域')
    expect(specification).toContain('检测精度不足')
    expect(specification).toContain('误差由 2 毫米降至 1 毫米')
    expect(specification).toContain('图1为整体结构示意图')
    expect(specification).toContain('实施例1：本实施例提供一种检测装置')
    expect(out.draft_specification_warnings).toEqual([])
  })

  it('derives the title from the first source line and falls back to the solution as the embodiment', async () => {
    const out = await run({
      text: '# 检测装置\n本实施例提供一种检测装置，包括壳体。',
    })
    const specification = String(out.specification)
    expect(specification).toContain('一种检测装置')
    expect(specification).toContain('【撰写指引】记载要解决的技术问题')
    expect(specification).toContain('实施例1：# 检测装置')
  })

  it('uses a generic title when the first line is too long', async () => {
    const out = await run({ input: '这是一个没有换行且超过二十五个字的技术方案描述文本用于测试标题回退' })
    expect(String(out.specification)).toContain('一种技术方案')
  })

  it('prefers explicit problem and effect strings over extracted arrays', async () => {
    const out = await run({
      source_text: '一种检测装置，包括壳体。',
      technical_problem: '提升检测精度',
      beneficial_effects: '误差降低 50%',
      problems: ['被忽略的问题'],
      effects: ['被忽略的效果'],
    })
    const specification = String(out.specification)
    expect(specification).toContain('提升检测精度')
    expect(specification).toContain('误差降低 50%')
    expect(specification).not.toContain('被忽略的问题')
    expect(specification).not.toContain('被忽略的效果')
  })

  it('falls back to a generic title when the first line has no title text', async () => {
    const out = await run({ text: '###\n本实施例提供一种检测装置。' })
    expect(String(out.specification)).toContain('一种技术方案')
  })

  it('ignores unknown enums and non-string list entries', async () => {
    const out = await run({
      source_text: '一种检测装置，包括壳体。',
      problems: [null],
      effects: [1],
      tech_domain: 'unknown',
      patent_type: 'design',
    })
    const specification = String(out.specification)
    expect(specification).toContain('本发明涉及')
    expect(specification).toContain('【撰写指引】记载要解决的技术问题')
    expect(specification).toContain('【撰写指引】记载有益效果')
  })

  it('fails loud as degraded when no material is supplied', async () => {
    const out = await run({})
    expect(String(out._error)).toContain('[draft-specification]')
    expect(String(out._error)).toContain('输入为空')
  })

  it('produces a draft that spec-check accepts in spec mode', async () => {
    const draft = await run({
      title: '检测装置',
      source_text: '本实施例提供一种检测装置，包括壳体和设置在壳体内的弹簧。',
      problems: ['检测精度不足'],
      effects: ['提高检测精度，误差由 2 毫米降至 1 毫米。'],
      embodiments: ['本实施例提供一种检测装置，包括壳体和设置在壳体内的弹簧。'],
      drawing_descriptions: ['整体结构示意图'],
      has_drawings: true,
    })
    const checked = await new SpecCheckHandler().execute({
      state: {
        ...draft,
        mode: 'spec',
        text_key: 'specification',
        claims_key: 'claims_draft',
        claims_draft: '1. 一种检测装置，其特征在于，包括壳体和弹簧。',
      },
    })
    expect(checked.spec_check_passed).toBe(true)
    expect(checked.specification_check_passed).toBe(true)
    expect(String(checked.specification_check_report)).toContain('说明书合规检查')
    expect(String(checked.specification_check_report)).toContain('通过')
  })
})
