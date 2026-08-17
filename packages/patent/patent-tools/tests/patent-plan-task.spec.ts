import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { hashStep } from '@deepseek-ai/dsh-patent-workflow'
import { PatentToolError } from '../src/error.ts'
import {
  createPatentPlanTaskTool,
  renderPlanTask,
  type PatentPlanTaskOutput,
} from '../src/tool/patent-plan-task.ts'

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

describe('patent_plan_task', () => {
  const tool = createPatentPlanTaskTool()

  it('registers under patent_plan_task', () => {
    expect(tool.name).toBe('patent_plan_task')
  })

  it('transitions planning → awaiting_approval', async () => {
    const value = (await tool.execute({ action: 'transition', currentState: 'planning', to: 'awaiting_approval' }, exec)) as PatentPlanTaskOutput
    expect(value.ok).toBe(true)
    expect(value.from).toBe('planning')
    expect(value.state).toBe('awaiting_approval')
  })

  it('rejects executing without synced tasks (semantic guard)', async () => {
    await expect(
      tool.execute({ action: 'transition', currentState: 'awaiting_approval', to: 'executing' }, exec),
    ).rejects.toThrow(PatentToolError)
  })

  it('rejects an illegal transition', async () => {
    await expect(
      tool.execute({ action: 'transition', currentState: 'planning', to: 'finished' }, exec),
    ).rejects.toThrow('非法状态迁移')
  })

  it('rejects an unknown state name', async () => {
    await expect(
      tool.execute({ action: 'transition', currentState: 'nonsense', to: 'planning' }, exec),
    ).rejects.toThrow('非法状态')
  })

  it('rejects an unknown action via args validation', async () => {
    await expect(tool.execute({ action: 'nope' }, exec)).rejects.toThrow('invalid arguments')
  })

  it('syncs plan steps into ordered tasks with blockedBy deps', async () => {
    const value = (await tool.execute({ action: 'sync', planSteps: ['a', 'b', 'c'] }, exec)) as PatentPlanTaskOutput
    expect(value.ok).toBe(true)
    expect(value.tasks).toHaveLength(3)
    expect(value.tasks?.[0]?.blockedBy).toBeUndefined()
    expect(value.tasks?.[1]?.blockedBy).toEqual(['task-1'])
    expect(value.tasks?.[2]?.blockedBy).toEqual(['task-2'])
    expect(value.toRun).toEqual(['task-1', 'task-2', 'task-3'])
  })

  it('replans preserving completed steps by hash', async () => {
    const previousTasks = [
      { id: 'task-1', description: 'a', hash: hashStep('a'), status: 'completed' as const },
      { id: 'task-2', description: 'b', hash: hashStep('b'), status: 'pending' as const },
    ]
    const value = (await tool.execute(
      { action: 'replan', planSteps: ['a', 'b2'], previousTasks },
      exec,
    )) as PatentPlanTaskOutput
    expect(value.ok).toBe(true)
    expect(value.preserved).toEqual(['task-1'])
    expect(value.toRun).toEqual(['task-2'])
    expect(value.tasks).toHaveLength(2)
    expect(value.tasks?.[0]?.status).toBe('completed')
  })

  it('renders transition, sync, and error prose', () => {
    const transition = renderPlanTask({ ok: true, action: 'transition', from: 'planning', state: 'awaiting_approval' })
    expect(transition).toContain('planning → awaiting_approval')
    const sync = renderPlanTask({
      ok: true,
      action: 'sync',
      tasks: [{ id: 'task-1', description: 'a', hash: 'h', status: 'pending' }],
      preserved: [],
      toRun: ['task-1'],
    })
    expect(sync).toContain('同步 1 个任务')
    expect(sync).toContain('- task-1 pending: a')
    const error = renderPlanTask({ ok: false, action: 'sync', error: 'sync 需要 planSteps 非空' })
    expect(error).toContain('patent_plan_task: sync 需要 planSteps 非空')
  })
})
