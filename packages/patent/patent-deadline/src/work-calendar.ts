/**
 * The rest-day roll-forward of 专利法实施细则第五条: when a period ends on a
 * statutory holiday (or a moved weekly rest day), the period ends on the first
 * working day after it.
 *
 * Whether a given day is a rest day depends on the State Council's holiday
 * arrangement for that year, so the arrangement is a shipped asset rather than a
 * constant. A day outside the loaded arrangement is an error — assuming "not a
 * holiday" would produce a legally wrong end date, so the caller must either
 * extend the calendar or report the date as unverified.
 * @module @deepseek-ai/dsh-patent-deadline/work-calendar
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  addCalendarDays,
  compareCalendarDates,
  formatCalendarDate,
  parseCalendarDate,
  weekday,
  type CalendarDate,
} from './calendar.ts'
import { CALENDAR_FILE_NAME, workCalendarDir } from './asset-location.ts'

/** Thrown when the work calendar cannot be read, parsed, or is invalid. */
export class WorkCalendarError extends Error {
  /**
   * @param message - what is wrong with the calendar.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkCalendarError'
  }
}

/** The work calendar cannot answer for a date: no arrangement covers its year. */
export class WorkCalendarCoverageError extends WorkCalendarError {
  /** The year without a loaded holiday arrangement. */
  readonly year: number

  /**
   * @param year - the year without a loaded holiday arrangement.
   */
  constructor(year: number) {
    super(
      `工作日历未覆盖 ${String(year)} 年：无法判断该日期是否为法定休假日，`
      + '故不能断定期限届满日是否需要顺延。请补充该年度节假日安排（assets/work-calendar/）'
      + '或经 Config.calendarDir 指向自备日历。',
    )
    this.name = 'WorkCalendarCoverageError'
    this.year = year
  }
}

/** One year of the State Council holiday arrangement. */
export type WorkCalendarYear = {
  year: number
  /** The public notice this arrangement is transcribed from. */
  source: string
  /** Days off, as `YYYY-MM-DD`. */
  holidays: ReadonlySet<string>
  /** Weekend days moved to working days, as `YYYY-MM-DD`. */
  workdays: ReadonlySet<string>
}

/** A loaded holiday arrangement, queryable by date. */
export class WorkCalendar {
  private readonly years: ReadonlyMap<number, WorkCalendarYear>

  /**
   * @param years - the per-year arrangements; later entries replace earlier ones for the same year.
   */
  constructor(years: readonly WorkCalendarYear[]) {
    this.years = new Map(years.map(entry => [entry.year, entry]))
  }

  /** Years with a loaded arrangement, ascending. */
  get coveredYears(): number[] {
    return [...this.years.keys()].sort((left, right) => left - right)
  }

  /**
   * Whether an arrangement covers the date's year.
   * @param date - the date to test.
   * @returns true when the year is loaded.
   */
  covers(date: CalendarDate): boolean {
    return this.years.has(date.year)
  }

  /**
   * Whether the date is a rest day: a statutory holiday, or a weekend day that
   * was not moved to a working day.
   * @param date - the date to test.
   * @returns true when the date is not a working day.
   * @throws WorkCalendarCoverageError when no arrangement covers the date's year.
   */
  isRestDay(date: CalendarDate): boolean {
    const year = this.years.get(date.year)
    if (year === undefined) throw new WorkCalendarCoverageError(date.year)
    const key = formatCalendarDate(date)
    if (year.holidays.has(key)) return true
    const dayOfWeek = weekday(date)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) return false
    return !year.workdays.has(key)
  }

  /**
   * The end date after rest-day roll-forward: the first working day on or after
   * `date`. Adjacent uncovered years are an error rather than an assumption, so
   * a December end date never rolls into an unknown January silently.
   * @param date - the un-rolled end date.
   * @returns the end date and whether it moved.
   * @throws WorkCalendarCoverageError when any candidate day's year is uncovered.
   */
  rollForward(date: CalendarDate): { date: CalendarDate; rolled: boolean } {
    let candidate = date
    // A year holds at most 366 days; the bound also stops a malformed calendar
    // whose every day is a rest day from spinning forever.
    for (let step = 0; step <= 366; step++) {
      if (!this.isRestDay(candidate)) {
        return { date: candidate, rolled: compareCalendarDates(candidate, date) !== 0 }
      }
      candidate = addCalendarDays(candidate, 1)
    }
    throw new WorkCalendarError(
      `工作日历异常：自 ${formatCalendarDate(date)} 起连续 366 天均为非工作日，无法确定顺延后的届满日。`,
    )
  }
}

