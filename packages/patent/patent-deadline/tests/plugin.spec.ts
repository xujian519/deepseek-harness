import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Pkg from '../src/index.ts'

async function install(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(Pkg, config)
  return { ctx, fiber }
}

describe('@deepseek-ai/dsh-patent-deadline plugin surface', () => {
  it('exports the function-plugin surface', () => {
    expect(Pkg.name).toBe('patent-deadline')
    expect(Pkg.inject).toEqual(['tools'])
    expect(typeof Pkg.apply).toBe('function')
    expect(typeof Pkg.Config).toBe('function')
  })

  it('exports the library API', () => {
    expect(typeof Pkg.periodEnd).toBe('function')
    expect(typeof Pkg.parseCalendarDate).toBe('function')
    expect(typeof Pkg.addCalendarMonths).toBe('function')
    expect(typeof Pkg.resolveDeliveryDate).toBe('function')
    expect(typeof Pkg.resolveDeliveryMode).toBe('function')
    expect(typeof Pkg.DeadlineQueryError).toBe('function')
    expect(typeof Pkg.loadWorkCalendar).toBe('function')
    expect(typeof Pkg.evaluateDeadlines).toBe('function')
    expect(typeof Pkg.renderDeadlineReport).toBe('function')
    expect(typeof Pkg.createPatentDeadlinesTool).toBe('function')
    expect(typeof Pkg.describePatentKind).toBe('function')
    expect(Pkg.CALENDAR_FILE_NAME).toBe('cn-holidays.yaml')
  })

  it('registers patent_deadlines and unregisters it on dispose (HMR-safety)', async () => {
    const { ctx, fiber } = await install()
    expect(ctx.tools.schemas().some(schema => schema.name === 'patent_deadlines')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'patent_deadlines')).toBe(false)
  })

  it('fails loud at load when the configured calendar directory has no asset', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(Pkg, { calendarDir: '/nonexistent/calendar-dir' })).rejects.toThrow(/无法读取工作日历资产/)
  })
})
