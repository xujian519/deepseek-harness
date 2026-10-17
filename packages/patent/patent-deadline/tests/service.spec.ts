import { describe, expect, it } from 'vitest'
import { createPatentDeadlineService } from '../src/service.ts'
import { evaluateDeadlines, type DeadlineQuery } from '../src/statutes.ts'
import { WorkCalendar } from '../src/work-calendar.ts'

const date = (text: string) => {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

/** A calendar with no holidays and no moved weekend days over the given years. */
function calendarOf(years: number[]): WorkCalendar {
  return new WorkCalendar(years.map(year => ({ year, source: 'test', holidays: new Set<string>(), workdays: new Set<string>() })))
}

/** A calendar covering every year in `[from, to]`, for cases whose deadlines span decades. */
function plainCalendar(from: number, to: number): WorkCalendar {
  const years = []
  for (let year = from; year <= to; year++) years.push(year)
  return calendarOf(years)
}

const calendar = plainCalendar(2019, 2041)

describe('patentDeadline service', () => {
  it('delegates evaluate to evaluateDeadlines with the built-in reminder horizon', () => {
    const service = createPatentDeadlineService({ calendar, reminderLeadDays: 30 })
    const query: DeadlineQuery = {
      kind: 'invention',
      filingDate: date('2020-01-15'),
      claimsPriority: false,
      today: date('2026-09-20'),
    }
    expect(service.evaluate(query)).toEqual(evaluateDeadlines(query, { calendar, reminderLeadDays: 30 }))
  })

  it('lets one call override the reminder horizon without changing the service default', () => {
    const service = createPatentDeadlineService({ calendar, reminderLeadDays: 0 })
    const query: DeadlineQuery = {
      kind: 'invention',
      filingDate: date('2025-09-30'),
      claimsPriority: false,
      today: date('2026-09-20'),
    }
    const urgent = service.evaluate(query, { reminderLeadDays: 30 }).computed.find(entry => entry.id === 'priority-window')
    const normal = service.evaluate(query).computed.find(entry => entry.id === 'priority-window')
    expect(urgent?.status).toBe('urgent')
    expect(normal?.status).toBe('normal')
  })

  it('applies the built-in annual-fee horizon and lets one call override it', () => {
    const service = createPatentDeadlineService({
      calendar,
      reminderLeadDays: 30,
      annuityHorizonYears: 1,
    })
    const query: DeadlineQuery = {
      kind: 'invention',
      filingDate: date('2020-01-15'),
      claimsPriority: false,
      authorizationPublicationDate: date('2026-09-01'),
      today: date('2026-09-20'),
    }
    const fees = (report: ReturnType<typeof service.evaluate>) =>
      report.computed.filter(entry => entry.id.startsWith('annual-fee-')).map(entry => entry.id)
    expect(fees(service.evaluate(query))).toEqual(['annual-fee-8'])
    expect(fees(service.evaluate(query, { annuityHorizonYears: 3 })))
      .toEqual(['annual-fee-8', 'annual-fee-9', 'annual-fee-10'])
  })

  it('reports the loaded holiday-arrangement coverage, ascending', () => {
    const service = createPatentDeadlineService({ calendar: calendarOf([2027, 2024]), reminderLeadDays: 30 })
    expect(service.calendarCoverage()).toEqual({ years: [2024, 2027] })
  })

  it('passes through periodEnd, resolveDeliveryDate, and describePatentKind', () => {
    const service = createPatentDeadlineService({ calendar, reminderLeadDays: 30 })
    expect(service.periodEnd(date('2020-01-31'), { unit: 'month', count: 1 })).toEqual(date('2020-02-29'))
    const resolved = service.resolveDeliveryDate({ mode: 'electronic', dispatchDate: date('2026-03-02') })
    expect(resolved.date).toEqual(date('2026-03-02'))
    expect(resolved.basis).toContain('发文日为送达日')
    expect(service.describePatentKind('utility-model')).toBe('实用新型专利')
  })
})
