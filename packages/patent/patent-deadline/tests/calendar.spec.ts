import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  addCalendarMonths,
  CalendarDateError,
  compareCalendarDates,
  daysBetween,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
  weekday,
} from '../src/calendar.ts'

describe('calendar dates', () => {
  it('round-trips a strict YYYY-MM-DD date', () => {
    expect(formatCalendarDate(parseCalendarDate('2026-09-20'))).toBe('2026-09-20')
    expect(parseCalendarDate(' 2026-1-05 ')).toEqual({ year: 2026, month: 1, day: 5 })
  })

  it('rejects dates that do not exist or are not dates', () => {
    for (const bad of ['2025-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '26-01-01', '', '2026/01/01']) {
      expect(() => parseCalendarDate(bad)).toThrow(CalendarDateError)
    }
    expect(() => parseCalendarDate('bad')).toThrow(/不是有效的日期/)
  })

  it('rejects a year whose leading digits would shift the day arithmetic', () => {
    // Date.UTC reads years 0-99 as 19xx, so 0025-01-15 would shift days to 1925.
    for (const bad of ['0025-01-15', '1899-12-31', '0001-01-01']) {
      expect(() => parseCalendarDate(bad)).toThrow(CalendarDateError)
    }
    expect(parseCalendarDate('1900-01-01')).toEqual({ year: 1900, month: 1, day: 1 })
  })

  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2025, 2)).toBe(28)
    expect(daysInMonth(2026, 4)).toBe(30)
  })

  it('clamps a month shift to the target month when the day is missing', () => {
    expect(addCalendarMonths({ year: 2025, month: 1, day: 31 }, 1)).toEqual({ year: 2025, month: 2, day: 28 })
    expect(addCalendarMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({ year: 2024, month: 2, day: 29 })
    expect(addCalendarMonths({ year: 1999, month: 12, day: 31 }, 2)).toEqual({ year: 2000, month: 2, day: 29 })
    expect(addCalendarMonths({ year: 2026, month: 3, day: 15 }, 12)).toEqual({ year: 2027, month: 3, day: 15 })
    expect(addCalendarMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({ year: 2025, month: 12, day: 15 })
    expect(addCalendarMonths({ year: 2026, month: 3, day: 1 }, 11)).toEqual({ year: 2027, month: 2, day: 1 })
  })

  it('counts whole days across month and year boundaries', () => {
    expect(daysBetween({ year: 2026, month: 6, day: 6 }, { year: 2026, month: 6, day: 21 })).toBe(15)
    expect(daysBetween({ year: 2025, month: 12, day: 31 }, { year: 2026, month: 1, day: 1 })).toBe(1)
    expect(daysBetween({ year: 2024, month: 2, day: 28 }, { year: 2024, month: 3, day: 1 })).toBe(2)
    expect(daysBetween({ year: 2026, month: 1, day: 10 }, { year: 2026, month: 1, day: 1 })).toBe(-9)
  })

  it('shifts by days in both directions', () => {
    expect(addCalendarDays({ year: 2008, month: 6, day: 6 }, 15)).toEqual({ year: 2008, month: 6, day: 21 })
    expect(addCalendarDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({ year: 2025, month: 12, day: 31 })
  })

  it('orders dates and reports the weekday', () => {
    expect(compareCalendarDates({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 2 })).toBe(-1)
    expect(compareCalendarDates({ year: 2026, month: 1, day: 2 }, { year: 2026, month: 1, day: 1 })).toBe(1)
    expect(compareCalendarDates({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 })).toBe(0)
    // 2026-10-01 is a Thursday.
    expect(weekday({ year: 2026, month: 10, day: 1 })).toBe(4)
    expect(weekday({ year: 2026, month: 10, day: 4 })).toBe(0)
  })
})
