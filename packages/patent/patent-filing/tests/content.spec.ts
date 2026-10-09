import { describe, expect, it } from 'vitest'
import { validateContent } from '@deepseek-ai/dsh-patent-filing'
import type { FilingContent, SpecificationNode } from '@deepseek-ai/dsh-patent-filing'

/** A minimal content model that passes every cross-field rule. */
function content(overrides: Partial<FilingContent> = {}): FilingContent {
  return {
    abstract: ['本发明公开了一种装置。'],
    claims: ['1. 一种装置，其特征在于，包括本体。'],
    specification: [{ kind: 'h3', text: '技术领域' }, { kind: 'p', text: '本发明属于机械领域。' }],
    figures: ['/tmp/fig1.png'],
    ...overrides,
  }
}

describe('validateContent', () => {
  it('accepts a well-formed model and returns it unchanged', () => {
    const input = content({ specification: [{ kind: 'table', rows: [['表头甲', '表头乙'], ['1', '2']] }] })
    expect(validateContent(input)).toBe(input)
  })

  it('rejects an empty or blank abstract', () => {
    expect(() => validateContent(content({ abstract: [] }))).toThrow(/abstract.*至少要有 1 项/)
    expect(() => validateContent(content({ abstract: ['   '] }))).toThrow(/abstract 说明书摘要\[0\] 不能为空/)
  })

  it('rejects an empty or blank claims list', () => {
    expect(() => validateContent(content({ claims: [] }))).toThrow(/claims.*至少要有 1 项/)
    expect(() => validateContent(content({ claims: [''] }))).toThrow(/claims 权利要求\[0\] 不能为空/)
  })

  it('rejects an empty specification', () => {
    expect(() => validateContent(content({ specification: [] }))).toThrow(/specification 说明书至少要有 1 个节点/)
  })

  it('rejects an empty figure list', () => {
    expect(() => validateContent(content({ figures: [] }))).toThrow(/figures 附图（不能为空） 至少要有 1 项/)
  })

  it('accepts an abstract figure index inside the figure list and defaults nothing', () => {
    const input = content({ figures: ['/tmp/fig1.png', '/tmp/fig2.png'], abstractFigureIndex: 1 })
    expect(validateContent(input).abstractFigureIndex).toBe(1)
    expect(validateContent(content()).abstractFigureIndex).toBeUndefined()
  })

  it('rejects an abstract figure index outside the figure list or not an integer', () => {
    const two = { figures: ['/tmp/fig1.png', '/tmp/fig2.png'] }
    expect(() => validateContent(content({ ...two, abstractFigureIndex: 2 }))).toThrow(/0\.\.1 的整数/)
    expect(() => validateContent(content({ ...two, abstractFigureIndex: -1 }))).toThrow(/不是有效附图下标/)
    expect(() => validateContent(content({ ...two, abstractFigureIndex: 0.5 }))).toThrow(/不是有效附图下标/)
  })

  it('rejects a heading or paragraph without text', () => {
    for (const kind of ['h3', 'h4', 'p'] as const) {
      expect(() => validateContent(content({ specification: [{ kind }] }))).toThrow(/不能为空/)
    }
  })

  it('rejects a table with no rows, an empty row, uneven rows, or a blank cell', () => {
    const node = (rows?: string[][]): SpecificationNode =>
      rows === undefined ? { kind: 'table' } : { kind: 'table', rows }
    const withTable = (rows?: string[][]): FilingContent => content({ specification: [node(rows)] })

    expect(() => validateContent(withTable(undefined))).toThrow(/至少要有 1 行/)
    expect(() => validateContent(withTable([]))).toThrow(/至少要有 1 行/)
    expect(() => validateContent(withTable([[]]))).toThrow(/每行至少要有 1 列/)
    expect(() => validateContent(withTable([['a'], ['a', 'b']]))).toThrow(/第 2 行有 2 列，与首行的 1 列不一致/)
    expect(() => validateContent(withTable([['a', '']]))).toThrow(/第 1 行第 2 列 不能为空/)
  })
})
