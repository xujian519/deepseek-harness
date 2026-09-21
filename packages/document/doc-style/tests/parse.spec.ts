// 上游来源：Mady 项目 `domains/config/style_test.go` 的 `TestLoadStyle`（完整字段解析）与
// `TestLoadStyle_MissingFields`（name/domain 必填）。上游未校验其余字段；本包把每个字段的
// 非法值都作为资产错误报出，故这些用例覆盖每个分支。

import { describe, expect, it } from 'vitest'
import { parseStyleAsset } from '../src/parse.ts'
import { DocumentStyleError } from '../src/types.ts'

/** 上游 `TestLoadStyle` 的资产内容（去掉 YAML 缩进以提高可读性）。 */
const UPSTREAM_STYLE = [
  'name: patent-standard',
  'domain: patent',
  'version: "1.0"',
  'sections:',
  '  tone:',
  '    formality: professional',
  '    perspective: third',
  '    language: zh-CN',
  '  voice:',
  '    principles:',
  '      - 如实呈现，留有余地',
  '      - 不说绝对结论',
  '  anti_patterns:',
  '    - word: 绝对',
  '      replace: 通常',
  '      severity: block',
  '  disclaimers:',
  '    patent_analysis: "本分析由 AI 辅助生成，不构成正式法律意见。"',
  '  citation:',
  '    style: inline',
  '    format: "[{id}]"',
  '  output_conventions:',
  '    confidence_label: true',
  '',
].join('\n')

/** 最小合法资产，只声明两个必填字段。 */
const MINIMAL_STYLE = 'name: minimal\ndomain: chat\n'

/** Parse a style asset, expecting it to be rejected. */
function rejects(source: string): string {
  try {
    parseStyleAsset(source, 'test.yaml')
  } catch (error) {
    if (error instanceof DocumentStyleError) return error.message
    throw error
  }
  throw new Error(`expected ${JSON.stringify(source)} to be rejected`)
}

