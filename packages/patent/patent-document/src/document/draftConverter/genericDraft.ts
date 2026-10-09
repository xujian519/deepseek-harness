/**
 * src/document/draftConverter/genericDraft — 通用文档模板草案 → id → innerHTML 映射。
 *
 * 通用模板的槽位是模板骨架上的元素 id：fields 给出叶级元素的转义文本，
 * blocks 章节经 renderBlocks 渲染（表题全文档连续编号），rows 章节以槽位
 * 元素内首个占位行为模板逐行克隆（保留单元格的 class 等属性）。输出交给
 * 既有 injectSections 按 id 注入，替换规则与旧 sections 路径完全一致。
 * @module @deepseek-ai/dsh-patent-document/document/draftConverter/genericDraft
 */

import type { TemplateDraft } from '@deepseek-ai/dsh-patent-core'
import { DocumentRenderError } from '../errors.ts'
import { findMatchingCloseTag } from '../htmlScan.ts'
import { escapeHtmlText } from './escape.ts'
import { renderBlocks, type TableCaptionCounter } from './blocks.ts'

/** 生成一个 rows 章节的内容：以占位行为模板逐行克隆，单元格文本转义。 */
function renderRowsSectionHtml(html: string, slotId: string, rows: readonly (readonly string[])[]): string {
  const openRe = new RegExp(`<[A-Za-z][A-Za-z0-9]*[^>]*\\bid="${slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`)
  const openMatch = openRe.exec(html)
  if (openMatch === null) {
    throw new DocumentRenderError(`模板缺少数据行槽位 id="${slotId}"（注册表与模板资产不一致）`)
  }
  const openEnd = openMatch.index + openMatch[0].length
  const closeStart = findMatchingCloseTag(html, openEnd)
  if (closeStart === undefined) {
    throw new DocumentRenderError(`数据行槽位 ${slotId} 的元素未闭合`)
  }
  const inner = html.slice(openEnd, closeStart)
  const trMatch = /<tr[^>]*>[\s\S]*?<\/tr>/.exec(inner)
  if (trMatch === null) {
    throw new DocumentRenderError(`数据行槽位 ${slotId} 缺少占位行（注册表与模板资产不一致）`)
  }
  const trTemplate = trMatch[0]
  const cellCount = (trTemplate.match(/<td[\s>]/g) ?? []).length
  return rows.map((cells) => {
    if (cells.length !== cellCount) {
      throw new DocumentRenderError(`数据行槽位 ${slotId} 列数 ${cells.length} 与模板列数 ${cellCount} 不一致`)
    }
    let index = 0
    return trTemplate.replace(/<td([^>]*)>[\s\S]*?<\/td>/g, (_match, attrs: string) => {
      const cell = cells[index] as string
      index += 1
      return `<td${attrs}>${escapeHtmlText(cell)}</td>`
    })
  }).join('')
}

/**
 * 把通用文档模板受控草案转换为 id → innerHTML 注入映射。
 * @param html - 模板 HTML（rows 槽位的行模板从此提取）。
 * @param draft - 已通过 validateTemplateDraft（注册表 schema）校验的草案。
 * @returns 元素 id → innerHTML 映射，交给 injectSections 注入。
 */
export function renderGenericTemplateSections(html: string, draft: TemplateDraft): Record<string, string> {
  const sections: Record<string, string> = {}
  const captionCounter: TableCaptionCounter = { count: 0 }
  for (const [id, value] of Object.entries(draft.fields ?? {})) {
    if (Array.isArray(value)) {
      throw new DocumentRenderError(`槽位 ${id} 不是 choice 槽位，不接受数组`)
    }
    sections[id] = escapeHtmlText(value)
  }
  for (const section of draft.sections) {
    if (section.blocks !== undefined) {
      sections[section.id] = renderBlocks(section.blocks, captionCounter)
    } else {
      sections[section.id] = renderRowsSectionHtml(html, section.id, section.rows)
    }
  }
  return sections
}
