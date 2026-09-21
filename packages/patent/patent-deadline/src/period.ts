/**
 * The period arithmetic of 专利法实施细则第五条: the day a period starts is not
 * counted, counting begins the next day; a period measured in months or years
 * ends on the corresponding day of the last month, or that month's last day
 * when it has no corresponding day.
 * @module @deepseek-ai/dsh-patent-deadline/period
 */

import { addCalendarDays, addCalendarMonths, type CalendarDate } from './calendar.ts'

/** Unit of a statutory or designated period. */
export type PeriodUnit = 'day' | 'month' | 'year'

/** A period length. */
export type Period = {
  unit: PeriodUnit
  count: number
}

/** Thrown when a period length is not a positive whole number. */
export class PeriodError extends Error {
  /**
   * @param message - what is wrong with the period.
   */
  constructor(message: string) {
    super(message)
    this.name = 'PeriodError'
  }
}

/**
 * Compute the day a period ends, given the day it starts.
 *
 * The start day itself is not counted (细则第5条), so an N-day period starting on
 * `D` ends on `D + N`, and an N-month period ends on the corresponding day N
 * months later with the last-day-of-month rule applied.
 * @param start - the day the period starts (the trigger date or delivery date).
 * @param period - the period length.
 * @returns the day the period ends, before any rest-day roll-forward.
 */
export function periodEnd(start: CalendarDate, period: Period): CalendarDate {
  if (!Number.isInteger(period.count) || period.count <= 0) {
    throw new PeriodError(`期限长度必须为正整数: ${String(period.count)}`)
  }
  switch (period.unit) {
    case 'day':
      return addCalendarDays(start, period.count)
    case 'month':
      return addCalendarMonths(start, period.count)
    case 'year':
      return addCalendarMonths(start, period.count * 12)
  }
}

/**
 * Human-readable period length for labels and reports.
 * @param period - the period length.
 * @returns the Chinese description, e.g. `2个月`.
 */
export function describePeriod(period: Period): string {
  const unit = period.unit === 'day' ? '日' : period.unit === 'month' ? '个月' : '年'
  return `${String(period.count)}${unit}`
}