/**
 * Parse a calendar asset from YAML text, validating every field. This is a file
 * boundary, so a malformed or contradictory asset fails loud instead of
 * degrading to "no holidays known".
 * @param text - the YAML asset text.
 * @returns the parsed arrangement.
 */
export function parseWorkCalendar(text: string): WorkCalendar {
  const document: unknown = parseYaml(text)
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new WorkCalendarError('工作日历资产必须是对象，且含 years 数组。')
  }
  const { years } = document as { years?: unknown }
  if (!Array.isArray(years) || years.length === 0) {
    throw new WorkCalendarError('工作日历资产的 years 必须为非空数组。')
  }
  const parsed = years.map((entry, index) => parseWorkCalendarYear(entry, index))
  const seen = new Set<number>()
  for (const entry of parsed) {
    if (seen.has(entry.year)) throw new WorkCalendarError(`工作日历重复声明 ${String(entry.year)} 年。`)
    seen.add(entry.year)
  }
  return new WorkCalendar(parsed)
}

/**
 * Validate one year entry of the calendar asset.
 * @param entry - the raw entry.
 * @param index - its position, for error messages.
 * @returns the parsed year arrangement.
 */
function parseWorkCalendarYear(entry: unknown, index: number): WorkCalendarYear {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new WorkCalendarError(`工作日历 years[${String(index)}] 必须是对象。`)
  }
  const { year, source, holidays, workdays } = entry as Record<string, unknown>
  if (!Number.isInteger(year) || typeof year !== 'number') {
    throw new WorkCalendarError(`工作日历 years[${String(index)}].year 必须是整数年份。`)
  }
  if (typeof source !== 'string' || source.trim() === '') {
    throw new WorkCalendarError(`工作日历 years[${String(index)}].source 必须写明节假日安排的出处。`)
  }
  return {
    year,
    source,
    holidays: parseDateSet(holidays, year, `years[${String(index)}].holidays`),
    workdays: parseDateSet(workdays, year, `years[${String(index)}].workdays`),
  }
}

/**
 * Parse and validate a date list belonging to one year.
 * @param value - the raw list.
 * @param year - the year the list belongs to.
 * @param label - field path for error messages.
 * @returns the dates as a set of `YYYY-MM-DD` keys.
 */
function parseDateSet(value: unknown, year: number, label: string): ReadonlySet<string> {
  if (value === undefined || value === null) return new Set<string>()
  if (!Array.isArray(value)) throw new WorkCalendarError(`工作日历 ${label} 必须是日期数组。`)
  const keys = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') throw new WorkCalendarError(`工作日历 ${label} 含非字符串日期。`)
    const date = parseCalendarDate(item)
    if (date.year !== year) {
      throw new WorkCalendarError(`工作日历 ${label} 的 ${item} 不属于声明年份 ${String(year)}。`)
    }
    keys.add(formatCalendarDate(date))
  }
  return keys
}

/**
 * Load the work calendar asset from a directory.
 * @param calendarDir - optional directory override; defaults to the packaged asset.
 * @param fileName - optional asset file name; defaults to `cn-holidays.yaml`.
 * @returns the loaded calendar.
 * @throws WorkCalendarError when the asset is missing or invalid.
 */
export function loadWorkCalendar(calendarDir?: string, fileName: string = CALENDAR_FILE_NAME): WorkCalendar {
  const path = join(workCalendarDir(calendarDir), fileName)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    // Only a missing/unreadable asset can land here; the error names the path.
    if (error instanceof Error) {
      throw new WorkCalendarError(`无法读取工作日历资产 ${path}: ${error.message}`)
    }
    throw error
  }
  return parseWorkCalendar(text)
}