describe('parseStyleAsset', () => {
  it('parses the upstream asset with every section declared', () => {
    const style = parseStyleAsset(UPSTREAM_STYLE, 'patent-standard.yaml')
    expect(style.name).toBe('patent-standard')
    expect(style.domain).toBe('patent')
    expect(style.version).toBe('1.0')
    expect(style.sections.tone).toEqual({ formality: 'professional', perspective: 'third', language: 'zh-CN' })
    expect(style.sections.voice.principles).toEqual(['如实呈现，留有余地', '不说绝对结论'])
    expect(style.sections.antiPatterns).toEqual([{ word: '绝对', replace: '通常', severity: 'block' }])
    expect([...style.sections.disclaimers]).toEqual([['patent_analysis', '本分析由 AI 辅助生成，不构成正式法律意见。']])
    expect(style.sections.citation).toEqual({ style: 'inline', format: '[{id}]' })
    expect(style.sections.outputConventions).toEqual({ confidenceLabel: true, weakVisual: false })
  })

  it('keeps the empty value of every section the asset omits', () => {
    const style = parseStyleAsset(MINIMAL_STYLE, 'minimal.yaml')
    expect(style.version).toBe('')
    expect(style.sections.tone).toEqual({ formality: '', perspective: '', language: '' })
    expect(style.sections.voice.principles).toEqual([])
    expect(style.sections.antiPatterns).toEqual([])
    expect(style.sections.disclaimers.size).toBe(0)
    expect(style.sections.citation).toEqual({ style: '', format: '' })
    expect(style.sections.outputConventions).toEqual({ confidenceLabel: false, weakVisual: false })
  })

  it('accepts the explicit empty declarations the shipped styles use', () => {
    const style = parseStyleAsset('name: chat\ndomain: chat\nsections:\n  tone:\n    formality: ""\n    perspective: ""\n  citation:\n    style: ""\n', 'chat.yaml')
    expect(style.sections.tone.formality).toBe('')
    expect(style.sections.tone.perspective).toBe('')
    expect(style.sections.citation.style).toBe('')
  })

  it('rejects an asset that is not a mapping', () => {
    expect(rejects('42\n')).toContain('必须是 YAML 对象')
    expect(rejects('- name: a\n')).toContain('必须是 YAML 对象')
  })

  it('requires a non-blank name and domain', () => {
    expect(rejects('domain: patent\n')).toContain('name 必须是字符串')
    expect(rejects('name: "  "\ndomain: patent\n')).toContain('name 不能为空')
    expect(rejects('name: test\n')).toContain('domain 必须是字符串')
    expect(rejects('name: test\ndomain: ""\n')).toContain('domain 不能为空')
  })

  it('rejects a version that is not a string', () => {
    expect(rejects(`${MINIMAL_STYLE}version: 1\n`)).toContain('version 必须是字符串')
  })

  it('requires a sections mapping', () => {
    expect(rejects(`${MINIMAL_STYLE}sections: 3\n`)).toContain('缺少 sections 对象')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  tone: 3\n`)).toContain('sections.tone 必须是对象')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  voice: []\n`)).toContain('sections.voice 必须是对象')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  citation: 3\n`)).toContain('sections.citation 必须是对象')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  output_conventions: 3\n`)).toContain('sections.output_conventions 必须是对象')
  })

  it('validates the tone values against their closed sets', () => {
    expect(rejects(`${MINIMAL_STYLE}sections:\n  tone:\n    formality: formal\n`)).toContain('tone.formality 必须是')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  tone:\n    perspective: fourth\n`)).toContain('tone.perspective 必须是')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  tone:\n    language: 42\n`)).toContain('tone.language 必须是字符串')
  })

  it('validates the voice principles', () => {
    expect(rejects(`${MINIMAL_STYLE}sections:\n  voice:\n    principles: x\n`)).toContain('voice.principles 必须是字符串数组')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  voice:\n    principles:\n      - ""\n`)).toContain('voice.principles 不能为空')
  })

  it('validates every anti-pattern entry', () => {
    const section = 'sections:\n  anti_patterns:\n'
    expect(rejects(`${MINIMAL_STYLE}${section}    x\n`)).toContain('anti_patterns 必须是数组')
    expect(rejects(`${MINIMAL_STYLE}${section}    - 绝对\n`)).toContain('anti_patterns[0] 必须是对象')
    expect(rejects(`${MINIMAL_STYLE}${section}    - replace: 通常\n      severity: block\n`)).toContain('word 必须是字符串')
    expect(rejects(`${MINIMAL_STYLE}${section}    - word: 绝对\n      severity: block\n`)).toContain('replace 必须是字符串')
    expect(rejects(`${MINIMAL_STYLE}${section}    - word: 绝对\n      replace: 通常\n`)).toContain('severity 必须是')
    expect(rejects(`${MINIMAL_STYLE}${section}    - word: 绝对\n      replace: 通常\n      severity: fatal\n`)).toContain('severity 必须是')
    const style = parseStyleAsset(`${MINIMAL_STYLE}${section}    - word: 从不\n      replace: 少用\n      severity: warn\n`, 'warn.yaml')
    expect(style.sections.antiPatterns[0]?.severity).toBe('warn')
  })

  it('validates the disclaimer map', () => {
    const section = 'sections:\n  disclaimers:\n'
    expect(rejects(`${MINIMAL_STYLE}${section}    - x\n`)).toContain('disclaimers 必须是')
    expect(rejects(`${MINIMAL_STYLE}${section}    "  ": 文本\n`)).toContain('disclaimers 不能为空')
    expect(rejects(`${MINIMAL_STYLE}${section}    key: ""\n`)).toContain('disclaimers.key 不能为空')
    expect(rejects(`${MINIMAL_STYLE}${section}    key: 3\n`)).toContain('disclaimers.key 必须是字符串')
  })

  it('validates the citation section', () => {
    expect(rejects(`${MINIMAL_STYLE}sections:\n  citation:\n    style: mla\n`)).toContain('citation.style 必须是')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  citation:\n    format: 3\n`)).toContain('citation.format 必须是字符串')
  })

  it('validates the output conventions', () => {
    expect(rejects(`${MINIMAL_STYLE}sections:\n  output_conventions:\n    confidence_label: yes\n`))
      .toContain('confidence_label 必须是布尔值')
    expect(rejects(`${MINIMAL_STYLE}sections:\n  output_conventions:\n    weak_visual: 1\n`)).toContain('weak_visual 必须是布尔值')
    const style = parseStyleAsset(`${MINIMAL_STYLE}sections:\n  output_conventions:\n    confidence_label: false\n    weak_visual: true\n`, 'x.yaml')
    expect(style.sections.outputConventions).toEqual({ confidenceLabel: false, weakVisual: true })
  })
})
