import { describe, expect, it } from 'vitest'
import {
  loadWorkCalendar,
  parseWorkCalendar,
  WorkCalendar,
  WorkCalendarCoverageError,
  WorkCalendarError,
} from '../src/work-calendar.ts'

const date = (text: string) => {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

const ASSET = `
years:
  - year: 2026
    source: test arrangement
    holidays: ["2026-01-01", "2026-01-02", "2026-10-01", "2026-10-02"]
    workdays: ["2026-01-04", "2026-10-10"]
`

describe('work calendar', () => {
  it('treats a statutory holiday and an unadjusted weekend as rest days', () => {
    const calendar = parseWorkCalendar(ASSET)
    expect(calendar.isRestDay(date('2026-01-01'))).toBe(true)
    expect(calendar.isRestDay(date('2026-10-01'))).toBe(true)
    // 2026-03-07 is a Saturday and not moved to a working day.
    expect(calendar.isRestDay(date('2026-03-07'))).toBe(true)
    expect(calendar.isRestDay(date('2026-03-08'))).toBe(true)
  })

  it('treats a moved weekend day as a working day', () => {
    const calendar = parseWorkCalendar(ASSET)
    // 2026-01-04 is a Sunday moved to a working day.
    expect(calendar.isRestDay(date('2026-01-04'))).toBe(false)
    expect(calendar.isRestDay(date('2026-03-09'))).toBe(false)
  })

  it('rolls a rest-day end date to the next working day', () => {
    const calendar = parseWorkCalendar(ASSET)
    expect(calendar.rollForward(date('2026-10-01'))).toEqual({ date: date('2026-10-05'), rolled: true })
    // A moved Sunday is already a working day: nothing to roll.
    expect(calendar.rollForward(date('2026-01-04'))).toEqual({ date: date('2026-01-04'), rolled: false })
    expect(calendar.rollForward(date('2026-03-07'))).toEqual({ date: date('2026-03-09'), rolled: true })
  })

  it('reports an uncovered year rather than assuming a working day', () => {
    const calendar = parseWorkCalendar(ASSET)
    expect(calendar.covers(date('2026-06-01'))).toBe(true)
    expect(calendar.covers(date('2027-06-01'))).toBe(false)
    expect(() => calendar.isRestDay(date('2027-06-01'))).toThrow(WorkCalendarCoverageError)
    expect(() => calendar.rollForward(date('2027-06-01'))).toThrow(/未覆盖 2027 年/)
  })

  it('reports an uncovered year when rolling crosses the year boundary', () => {
    const calendar = new WorkCalendar([{
      year: 2026,
      source: 'test',
      holidays: new Set(['2026-12-31']),
      workdays: new Set<string>(),
    }])
    expect(() => calendar.rollForward(date('2026-12-31'))).toThrow(WorkCalendarCoverageError)
  })

  it('ships the packaged calendar for 2025 and 2026', () => {
    const calendar = loadWorkCalendar()
    expect(calendar.coveredYears).toEqual([2025, 2026])
    // 2026 国庆节: 10月1日至7日放假, 10月10日(周六)上班.
    expect(calendar.isRestDay(date('2026-10-07'))).toBe(true)
    expect(calendar.isRestDay(date('2026-10-10'))).toBe(false)
    expect(calendar.rollForward(date('2026-10-01'))).toEqual({ date: date('2026-10-08'), rolled: true })
    // 2026 春节调休: 2月28日(周六)上班.
    expect(calendar.isRestDay(date('2026-02-28'))).toBe(false)
  })

  it('rejects a malformed calendar asset', () => {
    expect(() => parseWorkCalendar('years: []')).toThrow(/非空数组/)
    expect(() => parseWorkCalendar('years: {}')).toThrow(/非空数组/)
    expect(() => parseWorkCalendar('- 1')).toThrow(/必须是对象/)
    expect(() => parseWorkCalendar('years: [{ year: 2026, holidays: [] }]')).toThrow(/必须写明节假日安排的出处/)
    expect(() => parseWorkCalendar('years: [{ year: 2026, source: "s", holidays: ["2027-01-01"] }]'))
      .toThrow(/不属于声明年份/)
    expect(() => parseWorkCalendar('years: [{ year: 2026, source: "s" }, { year: 2026, source: "s" }]'))
      .toThrow(/重复声明/)
    expect(() => parseWorkCalendar('years: [{ year: 2026, source: "s", holidays: [20260101] }]'))
      .toThrow(/含非字符串日期/)
  })

  it('fails loud when the calendar asset is missing', () => {
    expect(() => loadWorkCalendar('/nonexistent/calendar-dir')).toThrow(WorkCalendarError)
  })
})
