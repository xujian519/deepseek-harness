// 占位符形式的共享来源测试：模板填充侧与质量门禁侧读同一个工厂，
// 因此不存在「只改一侧」的可能；本用例锁定该形式的语义，并断言两个
// 消费方都不再内联等价字面量。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { placeholderBracePattern } from '../src/placeholders.ts'

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
    const consumers = [
      'packages/document/doc-template/src/vars.ts',
      'packages/document/document-deliver/src/checks.ts',
    ]
    for (const file of consumers) {
      const source = readFileSync(resolve(repositoryRoot, file), 'utf8')
      expect(source).toContain('placeholderBracePattern')
      expect(source).not.toContain('{1,80}')
    }
  })
})
