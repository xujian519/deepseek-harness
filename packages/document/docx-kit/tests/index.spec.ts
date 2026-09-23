// 本文件断言包的入口面：两个方向与 Markdown 块模型都能从 `src/index.ts` 取到，
// 上游 Go 侧没有入口面测试可转写（`TestDOCXRenderer_Format` 对应的是
// `Format()` 这一 Go 专有概念）。

import { describe, expect, it } from 'vitest'
import * as kit from '../src/index.ts'
import type { ZipReadLimits } from '../src/index.ts'

/** Read budgets wide enough that the fixture below never reaches them. */
const LIMITS: ZipReadLimits = { maxArchiveEntries: 100, maxUncompressedBytes: 1 << 20 }

describe('package entry', () => {
  it('exports both directions and the Markdown model', () => {
    expect(typeof kit.renderDocx).toBe('function')
    expect(typeof kit.extractDocxText).toBe('function')
    expect(typeof kit.parseMarkdown).toBe('function')
    expect(typeof kit.parseInline).toBe('function')
  })

  it('renders and projects through the entry point', () => {
    const bytes = kit.renderDocx('# 标题\n\n正文')
    expect(kit.extractDocxText(bytes, LIMITS).text).toBe('# 标题\n\n正文')
  })

  it('names the vocabulary the two directions share', () => {
    expect(kit.HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6])
    expect(kit.headingLevelOf(3)).toBe(3)
    expect(kit.headingLevelOf(7)).toBeUndefined()
    expect(kit.DOCUMENT_PART).toBe('word/document.xml')
    expect(kit.HEADER_PART_LABEL).toBe('[页眉]')
    expect(kit.FOOTER_PART_LABEL).toBe('[页脚]')
    expect(kit.TABLE_CELL_SEPARATOR).toBe(' | ')
    expect(kit.HEADING_MARKER).toBe('#')
    expect(kit.XML_PART_SUFFIX).toBe('.xml')
    expect(kit.HEADER_PART_PREFIX).toBe('word/header')
    expect(kit.FOOTER_PART_PREFIX).toBe('word/footer')
  })
})
