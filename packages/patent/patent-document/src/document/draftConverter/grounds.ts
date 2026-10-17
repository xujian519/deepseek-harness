/**
 * src/document/draftConverter/grounds — 无效理由节（`DraftGroundItem` 序列）的确定性 HTML 生成。
 *
 * 节标题按 `{节序}.{序} 权利要求 …不具备{理由}（{法条}）` 由结构算出：模型只提交法条、理由名、
 * 被主张的权项号与三段正文，既不能写死"4.1 权 1 不具备新颖性"这类小节标题，也不能把未主张的
 * 理由塞进文书。四段式（事实认定 / 证据分析 / 法条适用 / 结论）中的后两段合并为一个「法条适用与
 * 结论」小标题，故每节生成三个 `h4`，同为生成物。
 * @module @deepseek-ai/dsh-patent-document/document/draftConverter/grounds
 */

import type { DraftGroundItem } from '@deepseek-ai/dsh-patent-core'
import { escapeHtmlText } from './escape.ts'

/**
 * 渲染理由节。
 * @param grounds - 已校验的理由项序列。
 * @param prefix - 节序前缀（模板骨架的节序，如 `4` 对应「四、无效理由」）。
 * @param relation - 权项与理由名之间的关系词（请求人侧「不具备」、被请求人侧「的」）。
 * @returns 连续的 HTML 片段（无换行分隔）。
 */
export function renderGroundsSection(grounds: readonly DraftGroundItem[], prefix: string, relation = '不具备'): string {
  const link = escapeHtmlText(relation)
  return grounds.map((item, index) => {
    const claims = `权利要求 ${item.claimNos.join('、')}`
    return [
      `<h3>${prefix}.${index + 1} ${claims} ${link}${escapeHtmlText(item.ground)}（${escapeHtmlText(item.article)}）</h3>`,
      '<h4>事实认定</h4>',
      `<p>${escapeHtmlText(item.facts)}</p>`,
      '<h4>证据分析</h4>',
      `<p>${escapeHtmlText(item.evidence)}</p>`,
      '<h4>法条适用与结论</h4>',
      `<p>${escapeHtmlText(item.conclusion)}</p>`,
    ].join('')
  }).join('')
}
