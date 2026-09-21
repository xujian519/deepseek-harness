/**
 * Model-facing rendering of a deadline report.
 * @module @deepseek-ai/dsh-patent-deadline/report
 */

import {
  describePatentKind,
  UNCOVERED_YEAR_CAVEAT_PREFIX,
  type DeadlineReport,
  type PatentKind,
} from './statutes.ts'

/** Context the report prose names, so the model does not have to restate it. */
export type DeadlineReportMeta = {
  kind: PatentKind
  filingDate: string
  today: string
  /** Whether the case claims priority, as supplied by the caller. */
  claimsPriority: boolean
  /** The priority date, when one applies. */
  priorityDate?: string
}

const STATUS_LABEL = {
  overdue: '⛔ 已逾期',
  urgent: '🔴 紧急',
  normal: '🟢 正常',
} as const

/**
 * Render a deadline report as Markdown: computed deadlines in chronological
 * order, then the deadlines that still need a notice, then the caveats that
 * qualify the dates above.
 * @param report - the evaluated report.
 * @param meta - case context for the heading.
 * @returns the Markdown report.
 */
export function renderDeadlineReport(report: DeadlineReport, meta: DeadlineReportMeta): string {
  const priority = meta.claimsPriority
    ? ` · 主张优先权${meta.priorityDate !== undefined ? `（优先权日 ${meta.priorityDate}）` : ''}`
    : ' · 未主张优先权'
  const lines: string[] = [
    `patent_deadlines: ${describePatentKind(meta.kind)} · 申请日 ${meta.filingDate} · 基准日 ${meta.today}${priority}`,
    '',
  ]

  lines.push(
    report.restDayRule === 'apply'
      ? '期限口径：已应用专利法实施细则第5条的届满日顺延（届满日为法定休假日或移用周休息日的，顺延至其后第一个工作日）；表中「期限届满」列为不顺延的原始届满日。'
      : '期限口径：**不顺延**——每个期限只报其自身届满日，未应用专利法实施细则第5条的顺延规则。此口径适用于记录期限本身（如专利权期限届满日），答复、缴费类期限请改用顺延口径。',
    '',
  )

  if (report.computed.length === 0) {
    lines.push('本次查询未产出可计算的期限。', '')
  } else {
    const overdue = report.computed.filter(entry => entry.status === 'overdue').length
    const urgent = report.computed.filter(entry => entry.status === 'urgent').length
    lines.push(
      `可计算期限 ${String(report.computed.length)} 项（已逾期 ${String(overdue)} 项，${String(urgent)} 项临近）。`,
      '',
      '| 期限事项 | 届满日 | 期限届满 | 剩余 | 状态 | 法律依据 |',
      '| --- | --- | --- | --- | --- | --- |',
    )
    for (const entry of report.computed) {
      const remaining = entry.daysRemaining < 0
        ? `已逾期 ${String(-entry.daysRemaining)} 天`
        : `${String(entry.daysRemaining)} 天`
      const caveat = entry.calendarCaveat !== undefined ? ' ⚠️' : ''
      const raw = entry.rolledForward ? entry.rawDueDate : '—'
      lines.push(
        `| ${entry.label} | ${entry.dueDate}${caveat} | ${raw} | ${remaining} | ${STATUS_LABEL[entry.status]} | ${entry.legalBasis} |`,
      )
    }
    lines.push('')
  }

  if (report.pending.length > 0) {
    lines.push(
      `无法计算的期限 ${String(report.pending.length)} 项——需补充下列记录后重算，本工具不以固定年数代替通知书送达日：`,
      '',
    )
    for (const entry of report.pending) {
      lines.push(`- ${entry.label}（${entry.legalBasis}）｜缺少：${entry.requiredInput}｜${entry.reason}`)
    }
    lines.push('')
  }

  const caveats = report.computed.filter(entry => entry.calendarCaveat !== undefined)
  if (caveats.length > 0) {
    // The prose names the years; the prefixed token stays in the structured
    // result for machine consumers.
    const years = [...new Set(caveats.map(entry =>
      (entry.calendarCaveat ?? '').slice(UNCOVERED_YEAR_CAVEAT_PREFIX.length)))].sort()
    lines.push(
      `⚠️ 下列届满日未应用顺延规则（本地节假日安排未覆盖 ${years.join('、')} 年）：`
      + `${caveats.map(entry => `${entry.dueDate}（${entry.label}）`).join('；')}。`,
      '',
    )
  }

  const lateWindows = report.computed.filter(entry => entry.latePaymentWindow !== undefined)
  if (lateWindows.length > 0) {
    lines.push('年费补缴窗口（逾期后 6 个月内仍可补缴并缴滞纳金，期满未缴专利权自应缴年费期满之日起终止）：', '')
    for (const entry of lateWindows) {
      const window = entry.latePaymentWindow
      if (window === undefined) continue
      lines.push(`- ${entry.label}：${window.from} 起算，最迟 ${window.to}。`)
    }
    lines.push('')
  }

  const overdueEntries = report.computed.filter(entry => entry.status === 'overdue')
  if (overdueEntries.length > 0) {
    lines.push(
      '已逾期项请先判断是否仍在救济期内：因不可抗拒的事由延误的，可自障碍消除之日起2个月内'
      + '且自期限届满之日起2年内请求恢复权利；因其他正当理由延误的，可自收到通知之日起2个月内'
      + '请求恢复（延误复审请求期限的，自该期限届满之日起2个月内），并缴纳恢复权利请求费'
      + '（专利法实施细则第6条）。指定期限在届满前还可请求延长，延长不超过两个月'
      + '（专利审查指南第五部分第七章第4.2节）。',
    )
  }

  return lines.join('\n').trimEnd()
}
