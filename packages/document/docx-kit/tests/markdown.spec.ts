// 上游来源：Mady 项目 `domains/doctmpl/renderer_docx_test.go` 的
// `TestDOCXRenderer_Render` 内联 Markdown 样例（标题、加粗段落、无序列表、表格），
// 以及 `domains/doctmpl/renderer_docx.go` 的 `parseHeading`/`isListItem`/
// `isTableSeparator`/`parseTableRow`/`docxInlineRunsXML` 决策。

import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown } from '../src/markdown.ts'
import type { DocxBlock, DocxInlineRun } from '../src/types.ts'

/** 上游 `TestDOCXRenderer_Render` 的 Markdown 正文。 */
const UPSTREAM_MARKDOWN = '# 技术标题\n\n这是一段**加粗**文字。\n\n- 列表项一\n- 列表项二\n\n'
  + '| 名称 | 数值 |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n'

const INLINE_CASES: [name: string, text: string, expected: string[]][] = [
  ['plain text', 'plain text', ['p:plain text']],
  ['a bold span', 'a **b** c', ['p:a ', 'b:b', 'p: c']],
  ['a code span', 'a `b` c', ['p:a ', 'pc:b', 'p: c']],
  ['both markers', '**a** and `b`', ['b:a', 'p: and ', 'pc:b']],
  ['an empty bold span', '****', ['b:']],
  ['a code span around markers', '`a**b**`', ['pc:a**b**']],
  ['an unpaired bold marker', 'unpaired **marker', ['p:unpaired ', 'p:*', 'p:*marker']],
  ['an unpaired code marker', '`unpaired', ['p:`', 'p:unpaired']],
  ['an empty line', '', []],
]

const HEADING_CASES: [source: string, level: number][] = [
  ['# one', 1],
  ['## two', 2],
  ['### three', 3],
  ['#### four', 4],
  ['##### five', 5],
  ['###### six', 6],
]

const PARAGRAPH_CASES: [name: string, source: string][] = [
  ['seven hashes', '####### seven'],
  ['no space after the marker', '#noseparator'],
  ['a bare marker', '#'],
  ['a tab separator', '#\ttab'],
  ['a paragraph', 'plain'],
]

/** Compact view of a span list, so one assertion covers text and both decorations. */
function markup(runs: readonly DocxInlineRun[]): string[] {
  return runs.map(run => `${run.bold ? 'b' : 'p'}${run.code ? 'c' : ''}:${run.text}`)
}

/** Block kinds in source order. */
function kinds(blocks: readonly DocxBlock[]): string[] {
  return blocks.map(block => block.kind)
}

/** Span list of a paragraph block, or `undefined` when the block is of another kind. */
function paragraphRuns(block: DocxBlock | undefined): string[] | undefined {
  return block?.kind === 'paragraph' ? markup(block.runs) : undefined
}

/** Span list of a list item block, or `undefined` when the block is of another kind. */
function listItemRuns(block: DocxBlock | undefined): string[] | undefined {
  return block?.kind === 'listItem' ? markup(block.runs) : undefined
}

/** Row widths of a table block, or `undefined` when the block is of another kind. */
function rowWidths(blocks: readonly DocxBlock[]): number[] | undefined {
  const block = blocks[0]
  return block?.kind === 'table' ? block.rows.map(row => row.length) : undefined
}

describe('parseInline', () => {
  it.each(INLINE_CASES)('reads %s', (_name, text, expected) => {
    expect(markup(parseInline(text))).toEqual(expected)
  })
})

describe('parseMarkdown', () => {
  it('reads the upstream sample into the four block kinds', () => {
    const blocks = parseMarkdown(UPSTREAM_MARKDOWN)
    expect(kinds(blocks)).toEqual(['heading', 'paragraph', 'listItem', 'listItem', 'table'])
    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, text: '技术标题' })
    expect(paragraphRuns(blocks[1])).toEqual(['p:这是一段', 'b:加粗', 'p:文字。'])
    expect(listItemRuns(blocks[2])).toEqual(['p:列表项一'])
    expect(blocks[4]).toEqual({
      kind: 'table',
      rows: [
        [[{ text: '名称', bold: false, code: false }], [{ text: '数值', bold: false, code: false }]],
        [[{ text: 'A', bold: false, code: false }], [{ text: '1', bold: false, code: false }]],
        [[{ text: 'B', bold: false, code: false }], [{ text: '2', bold: false, code: false }]],
      ],
    })
  })

  it.each(HEADING_CASES)('reads %s as a heading', (source, level) => {
    expect(parseMarkdown(source)).toEqual([{ kind: 'heading', level, text: source.slice(level + 1) }])
  })

  it.each(PARAGRAPH_CASES)('reads %s as paragraph text', (_name, source) => {
    expect(parseMarkdown(source)).toEqual([{ kind: 'paragraph', runs: [{ text: source, bold: false, code: false }] }])
  })

  it('joins consecutive plain lines into one paragraph', () => {
    expect(parseMarkdown('a\nb\n\nc')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'a b', bold: false, code: false }] },
      { kind: 'paragraph', runs: [{ text: 'c', bold: false, code: false }] },
    ])
  })

  it('trims line endings and list markers', () => {
    expect(parseMarkdown('* item\r\n')).toEqual([{ kind: 'listItem', runs: [{ text: 'item', bold: false, code: false }] }])
  })

  it('drops a table separator row and keeps a colon row as data', () => {
    expect(parseMarkdown('| a | b |\n| :--- | ---: |')).toEqual([{
      kind: 'table',
      rows: [
        [[{ text: 'a', bold: false, code: false }], [{ text: 'b', bold: false, code: false }]],
        [[{ text: ':---', bold: false, code: false }], [{ text: '---:', bold: false, code: false }]],
      ],
    }])
  })

  it('contributes no block for a table that holds only separators', () => {
    expect(parseMarkdown('| --- |\n| --- |')).toEqual([])
  })

  it('closes a table when a plain line follows it', () => {
    expect(kinds(parseMarkdown('| a |\n\nafter'))).toEqual(['table', 'paragraph'])
  })

  it('reads a ragged row as its own cells', () => {
    expect(rowWidths(parseMarkdown('| a | b |\n| c |'))).toEqual([2, 1])
  })

  it('reads an empty cell', () => {
    expect(rowWidths(parseMarkdown('||'))).toEqual([1])
  })
})
