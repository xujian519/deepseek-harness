import { describe, expect, it } from 'vitest'
import {
  PlanTaskSemanticError,
  PlanTaskStateError,
  PlanTaskStateMachine,
  hashStep,
  replanTasks,
  syncPlanToTasks,
} from '@deepseek-ai/dsh-patent-workflow'

describe('plantask state machine', () => {
  it('follows the allowed transition chain', () => {
    const sm = new PlanTaskStateMachine()
    expect(sm.state).toBe('planning')
    sm.transition('awaiting_approval')
    sm.transition('executing', { tasks: syncPlanToTasks(['步骤A']).tasks })
    sm.transition('awaiting_feedback')
    sm.transition('replanning', { feedback: '补充检索范围' })
    sm.transition('awaiting_approval')
    sm.transition('executing', { tasks: syncPlanToTasks(['步骤A', '步骤B']).tasks })
    sm.transition('finished')
    expect(sm.state).toBe('finished')
  })

  it('rejects illegal transitions', () => {
    const sm = new PlanTaskStateMachine()
    expect(() => sm.transition('executing')).toThrow(PlanTaskStateError)
    expect(() => sm.transition('finished')).toThrow(PlanTaskStateError)
    expect(sm.canTransition('awaiting_approval')).toBe(true)
    expect(sm.state).toBe('planning')
  })

  it('enforces tasks before executing (fail-closed)', () => {
    const sm = new PlanTaskStateMachine('awaiting_approval')
    expect(() => sm.transition('executing')).toThrow(PlanTaskSemanticError)
    expect(() => sm.transition('executing', {})).toThrow(PlanTaskSemanticError)
    expect(() => sm.transition('executing', { tasks: [] })).toThrow(PlanTaskSemanticError)
    sm.transition('executing', { tasks: syncPlanToTasks(['步骤A']).tasks })
    expect(sm.state).toBe('executing')
  })

  it('enforces feedback before replanning (fail-closed)', () => {
    const sm = new PlanTaskStateMachine('awaiting_feedback')
    expect(() => sm.transition('replanning')).toThrow(PlanTaskSemanticError)
    expect(() => sm.transition('replanning', { feedback: '   ' })).toThrow(PlanTaskSemanticError)
    sm.transition('replanning', { feedback: '对比文件 D3 需纳入' })
    expect(sm.state).toBe('replanning')
  })

  it('syncPlanToTasks builds ordered task list with blockedBy dependencies', () => {
    const steps = ['解析交底书', '检索现有技术', '对比特征', '生成结论']
    const { tasks, toRun } = syncPlanToTasks(steps)
    expect(tasks).toHaveLength(4)
    expect(tasks[0]!.blockedBy).toBeUndefined()
    expect(tasks[1]!.blockedBy).toEqual(['task-1'])
    expect(tasks[3]!.blockedBy).toEqual(['task-3'])
    expect(toRun).toHaveLength(4)
    expect(tasks.every(t => t.status === 'pending')).toBe(true)
  })

  it('hashStep is stable for identical input and differs for different input', () => {
    expect(hashStep('解析交底书')).toBe(hashStep('解析交底书'))
    expect(hashStep('解析交底书')).not.toBe(hashStep('检索现有技术'))
  })

  it('replanTasks preserves completed steps by hash and marks new steps to run', () => {
    const initial = syncPlanToTasks(['步骤A', '步骤B'])
    initial.tasks[0]!.status = 'completed'
    const replanned = replanTasks(initial.tasks, ['步骤A', '步骤B', '步骤C'])
    expect(replanned.preserved).toHaveLength(1)
    expect(replanned.preserved[0]).toBe('task-1')
    expect(replanned.toRun).toEqual(['task-2', 'task-3'])
    expect(replanned.tasks[0]!.status).toBe('completed')
    expect(replanned.tasks[1]!.status).toBe('pending')
    expect(replanned.tasks[2]!.status).toBe('pending')
  })
})
