import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import * as Inv from '@deepseek-ai/dsh-patent-workflow/invariant'

/** 合法 plantask 载荷（每条断言基于该基线作单字段变异）。 */
function plantask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    caseId: 'case-1',
    state: 'planning',
    tasks: [
      { id: 'task-1', description: '解析交底书', hash: 'h1', status: 'pending', blockedBy: [] },
      { id: 'task-2', description: '检索现有技术', hash: 'h2', status: 'in_progress' },
    ],
    ...overrides,
  }
}

/** 合法 workflow-run 载荷（基于该基线作单字段变异）。 */
function workflowRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestId: 'patent_novelty_v1',
    caseType: 'novelty_analysis',
    completed: true,
    stages: [],
    degradedSteps: [],
    summary: '完成',
    ...overrides,
  }
}

/** 装载 invariant registry + session store + invariant companion。 */
async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Inv)
  return ctx
}

describe('patent-workflow invariant companion', () => {
  it('exports the companion surface', () => {
    expect(Inv.name).toBe('patent-workflow-invariant')
    expect(Inv.inject).toEqual(['invariants'])
    expect(typeof Inv.apply).toBe('function')
  })

  it('accepts a valid plantask append and a valid workflow-run append', async () => {
    const ctx = await boot()
    try {
      const session = ctx.sessions.create()
      session.append('patent/plantask', plantask() as never)
      session.append('patent/workflow-run', workflowRun() as never)
      expect(session.snapshotEvents()).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects malformed plantask payloads field by field', async () => {
    const ctx = await boot()
    try {
      const append = (data: unknown) => ctx.sessions.create().append('patent/plantask', data as never)
      expect(() => append(42)).toThrow(/plantask data must be an object/)
      expect(() => append(null)).toThrow(/plantask data must be an object/)
      expect(() => append(plantask({ caseId: 7 }))).toThrow(/caseId must be a non-empty string/)
      expect(() => append(plantask({ caseId: '  ' }))).toThrow(/caseId must be a non-empty string/)
      expect(() => append(plantask({ state: 7 }))).toThrow(/state is not a known PlanTaskState/)
      expect(() => append(plantask({ state: 'bogus' }))).toThrow(/state is not a known PlanTaskState/)
      expect(() => append(plantask({ feedback: 7 }))).toThrow(/feedback must be a string/)
      expect(() => append(plantask({ tasks: 'not-an-array' }))).toThrow(/tasks must be an array/)
      expect(() => append(plantask({ tasks: [null] }))).toThrow(/tasks entries must be objects/)
      expect(() => append(plantask({ tasks: [{ id: 7 }] }))).toThrow(/task id must be a non-empty string/)
      expect(() => append(plantask({ tasks: [{ id: '  ' }] }))).toThrow(/task id must be a non-empty string/)
      expect(() => append(plantask({ tasks: [{ id: 't', description: 7 }] }))).toThrow(/task description must be a string/)
      expect(() => append(plantask({ tasks: [{ id: 't', description: 'd', hash: 7 }] }))).toThrow(/task hash must be a string/)
      expect(() => append(plantask({ tasks: [{ id: 't', description: 'd', hash: 'h', status: 7 }] }))).toThrow(/status is not a known PlanTaskStatus/)
      expect(() => append(plantask({ tasks: [{ id: 't', description: 'd', hash: 'h', status: 'bogus' }] }))).toThrow(/status is not a known PlanTaskStatus/)
      expect(() => append(plantask({ tasks: [{ id: 't', description: 'd', hash: 'h', status: 'pending', blockedBy: 'x' }] }))).toThrow(/blockedBy must be an array of strings/)
      expect(() => append(plantask({ tasks: [{ id: 't', description: 'd', hash: 'h', status: 'pending', blockedBy: [1] }] }))).toThrow(/blockedBy must be an array of strings/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('accepts a plantask without tasks (early return) and without feedback', async () => {
    const ctx = await boot()
    try {
      const session = ctx.sessions.create()
      session.append('patent/plantask', { caseId: 'case-1', state: 'finished' } as never)
      session.append('patent/plantask', { caseId: 'case-2', state: 'awaiting_feedback' } as never)
      expect(session.snapshotEvents()).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects malformed workflow-run payloads field by field', async () => {
    const ctx = await boot()
    try {
      const append = (data: unknown) => ctx.sessions.create().append('patent/workflow-run', data as never)
      expect(() => append(42)).toThrow(/workflow-run data must be an object/)
      expect(() => append(workflowRun({ manifestId: 7 }))).toThrow(/manifestId must be a non-empty string/)
      expect(() => append(workflowRun({ manifestId: '  ' }))).toThrow(/manifestId must be a non-empty string/)
      expect(() => append(workflowRun({ caseType: 7 }))).toThrow(/caseType must be a non-empty string/)
      expect(() => append(workflowRun({ caseType: '' }))).toThrow(/caseType must be a non-empty string/)
      expect(() => append(workflowRun({ completed: 'yes' }))).toThrow(/completed must be a boolean/)
      expect(() => append(workflowRun({ summary: 7 }))).toThrow(/summary must be a string/)
      expect(() => append(workflowRun({ stages: 'nope' }))).toThrow(/stages must be an array/)
      expect(() => append(workflowRun({ degradedSteps: 'nope' }))).toThrow(/degradedSteps must be an array of strings/)
      expect(() => append(workflowRun({ degradedSteps: [7] }))).toThrow(/degradedSteps must be an array of strings/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('ignores events outside the package-owned patent/* vocabulary', async () => {
    const ctx = await boot()
    try {
      const session = ctx.sessions.create()
      session.append('turn/start', { turn: 1 })
      session.append('turn/start', { turn: 2 })
      expect(session.snapshotEvents()).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('validates seeded events on install: a malformed snapshot rejects the companion load', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionStore)
    try {
      const session = ctx.sessions.create(SessionId('seeded'), {
        seed: [{ type: 'patent/plantask', seq: SessionSeq(0), time: 0, data: plantask({ state: 'bogus' }) as never }],
      })
      expect(session.snapshotEvents()[0]!.type).toBe('patent/plantask')
      await expect(ctx.plugin(Inv)).rejects.toThrow(/state is not a known PlanTaskState/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('validates seeded workflow-run events on install', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionStore)
    try {
      ctx.sessions.create(SessionId('seeded-run'), {
        seed: [{ type: 'patent/workflow-run', seq: SessionSeq(0), time: 0, data: workflowRun({ completed: 'yes' }) as never }],
      })
      await expect(ctx.plugin(Inv)).rejects.toThrow(/completed must be a boolean/)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a clean seeded session loads the companion without complaint', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionStore)
    try {
      ctx.sessions.create(SessionId('clean'), {
        seed: [
          { type: 'patent/plantask', seq: SessionSeq(0), time: 0, data: plantask() as never },
          { type: 'patent/workflow-run', seq: SessionSeq(1), time: 0, data: workflowRun() as never },
        ],
      })
      await ctx.plugin(Inv)
      expect(ctx.invariants).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('a detached session (not in the store) is not validated on append', async () => {
    const ctx = await boot()
    try {
      const loose = Session.create(SessionId('loose'))
      loose.append('patent/plantask', { caseId: 7, state: 'bogus' } as never)
      expect(loose.snapshotEvents()).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
