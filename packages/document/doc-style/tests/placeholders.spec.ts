// 占位符形式的共享来源测试：模板填充侧与质量门禁侧读同一个工厂，
// 因此不存在「只改一侧」的可能；本用例锁定该形式的语义，并断言两个
// 消费方都不再内联等价字面量。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PLACEHOLDER_MARKERS, placeholderBracePattern, residualPlaceholderPatterns } from '../src/placeholders.ts'

const repositoryRoot = resolve(import.meta.dirname, '../../../..')

describe('placeholderBracePattern', () => {
  it('matches one unfilled double-brace placeholder', () => {
    expect('前 {{机构名称}} 后'.match(placeholderBracePattern())).toEqual(['{{机构名称}}'])
    expect('{{a b}} and {{c}}'.match(placeholderBracePattern())).toEqual(['{{a b}}', '{{c}}'])
  })

  it('rejects the forms neither side treats as a placeholder', () => {
    expect('{{}}'.match(placeholderBracePattern())).toBeNull()
    expect('{{a\nb}}'.match(placeholderBracePattern())).toBeNull()
    expect(`{{${'x'.repeat(81)}}}`.match(placeholderBracePattern())).toBeNull()
    expect('{{x'.match(placeholderBracePattern())).toBeNull()
  })

  it('hands each caller its own expression', () => {
    const first = placeholderBracePattern()
    const second = placeholderBracePattern()
    expect(first).not.toBe(second)
    expect([first.source, first.flags]).toEqual([second.source, second.flags])
  })

  it('is the only definition the fill side and the quality gate read', () => {
    const fillSide = readFileSync(resolve(repositoryRoot, 'packages/document/doc-template/src/vars.ts'), 'utf8')
    expect(fillSide).toContain('placeholderBracePattern')
    const gateSide = readFileSync(resolve(repositoryRoot, 'packages/document/document-deliver/src/checks.ts'), 'utf8')
    expect(gateSide).toContain('residualPlaceholderPatterns')
    // 两侧都不得再内联花括号形式或标记词表的交替式：那正是三处漂移的来源。
    for (const source of [fillSide, gateSide]) {
      expect(source).not.toContain('\\{\\{')
      expect(source).not.toContain('TODO|REPLACE')
    }
  })
})

describe('residualPlaceholderPatterns', () => {
  it('reports the fillable braces first, then every marker form', () => {
    const text = '前 {{机构名称}} 后 [TBD] [placeholder] Lorem ipsum 待补充'
    const found = residualPlaceholderPatterns().flatMap(pattern => text.match(pattern) ?? [])
    expect(found).toEqual(['{{机构名称}}', '[TBD]', '[placeholder]', 'Lorem ipsum', '待补充'])
  })

  it('takes the markers from the shared table', () => {
    const expected = [...PLACEHOLDER_MARKERS.bracketed.map(word => `[${word}]`), ...PLACEHOLDER_MARKERS.latin, ...PLACEHOLDER_MARKERS.chinese]
    const found = residualPlaceholderPatterns().flatMap(pattern => expected.join(' ').match(pattern) ?? [])
    expect(found).toEqual(expected)
  })

  it('hands each caller its own expressions', () => {
    const first = residualPlaceholderPatterns()
    const second = residualPlaceholderPatterns()
    expect(first).not.toBe(second)
    first.forEach((pattern, index) => {
      const other = second[index]
      expect(other).not.toBe(pattern)
      expect(other?.source).toBe(pattern.source)
      expect(other?.flags).toBe(pattern.flags)
    })
  })
})
