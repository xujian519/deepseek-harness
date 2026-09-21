import { describe, expect, it } from 'vitest'
import { DeadlineQueryError, evaluateDeadlines, type DeadlineQuery } from '../src/statutes.ts'
import { WorkCalendar, loadWorkCalendar } from '../src/work-calendar.ts'

const date = (text: string) => {
  const [year, month, day] = text.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

/** A calendar with no holidays and no moved weekend days, covering the years a test needs. */
function plainCalendar(from: number, to: number): WorkCalendar {
  const years = []
  for (let year = from; year <= to; year++) {
    years.push({ year, source: 'test', holidays: new Set<string>(), workdays: new Set<string>() })
  }
  return new WorkCalendar(years)
}

const base = { calendar: plainCalendar(2019, 2041), reminderLeadDays: 30 }

const find = (query: DeadlineQuery, id: string, options = base) =>
  evaluateDeadlines(query, options).computed.find(entry => entry.id === id)

const pendingIds = (query: DeadlineQuery, options = base) =>
  evaluateDeadlines(query, options).pending.map(entry => entry.id)

describe('statutory deadline set', () => {
  const invention: DeadlineQuery = {
    kind: 'invention',
    filingDate: date('2020-01-15'),
    claimsPriority: false,
    today: date('2026-09-20'),
  }

  it('computes the periods that run from the filing date', () => {
    expect(find(invention, 'priority-window')).toMatchObject({
      dueDate: '2021-01-15',
      rawDueDate: '2021-01-15',
      status: 'overdue',
      legalBasis: '专利法第29条第1款',
    })
    expect(find(invention, 'priority-restoration')).toMatchObject({
      dueDate: '2021-03-15',
      legalBasis: '专利法实施细则第36条',
    })
    expect(find(invention, 'application-fee')).toMatchObject({
      dueDate: '2020-03-16',
      legalBasis: '专利法实施细则第112条',
    })
    // 2023-01-15 is a Sunday, so the rest-day rule moves it to Monday while the
    // period's own end date is kept.
    expect(find(invention, 'substantive-exam-request')).toMatchObject({
      rawDueDate: '2023-01-15',
      dueDate: '2023-01-16',
      rolledForward: true,
      label: '请求实质审查并缴纳审查费（自申请日起3年）',
      legalBasis: '专利法第35条',
    })
    // 2040-01-15 is a Sunday, so the 20-year term is reported on Monday.
    expect(find(invention, 'patent-term')).toMatchObject({
      rawDueDate: '2040-01-15',
      dueDate: '2040-01-16',
      rolledForward: true,
      legalBasis: '专利法第42条第1款',
    })
  })

  it('reports the notice-driven deadlines as pending, naming the missing notice', () => {
    const report = evaluateDeadlines(invention, base)
    const ids = report.pending.map(entry => entry.id)
    expect(ids).toEqual([
      'annual-fee',
      'divisional-application',
      'invalidation-response',
      'oa-response-first',
      'oa-response-subsequent',
      'reexamination-deficiency-response',
      'reexamination-request',
      'registration',
      'term-compensation-request',
      'voluntary-amendment-invention',
    ])
    const registration = report.pending.find(entry => entry.id === 'registration')
    expect(registration?.requiredInput).toBe('grant-notice（授权通知的送达记录）')
    expect(registration?.reason).toContain('不以申请日起算的固定年数替代')
  })

  it('counts the substantive-examination request from the priority date when priority is claimed', () => {
    const query: DeadlineQuery = {
      ...invention,
      claimsPriority: true,
      priorityDate: date('2019-06-01'),
    }
    expect(find(query, 'substantive-exam-request')).toMatchObject({
      dueDate: '2022-06-01',
      label: '请求实质审查并缴纳审查费（自优先权日起3年）',
    })
    // 细则第37条 presupposes a priority claim: the entry exists only here.
    expect(find(query, 'priority-addition-or-correction')).toMatchObject({ dueDate: '2020-10-01' })
    expect(find(invention, 'priority-addition-or-correction')).toBeUndefined()
  })

  it('fails loud when the priority inputs contradict each other', () => {
    expect(() => evaluateDeadlines({ ...invention, claimsPriority: true }, base))
      .toThrow(DeadlineQueryError)
    expect(() => evaluateDeadlines({ ...invention, priorityDate: date('2019-06-01') }, base))
      .toThrow(/两者矛盾/)
  })

  it('reports the period\'s own end date under the un-rolled criterion', () => {
    const query: DeadlineQuery = { ...invention, restDayRule: 'omit' }
    const exam = find(query, 'substantive-exam-request')
    expect(exam).toMatchObject({ rawDueDate: '2023-01-15', dueDate: '2023-01-15', rolledForward: false })
    expect(evaluateDeadlines(query, base).restDayRule).toBe('omit')
    expect(evaluateDeadlines(invention, base).restDayRule).toBe('apply')
  })

  it('does not consult the holiday arrangement under the un-rolled criterion', () => {
    // The packaged calendar covers 2025-2026, so 2043 would carry a caveat under
    // the default criterion; omitting roll-forward needs no calendar at all.
    const query: DeadlineQuery = {
      kind: 'invention',
      filingDate: date('2023-10-01'),
      claimsPriority: false,
      today: date('2026-09-20'),
      restDayRule: 'omit',
    }
    expect(find(query, 'patent-term', { calendar: loadWorkCalendar(), reminderLeadDays: 30 })).toMatchObject({
      dueDate: '2043-10-01',
    })
  })

  it('starts registration and divisional filing at the grant notice delivery', () => {
    const query: DeadlineQuery = {
      ...invention,
      notices: [{ kind: 'grant-notice', delivery: { mode: 'electronic', dispatchDate: date('2026-09-01') } }],
    }
    expect(find(query, 'registration')).toMatchObject({
      dueDate: '2026-11-02',
      rawDueDate: '2026-11-01',
      rolledForward: true,
      legalBasis: '专利法实施细则第60条第1款、第114条',
    })
    expect(find(query, 'divisional-application')).toMatchObject({ dueDate: '2026-11-02' })
    expect(pendingIds(query)).not.toContain('registration')
  })

  it('numbers annual fees from the granted patent year and carries the six-month window', () => {
    const query: DeadlineQuery = {
      ...invention,
      authorizationPublicationDate: date('2026-09-01'),
    }
    // The grant falls in patent year 7, so fees run from year 8.
    expect(find(query, 'annual-fee-8')).toMatchObject({
      dueDate: '2027-01-15',
      legalBasis: '专利法实施细则第115条',
      latePaymentWindow: { from: '2027-01-15', to: '2027-07-15' },
    })
    expect(find(query, 'annual-fee-9')).toMatchObject({ dueDate: '2028-01-17', rolledForward: true })
    expect(pendingIds(query)).not.toContain('annual-fee')
  })

  it('does not add an annual fee for the granted year itself', () => {
    const query: DeadlineQuery = { ...invention, authorizationPublicationDate: date('2026-09-01') }
    const { computed } = evaluateDeadlines(query, base)
    expect(computed.some(entry => entry.id === 'annual-fee-7')).toBe(false)
  })

  it('counts a designated period from the notice dispatch date and honours its own designation', () => {
    const query: DeadlineQuery = {
      ...invention,
      notices: [
        { kind: 'office-action-first', delivery: { dispatchDate: date('2026-08-20') } },
        {
          kind: 'office-action-subsequent',
          delivery: { mode: 'postal', dispatchDate: date('2026-08-20') },
          designatedMonths: 1,
        },
      ],
    }
    expect(find(query, 'oa-response-first')).toMatchObject({
      dueDate: '2026-12-21',
      rolledForward: true,
      triggerBasis: '专利法实施细则第四条 + 专利审查指南第五部分第七章：电子送达以发文日为送达日，期限自发文日起算（不再加15日）',
    })
    // Postal delivery adds 15 days: 2026-09-04 plus one designated month.
    expect(find(query, 'oa-response-subsequent')).toMatchObject({
      dueDate: '2026-10-05',
      rolledForward: true,
    })
  })

  it('computes one period per recorded notice of a repeatable kind', () => {
    const query: DeadlineQuery = {
      ...invention,
      notices: [
        { kind: 'office-action-subsequent', delivery: { dispatchDate: date('2025-03-01') } },
        { kind: 'office-action-subsequent', delivery: { dispatchDate: date('2026-06-01') } },
      ],
    }
    const { computed } = evaluateDeadlines(query, base)
    // Each notice starts its own two-month period; the earlier one is overdue and stays visible.
    expect(computed.map(entry => entry.id)).toContain('oa-response-subsequent')
    expect(computed.map(entry => entry.id)).toContain('oa-response-subsequent-2')
    expect(find(query, 'oa-response-subsequent')).toMatchObject({ dueDate: '2025-05-01', status: 'overdue' })
    expect(find(query, 'oa-response-subsequent-2')).toMatchObject({ dueDate: '2026-08-03' })
    expect(find(query, 'oa-response-subsequent')?.label).toBe('答复后续审查意见通知书（指定期限一般为2个月，以通知书指定为准）（第 1 份通知）')
  })

  it('rejects a second record of a kind a case receives once', () => {
    const duplicate: DeadlineQuery = {
      ...invention,
      notices: [
        { kind: 'grant-notice', delivery: { dispatchDate: date('2026-09-01') } },
        { kind: 'grant-notice', delivery: { dispatchDate: date('2026-10-01') } },
      ],
    }
    expect(() => evaluateDeadlines(duplicate, base)).toThrow(DeadlineQueryError)
  })

  it('uses the 6-month priority window and 15-year term for a design patent', () => {
    const query: DeadlineQuery = {
      kind: 'design',
      filingDate: date('2024-03-10'),
      claimsPriority: false,
      today: date('2026-09-20'),
    }
    expect(find(query, 'priority-window')).toMatchObject({ dueDate: '2024-09-10' })
    expect(find(query, 'patent-term')).toMatchObject({ dueDate: '2039-03-10' })
    expect(find(query, 'voluntary-amendment-utility-design')).toMatchObject({ dueDate: '2024-05-10' })
    expect(find(query, 'substantive-exam-request')).toBeUndefined()
  })

  it('computes both PCT national-phase dates from the priority date', () => {
    const query: DeadlineQuery = {
      kind: 'invention',
      filingDate: date('2023-07-15'),
      claimsPriority: true,
      priorityDate: date('2023-01-15'),
      isPctNationalPhase: true,
      today: date('2026-09-20'),
    }
    expect(find(query, 'pct-national-entry')).toMatchObject({
      dueDate: '2025-07-15',
      legalBasis: '专利法实施细则第120条',
    })
    expect(find(query, 'pct-national-entry-grace')).toMatchObject({ dueDate: '2025-09-15' })
  })

  it('computes the term-compensation request from the grant publication date', () => {
    const query: DeadlineQuery = { ...invention, authorizationPublicationDate: date('2026-06-10') }
    expect(find(query, 'term-compensation-request')).toMatchObject({
      dueDate: '2026-09-10',
      status: 'overdue',
      legalBasis: '专利法第42条第2款、专利法实施细则第77条',
    })
  })

  it('warns on a deployment horizon rather than a fixed one', () => {
    const query: DeadlineQuery = { ...invention, today: date('2026-09-25') }
    const strict = { calendar: base.calendar, reminderLeadDays: 5000 }
    expect(find(query, 'patent-term', strict)?.status).toBe('urgent')
    expect(find(query, 'patent-term', base)?.status).toBe('normal')
  })

  it('marks an end date outside the holiday arrangement instead of rolling it', () => {
    const query: DeadlineQuery = {
      kind: 'invention',
      filingDate: date('2023-10-01'),
      claimsPriority: false,
      today: date('2026-09-20'),
    }
    // The packaged calendar covers 2025-2026, so the 2043 term date is unverified.
    const calendar = loadWorkCalendar()
    const term = find(query, 'patent-term', { calendar, reminderLeadDays: 30 })
    expect(term).toMatchObject({ dueDate: '2043-10-01', calendarCaveat: 'calendar-uncovered-year:2043' })
    // 申请日 2023-10-01 + 3年 = 2026-10-01, the first day of 国庆节 → 2026-10-08.
    const exam = find(query, 'substantive-exam-request', { calendar, reminderLeadDays: 30 })
    expect(exam).toMatchObject({ rawDueDate: '2026-10-01', dueDate: '2026-10-08', rolledForward: true })
  })

  it('sorts computed deadlines chronologically', () => {
    const { computed } = evaluateDeadlines(invention, base)
    const dates = computed.map(entry => entry.dueDate)
    expect([...dates].sort()).toEqual(dates)
  })
})
