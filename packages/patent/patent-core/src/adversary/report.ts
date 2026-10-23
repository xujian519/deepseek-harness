/**
 * src/adversary/report — 对抗式检验报告生成。
 *
 * 这是五步处理流程的第五步：报告生成。将分类后的争议点整理为结构化报告，
 * 并渲染面向人工复核的文本摘要。
 */

import type { AdversaryDispute, AdversaryReport } from './types.ts'
import { computeOverallConfidence } from './divergence.ts'

/**
 * 聚合争议点为结构化报告。
 *
 * @param disputes - 标记好关系的争议点列表。
 * @param summary - 报告摘要（由模型生成或降级文本）。
 * @returns 结构化报告。
 */
export function buildAdversaryReport(disputes: AdversaryDispute[], summary: string): AdversaryReport {
  const agreements = disputes.filter(d => d.relation === 'agreement')
  const disagreements = disputes.filter(d => d.relation === 'disagreement')
  const missedByBaseline = disputes.filter(d => d.relation === 'missed_by_baseline')
  const unverified = disputes.filter(d => d.tag === 'unverified')

  return {
    disputes,
    agreements,
    disagreements,
    missedByBaseline,
    unverified,
    overallConfidence: computeOverallConfidence(disputes),
    summary,
  }
}

/**
 * 渲染对抗式检验报告为可读文本。
 *
 * @param report - 结构化报告。
 * @returns 面向人工复核的文本报告。
 */
export function renderAdversaryReport(report: AdversaryReport): string {
  const lines: string[] = []

  // 标题行
  lines.push(
    `对抗式检验报告：共 ${report.disputes.length} 条争议点（一致 ${report.agreements.length}、` +
    `分歧 ${report.disagreements.length}、基线未覆盖 ${report.missedByBaseline.length}、` +
    `未验证 ${report.unverified.length}）`,
  )
  lines.push(`整体置信度：${(report.overallConfidence * 100).toFixed(1)}%`)

  // 摘要
  if (report.summary.trim().length > 0) {
    lines.push('')
    lines.push(`摘要：${report.summary}`)
  }

  // 分歧项（优先展示）
  if (report.disagreements.length > 0) {
    lines.push('')
    lines.push('分歧项（需重点关注）：')
    for (const d of report.disagreements) {
      lines.push(`- ${d.statute}（权项 ${d.claims.join(', ') || '未指定'}）：${d.point}`)
      if (d.divergenceReason !== undefined) {
        lines.push(`  原因：${d.divergenceReason}`)
      }
    }
  }

  // 基线未覆盖项
  if (report.missedByBaseline.length > 0) {
    lines.push('')
    lines.push('基线未覆盖项（答复计划可能遗漏）：')
    for (const d of report.missedByBaseline) {
      lines.push(`- ${d.statute}（权项 ${d.claims.join(', ') || '未指定'}）：${d.point}`)
    }
  }

  // 一致项
  if (report.agreements.length > 0) {
    lines.push('')
    lines.push('一致项（双方识别相同）：')
    for (const d of report.agreements) {
      lines.push(`- ${d.statute}（权项 ${d.claims.join(', ') || '未指定'}）：${d.point}`)
    }
  }

  // 未验证项
  if (report.unverified.length > 0) {
    lines.push('')
    lines.push('未验证项（模型不可用时的占位）：')
    for (const d of report.unverified) {
      lines.push(`- ${d.statute}（权项 ${d.claims.join(', ') || '未指定'}）：${d.point}`)
    }
  }

  // 限制说明
  lines.push('')
  lines.push(
    '限制说明：本原子从独立视角评估答复计划，不消费己方中间推理（dispute_framing_report、' +
    'claim_chart、draft 等）。当前版本为简化实现，完整版应调用模型做独立证据评估。',
  )

  return lines.join('\n')
}

/**
 * 生成降级摘要（模型不可用时）。
 *
 * @param disputes - 争议点列表。
 * @returns 降级文本。
 */
export function degradedSummary(disputes: AdversaryDispute[]): string {
  if (disputes.length === 0) {
    return '模型不可用，未识别到争议点。'
  }
  const unverifiedCount = disputes.filter(d => d.tag === 'unverified').length
  if (unverifiedCount === disputes.length) {
    return `模型不可用，${disputes.length} 条争议点均为未验证占位。`
  }
  return `模型不可用，基于确定性规则识别 ${disputes.length} 条争议点（${unverifiedCount} 条未验证）。`
}
