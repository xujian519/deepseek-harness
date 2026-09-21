/**
 * Function plugin registering `patent_deadlines`: the Chinese patent statutory
 * and designated deadline set for one case, computed from the periods of
 * 专利法 / 专利法实施细则 / 专利审查指南.
 *
 * The holiday arrangement is loaded at plugin load, so a missing or invalid
 * calendar fails the deployment instead of silently dropping the rest-day
 * rule from every end date.
 * @module @deepseek-ai/dsh-patent-deadline
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createPatentDeadlinesTool } from './tool/patent-deadlines.ts'
import { loadWorkCalendar } from './work-calendar.ts'

// Public library API: pure date and period arithmetic, delivery determination,
// the deadline evaluator, and the tool factory.
export {
  addCalendarDays,
  addCalendarMonths,
  CalendarDateError,
  compareCalendarDates,
  daysBetween,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
  weekday,
  type CalendarDate,
} from './calendar.ts'
export { describePeriod, periodEnd, PeriodError, type Period, type PeriodUnit } from './period.ts'
export {
  DeliveryInputError,
  resolveDeliveryDate,
  resolveDeliveryMode,
  type DeliveryDate,
  type DeliveryInput,
  type DeliveryMode,
  type DeliveryRequest,
} from './delivery.ts'
export {
  loadWorkCalendar,
  parseWorkCalendar,
  WorkCalendar,
  WorkCalendarCoverageError,
  WorkCalendarError,
  type WorkCalendarYear,
} from './work-calendar.ts'
export { CALENDAR_FILE_NAME, workCalendarDir } from './asset-location.ts'
export {
  DeadlineQueryError,
  describePatentKind,
  evaluateDeadlines,
  UNCOVERED_YEAR_CAVEAT_PREFIX,
  type ComputedDeadline,
  type DeadlineQuery,
  type DeadlineReport,
  type DeadlineStatus,
  type EvaluateOptions,
  type LatePaymentWindow,
  type NoticeInput,
  type NoticeKind,
  type PatentKind,
  type PendingDeadline,
  type RestDayRule,
} from './statutes.ts'
export { renderDeadlineReport, type DeadlineReportMeta } from './report.ts'
export {
  createPatentDeadlinesTool,
  DeadlineToolError,
  type PatentDeadlinesInput,
  type PatentDeadlinesNoticeInput,
  type PatentDeadlinesOutput,
  type PatentDeadlinesToolOptions,
} from './tool/patent-deadlines.ts'

/** Cordis plugin name. */
export const name = 'patent-deadline'

/** Services the plugin requires before registration. */
export const inject = ['tools']

/** Model-facing patent-deadline plugin configuration. */
export interface Config {
  /** Directory holding `cn-holidays.yaml`; defaults to the packaged calendar. */
  calendarDir?: string
  /** Warn when an end date falls within this many days (deployment policy, not a legal period). */
  reminderLeadDays?: number
}

/** Schemastery configuration: calendar override and warning horizon. */
export const Config: z<Config> = z.object({
  calendarDir: z.string(),
  reminderLeadDays: z.number().default(30),
})

/**
 * Register the patent_deadlines tool over the configured holiday arrangement.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - calendar override and reminder horizon.
 */
export function apply(ctx: Context, config: Config): void {
  const calendar = loadWorkCalendar(config.calendarDir)
  ctx.tools.register(createPatentDeadlinesTool({
    calendar,
    reminderLeadDays: config.reminderLeadDays ?? 30,
  }))
}
