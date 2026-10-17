/**
 * gap 检测（纯函数）：聚合证据薄弱的行与未被评估的「要素 × 目标」组合，产出第一优先输出
 * gap list。
 *
 * 两张来源分开：
 *   - 行级：已产出映射行，但 mapping 落在薄弱取值（not-found / needs-evidence / partial）。
 *   - 完整性：要素与目标的组合没有映射行。行级检查对它不可见——没有行就没有 mapping 可判，
 *     缺行会在交付件里表现为"该格没有意见"，与"该格意见是未找到"混淆。
 */

import type { ChartRow, ChartTarget, ClaimElement, GapEntry, GapKind } from '../protocol/types.ts'

/** 表中有证据但结论薄弱的取值；未产出映射行的组合另记 `unevaluated`。 */
const WEAK_KINDS: readonly GapKind[] = ['not-found', 'needs-evidence', 'partial']

/** 优先级：未评估最优先（该格结论根本无从复核），其后按证据薄弱程度排序。 */
const PRIORITY: Record<GapKind, number> = {
  unevaluated: 0,
  'not-found': 1,
  'needs-evidence': 2,
  partial: 3,
}

const SUGGESTIONS: Record<GapKind, string> = {
  unevaluated: '补出该要素对该目标的映射行（未找到对应内容时写 not-found 并说明检索范围）',
  'not-found': '补充检索或论证等同替换',
  'needs-evidence': '证据固化（全文引用/附图标记）',
  partial: '补充公开部分的精确定位（pin-cite）',
}

const REASONS: Record<GapKind, string> = {
  unevaluated: '未评估（没有映射行）',
  'not-found': '未找到对应内容',
  'needs-evidence': '证据不足',
  partial: '仅部分公开',
}

/** 行唯一键：要素与目标的组合。 */
function cellKey(elementId: string, targetId: string): string {
  return `${elementId}→${targetId}`
}

/**
 * 行的缺口类别。
 * @param mapping - 行的映射结论。
 * @returns 薄弱的缺口类别；该行有证据且结论明确时返回 undefined。
 */
function gapKindOf(mapping: ChartRow['mapping']): GapKind | undefined {
  return WEAK_KINDS.find(kind => kind === mapping)
}

function entry(elementId: string, targetId: string, kind: GapKind): GapEntry {
  return {
    elementId,
    targetId,
    kind,
    reason: `要素 ${elementId} 在 ${targetId} 上${REASONS[kind]}`,
    suggestion: SUGGESTIONS[kind],
  }
}

/**
 * 聚合缺口：证据薄弱的行，加上未产出映射行的「要素 × 目标」组合。
 *
 * 传入 elements 与 targets 时检查完整性（缺失组合记为 unevaluated）；只传 rows 时保持
 * 行级检查（"只拆要素"模式没有目标可对照，目标为空数组时完整性检查自然为空）。
 * @param rows - 映射行列表。
 * @param elements - 已拆分的要素；给出时参与完整性检查。
 * @param targets - 映射目标；给出时参与完整性检查。
 * @returns 按优先级排序的缺口条目列表。
 */
export function detectGaps(
  rows: ChartRow[],
  elements: readonly ClaimElement[] = [],
  targets: readonly ChartTarget[] = [],
): GapEntry[] {
  const gaps: GapEntry[] = []
  const mapped = new Set<string>()
  for (const row of rows) {
    mapped.add(cellKey(row.elementId, row.targetId))
    const kind = gapKindOf(row.mapping)
    if (kind === undefined) continue
    gaps.push(entry(row.elementId, row.targetId, kind))
  }
  for (const element of elements) {
    for (const target of targets) {
      if (mapped.has(cellKey(element.id, target.id))) continue
      gaps.push(entry(element.id, target.id, 'unevaluated'))
    }
  }
  gaps.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])
  return gaps
}
