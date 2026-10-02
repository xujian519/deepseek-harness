/**
 * The `patentDeadline` Cordis service: this package's deadline capability
 * exposed to other plugins, not only to the model as the `patent_deadlines`
 * tool.
 *
 * Why it exists: the preset registers this package inside the agent preset's
 * isolated realm, where the tool registry it writes to is invisible to a
 * sibling plugin mounted at the profile root (the patent workbench, whose
 * deadline board must call the same evaluator rather than reimplement the
 * periods). A deployment registers this package a second time at the profile
 * root with `provideService: true` and `exposeTool: false`, which publishes the
 * evaluator as a root-scoped service without adding a second model-facing tool.
 * The consumer probes `ctx.get('patentDeadline')` and degrades when the
 * deployment has not wired it.
 *
 * The service is a thin pass-through to the pure functions: no period,
 * delivery, or rest-day rule is restated here.
 * @module @deepseek-ai/dsh-patent-deadline
 */

import type { CalendarDate } from './calendar.ts'
import { resolveDeliveryDate, type DeliveryDate, type DeliveryRequest } from './delivery.ts'
import { periodEnd, type Period } from './period.ts'
import {
  describePatentKind,
  evaluateDeadlines,
  type DeadlineQuery,
  type DeadlineReport,
  type PatentKind,
} from './statutes.ts'
import type { WorkCalendar } from './work-calendar.ts'

/** Holiday-arrangement coverage of the calendar the service was built over. */
export type PatentDeadlineCalendarCoverage = {
  /** Years with a loaded arrangement, ascending. */
  years: number[]
}

/**
 * The deadline capability published as `patentDeadline`. Dates cross the
 * boundary as {@link CalendarDate} (a plain `{ year, month, day }`), so the
 * service stays JSON-shaped and no calendar parsing is duplicated by callers.
 */
export interface PatentDeadlineService {
  /**
   * Compute one case's deadline set. `query.today` is supplied by the caller so
   * a report is reproducible; the service never reads the host clock.
   * @param query - the case inputs, including `today`.
   * @param options - optional override of the reminder horizon for this call.
   * @returns the computed and pending deadlines.
   */
  evaluate(query: DeadlineQuery, options?: { reminderLeadDays?: number }): DeadlineReport
  /**
   * End date of a period starting at `start`, before the rest-day roll-forward.
   * @param start - the period's start date.
   * @param period - the period length and unit.
   * @returns the period's own end date.
   */
  periodEnd(start: CalendarDate, period: Period): CalendarDate
  /**
   * Resolve a notice's delivery date and the rule that produced it.
   * @param request - the delivery mode and its evidence.
   * @returns the delivery date and its basis.
   */
  resolveDeliveryDate(request: DeliveryRequest): DeliveryDate
  /**
   * Human-readable Chinese name of a patent category.
   * @param kind - the patent category.
   * @returns the category's display name.
   */
  describePatentKind(kind: PatentKind): string
  /**
   * Years the loaded holiday arrangement covers; a caller uses this to warn
   * that an end date's year has no arrangement instead of assuming full cover.
   * @returns the covered years, ascending.
   */
  calendarCoverage(): PatentDeadlineCalendarCoverage
}

/** Inputs the service is built from. */
export type PatentDeadlineServiceOptions = {
  /** The loaded holiday arrangement. */
  calendar: WorkCalendar
  /** Warn when an end date falls within this many days. */
  reminderLeadDays: number
}

/**
 * Build the `patentDeadline` service over a loaded calendar.
 * @param options - the loaded calendar and the deployment's reminder horizon.
 * @returns the deadline capability other plugins consume.
 */
export function createPatentDeadlineService(options: PatentDeadlineServiceOptions): PatentDeadlineService {
  return {
    evaluate(query, overrides) {
      return evaluateDeadlines(query, {
        calendar: options.calendar,
        reminderLeadDays: overrides?.reminderLeadDays ?? options.reminderLeadDays,
      })
    },
    periodEnd,
    resolveDeliveryDate,
    describePatentKind,
    calendarCoverage() {
      return { years: options.calendar.coveredYears }
    },
  }
}
