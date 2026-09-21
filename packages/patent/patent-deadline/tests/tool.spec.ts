import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { loadWorkCalendar } from '../src/work-calendar.ts'
import { createPatentDeadlinesTool, type PatentDeadlinesOutput } from '../src/tool/patent-deadlines.ts'

const FIXED_TODAY = { year: 2026, month: 9, day: 20 }

async function host(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(createPatentDeadlinesTool({
    calendar: loadWorkCalendar(),
    reminderLeadDays: 30,
    now: () => FIXED_TODAY,
  }))
  return ctx
}

function execute(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('patent-deadlines'),
    name: 'patent_deadlines',
    arguments: args,
  })
}

describe('patent_deadlines tool', () => {
  it('computes the deadline set and renders it with the report date and criterion', async () => {
    const ctx = await host()
    const result = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2023-10-01',
      claimsPriority: false,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as PatentDeadlinesOutput
    expect(value.asOf).toBe('2026-09-20')
    expect(value.claimsPriority).toBe(false)
    expect(value.restDayRule).toBe('apply')
    const exam = value.computed.find(entry => entry.id === 'substantive-exam-request')
    expect(exam).toMatchObject({ rawDueDate: '2026-10-01', dueDate: '2026-10-08', rolledForward: true })
    expect(value.pending.map(entry => entry.id)).toContain('registration')

    const text = result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
    expect(text).toContain('patent_deadlines: 发明专利 · 申请日 2023-10-01 · 基准日 2026-09-20 · 未主张优先权')
    expect(text).toContain('| 期限事项 | 届满日 | 期限届满 | 剩余 | 状态 | 法律依据 |')
    expect(text).toContain('已应用专利法实施细则第5条的届满日顺延')
    expect(text).toContain('无法计算的期限')
    expect(text).toContain('grant-notice（授权通知的送达记录）')
  })

  it('counts the substantive-examination request from the priority date when priority is claimed', async () => {
    const ctx = await host()
    const result = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2020-01-15',
      claimsPriority: true,
      priorityDate: '2019-06-01',
    })
    if (result.isError) throw new Error('expected success')
    const value = result.value as PatentDeadlinesOutput
    expect(value.priorityDate).toBe('2019-06-01')
    expect(value.computed.find(entry => entry.id === 'substantive-exam-request')).toMatchObject({
      dueDate: '2022-06-01',
      label: '请求实质审查并缴纳审查费（自优先权日起3年）',
    })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
    expect(text).toContain('主张优先权（优先权日 2019-06-01）')
  })

  it('reports the un-rolled criterion when asked for it', async () => {
    const ctx = await host()
    const result = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2023-10-01',
      claimsPriority: false,
      restDayRule: 'omit',
    })
    if (result.isError) throw new Error('expected success')
    const value = result.value as PatentDeadlinesOutput
    expect(value.restDayRule).toBe('omit')
    expect(value.computed.find(entry => entry.id === 'substantive-exam-request')).toMatchObject({
      rawDueDate: '2026-10-01',
      dueDate: '2026-10-01',
      rolledForward: false,
    })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
    expect(text).toContain('**不顺延**')
  })

  it('rejects contradictory priority inputs instead of picking one', async () => {
    const ctx = await host()
    const claimedWithoutDate = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2020-01-15',
      claimsPriority: true,
    })
    expect(claimedWithoutDate.isError).toBe(true)
    expect(JSON.stringify(claimedWithoutDate.content)).toContain('priorityDate')

    const dateWithoutClaim = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2020-01-15',
      claimsPriority: false,
      priorityDate: '2019-06-01',
    })
    expect(dateWithoutClaim.isError).toBe(true)
    expect(JSON.stringify(dateWithoutClaim.content)).toContain('两者矛盾')
  })

  it('applies a delivered notice to its designated period, dating it at dispatch', async () => {
    const ctx = await host()
    const result = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2023-10-01',
      claimsPriority: false,
      notices: [{ kind: 'office-action-first', dispatchDate: '2026-08-20' }],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const value = result.value as PatentDeadlinesOutput
    expect(value.computed.find(entry => entry.id === 'oa-response-first')).toMatchObject({ dueDate: '2026-12-21' })
  })

  it('reports a postal notice with the 15-day presumption', async () => {
    const ctx = await host()
    const result = await execute(ctx, {
      patentType: 'utility-model',
      filingDate: '2025-02-10',
      claimsPriority: false,
      notices: [{ kind: 'office-action-first', mode: 'postal', dispatchDate: '2026-08-20' }],
    })
    if (result.isError) throw new Error('expected success')
    const value = result.value as PatentDeadlinesOutput
    const entry = value.computed.find(item => item.id === 'oa-response-first')
    expect(entry?.triggerBasis).toContain('满15日')
    // 2026-08-20 + 15 days = 2026-09-04, plus the designated 4 months = 2027-01-04,
    // which the packaged 2025-2026 calendar cannot verify for rest days.
    expect(entry?.dueDate).toBe('2027-01-04')
    expect(entry?.calendarCaveat).toBe('calendar-uncovered-year:2027')
  })

  it('fails loud on a malformed date instead of guessing one', async () => {
    const ctx = await host()
    const result = await execute(ctx, { patentType: 'invention', filingDate: '2025-02-29', claimsPriority: false })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('filingDate')
  })

  it('rejects an unknown notice kind at the schema boundary', async () => {
    const ctx = await host()
    const result = await execute(ctx, {
      patentType: 'invention',
      filingDate: '2023-10-01',
      claimsPriority: false,
      notices: [{ kind: 'not-a-notice', mode: 'electronic', dispatchDate: '2026-08-20' }],
    })
    expect(result.isError).toBe(true)
  })
})
