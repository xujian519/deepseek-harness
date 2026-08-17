/**
 * gap 检测（纯函数）：聚合证据薄弱的行，产出第一优先输出 gap list。
 */

import type { ChartRow, GapEntry } from '../protocol/types.ts'

type GapMapping = 'not-found' | 'needs-evidence' | 'partial'

const GAP_MAPPINGS = new Set(['not-found', 'needs-evidence', 'partial'])

const PRIORITY: Record<GapMapping, number> = { 'not-found': 0, 'needs-evidence': 1, partial: 2 }

const SUGGESTIONS: Record<GapMapping, string> = {
  'not-found': '补充检索或论证等同替换',
  'needs-evidence': '证据固化（全文引用/附图标记）',
  partial: '补充公开部分的精确定位（pin-cite）',
}

const REASONS: Record<GapMapping, string> = {
  'not-found': '未找到对应内容',
  'needs-evidence': '证据不足',
  partial: '仅部分公开',
}

/**
 * 聚合证据薄弱的行，产出 gap list（第一优先输出）。
 * @param rows - 映射行列表。
 * @returns 按优先级排序的缺口条目列表。
 */
export function detectGaps(rows: ChartRow[]): GapEntry[] {
  const gaps: GapEntry[] = []
  for (const row of rows) {
    if (!GAP_MAPPINGS.has(row.mapping)) continue
    const mapping = row.mapping as GapMapping
    gaps.push({
      elementId: row.elementId,
      targetId: row.targetId,
      mapping,
      reason: `要素 ${row.elementId} 在 ${row.targetId} 上${REASONS[mapping]}`,
      suggestion: SUGGESTIONS[mapping],
    })
  }
  gaps.sort((a, b) => PRIORITY[a.mapping as GapMapping] - PRIORITY[b.mapping as GapMapping])
  return gaps
}
