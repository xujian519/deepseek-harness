/**
 * src/document/draftConverter/blocks — DraftBlock 序列的确定性 HTML 生成。
 *
 * 块只产生 p/ul/ol/table 四种结构；表格表题按调用方传入的计数器全文档连续编号，
 * 文本取自 patent-core 的 formatTableCaption，docx 通道读同一函数，两通道同形。
 * @module @deepseek-ai/dsh-patent-document/document/draftConverter/blocks
 */

import { formatTableCaption, type DraftBlock } from '@deepseek-ai/dsh-patent-core'
import { escapeHtmlText } from './escape.ts'

/** 表题计数器；一次草案渲染共用一个实例，保证全文档连续编号。 */
export interface TableCaptionCounter {
  /** 已产出的表格数；表题序号从 1 起。 */
  count: number
}

/** 渲染一个块；captionCounter 在表格处自增。 */
function renderBlock(block: DraftBlock, captionCounter: TableCaptionCounter): string {
  if (block.kind === 'paragraph') {
    return `<p>${escapeHtmlText(block.text)}</p>`
  }
  if (block.kind === 'list') {
    const tag = block.ordered === true ? 'ol' : 'ul'
    const items = block.items.map(item => `<li>${escapeHtmlText(item)}</li>`).join('')
    return `<${tag}>${items}</${tag}>`
  }
  captionCounter.count += 1
  const header = block.header.map(cell => `<th>${escapeHtmlText(cell)}</th>`).join('')
  const body = block.rows
    .map(row => `<tr>${row.map(cell => `<td>${escapeHtmlText(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><caption>${escapeHtmlText(formatTableCaption(captionCounter.count, block.name))}</caption>`
    + `<thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`
}

/**
 * 渲染块序列；表格表题按文档顺序连续编号。
 * @param blocks - 已校验的块序列。
 * @param captionCounter - 本次渲染共享的表题计数器。
 * @returns 连续的 HTML 片段（无换行分隔）。
 */
export function renderBlocks(blocks: readonly DraftBlock[], captionCounter: TableCaptionCounter): string {
  return blocks.map(block => renderBlock(block, captionCounter)).join('')
}
