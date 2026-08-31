/**
 * `patent_plan_task` tool: human-in-the-loop plan state machine for patent
 * tasks. Wire the dsh-patent-workflow plantask library (PlanTaskStateMachine,
 * syncPlanToTasks, replanTasks, TRANSITIONS) with fail-closed input validation
 * and canonical results. Stateless: the caller passes the current state on
 * every call.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-plan-task
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  PlanTaskSemanticError,
  PlanTaskStateMachine,
  replanTasks,
  syncPlanToTasks,
  TRANSITIONS,
  type PlanTask,
  type PlanTaskState,
} from '@deepseek-ai/dsh-patent-workflow'
import { PatentToolError } from '../error.ts'

/** The three plantask operations. */
export type PatentPlanTaskAction = 'transition' | 'sync' | 'replan'

/** Tool input: the operation plus the state/tasks it needs. */
export type PatentPlanTaskInput = {
  /** Operation to perform. */
  action: PatentPlanTaskAction
  /** Current state (transition; defaults to planning). */
  currentState?: string
  /** Target state (transition). */
  to?: string
  /** Plan steps to sync into tasks (sync/replan). */
  planSteps?: string[]
  /** Previously synced tasks (replan: preserve completed steps by hash). */
  previousTasks?: PlanTask[]
  /** Current task list (transition to executing: must be synced first). */
  tasks?: PlanTask[]
  /** Feedback driving replanning (transition to replanning). */
  feedback?: string
}

/** Tool canonical result: the operation outcome plus derived task state. */
export type PatentPlanTaskOutput = {
  /** Whether the operation succeeded (false carries an input error). */
  ok: boolean
  /** The operation echoed back. */
  action: PatentPlanTaskAction
  /** Transition: the state the call started from. */
  from?: PlanTaskState
  /** Transition: the resulting state. */
  state?: PlanTaskState
  /** sync/replan: the ordered task list. */
  tasks?: PlanTask[]
  /** replan: task ids preserved from the previous plan (hash-matched completed). */
  preserved?: string[]
  /** sync/replan: task ids to (re)execute. */
  toRun?: string[]
  /** Fail-closed reason (only when ok is false). */
  error?: string
}

const DESCRIPTION = [
  'Human-in-the-loop plan state machine for patent tasks. transition: whitelist-checked state changes (planning → awaiting_approval → executing → awaiting_feedback → replanning → finished). sync: turn plan steps into ordered tasks with blockedBy deps. replan: hash-compare completed steps for incremental resume. Fail-closed on illegal transitions and missing semantic preconditions (executing needs tasks, replanning needs feedback). Stateless: pass the current state on every call.',
].join('\n')
/**
 * Render the canonical plantask value into model-facing prose.
 * @param value - the plantask result.
 * @returns the multi-line result summary.
 */
export function renderPlanTask(value: PatentPlanTaskOutput): string {
  if (!value.ok) return `patent_plan_task: ${value.error ?? '失败'}`
  switch (value.action) {
    case 'transition':
      return `patent_plan_task: ${value.from} → ${value.state} ✅`
    case 'sync': {
      const tasks = value.tasks ?? []
      const lines = tasks.map(
        t => `- ${t.id} ${t.status}${t.blockedBy ? `（依赖 ${t.blockedBy.join(',')}）` : ''}: ${t.description}`,
      )
      return `patent_plan_task: 同步 ${tasks.length} 个任务\n${lines.join('\n')}\n待执行: ${(value.toRun ?? []).join(', ')}`
    }
    case 'replan': {
      const preservedList = value.preserved ?? []
      const preserved = preservedList.length > 0
        ? `保留已完成: ${preservedList.join(', ')}`
        : '无保留步骤'
      return `patent_plan_task: 重规划 → ${(value.tasks ?? []).length} 个任务\n${preserved}\n需执行: ${(value.toRun ?? []).join(', ') || '（全部已完成）'}`
    }
  }
}

/**
 * Build the `patent_plan_task` tool. Pure state-machine wiring; no LLM, search,
 * or persistence.
 * @returns a registry-ready tool definition.
 */
export function createPatentPlanTaskTool(): ToolDefinition {
  return defineTool({
    name: 'patent_plan_task',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['transition', 'sync', 'replan'],
        description: 'Operation: transition | sync | replan.',
      },
      currentState: { type: 'string', description: 'Current state (required for transition).' },
      to: { type: 'string', description: 'Target state (required for transition).' },
      planSteps: { type: 'array', items: { type: 'string' }, description: 'Plan steps (sync/replan).' },
      previousTasks: {
        type: 'array',
        description: 'Previous task list (replan, optional: preserve completed steps).',
        items: { type: 'object', additionalProperties: true },
      },
      tasks: {
        type: 'array',
        description: 'Current task list (transition to executing, required: sync first).',
        items: { type: 'object', additionalProperties: true },
      },
      feedback: { type: 'string', description: 'Feedback driving replanning (transition to replanning, required).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string', required: true, enum: ['transition', 'sync', 'replan'] },
          from: { type: 'string' },
          state: { type: 'string' },
          tasks: { type: 'array' },
          preserved: { type: 'array', items: { type: 'string' } },
          toRun: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPlanTask(value as unknown as PatentPlanTaskOutput) }],
    },
    // oxlint-disable-next-line typescript/require-await -- tool contract requires async execute
    async execute(args) {
      const input = args as unknown as PatentPlanTaskInput
      switch (input.action) {
        case 'transition': {
          const from = (input.currentState ?? 'planning') as PlanTaskState
          const to = input.to as PlanTaskState
          const validStates = new Set(Object.keys(TRANSITIONS))
          if (!validStates.has(from) || !validStates.has(to)) {
            throw new PatentToolError(
              'invalid_tool_input',
              `非法状态 "${from}" 或 "${to}"（合法: ${[...validStates].join(' / ')}）`,
            )
          }
          const machine = new PlanTaskStateMachine(from)
          if (!machine.canTransition(to)) {
            throw new PatentToolError('invalid_tool_input', `非法状态迁移 ${from} → ${to}（请检查 TRANSITIONS 白名单）`)
          }
          try {
            const next = machine.transition(to, {
              ...(input.tasks !== undefined ? { tasks: input.tasks } : {}),
              ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
            })
            return { ok: true, action: 'transition' as const, from, state: next }
          } catch (err) {
            /* v8 ignore next -- the canTransition pre-check above rules out every non-semantic transition error. */
            if (err instanceof PlanTaskSemanticError) {
              throw new PatentToolError('invalid_tool_input', err.message)
            }
            /* v8 ignore next -- the canTransition pre-check above rules out every other transition error. */
            throw new PatentToolError('tool_execution_failed', err instanceof Error ? err.message : String(err))
          }
        }
        case 'sync': {
          const steps = input.planSteps ?? []
          if (steps.length === 0) throw new PatentToolError('invalid_tool_input', 'sync 需要 planSteps 非空')
          const result = syncPlanToTasks(steps)
          return { ok: true, action: 'sync' as const, tasks: result.tasks as unknown as JsonValue[], preserved: [], toRun: result.toRun }
        }
        case 'replan': {
          const steps = input.planSteps ?? []
          if (steps.length === 0) throw new PatentToolError('invalid_tool_input', 'replan 需要 planSteps 非空')
          const result = replanTasks(input.previousTasks ?? [], steps)
          return { ok: true, action: 'replan' as const, tasks: result.tasks as unknown as JsonValue[], preserved: result.preserved, toRun: result.toRun }
        }
        /* v8 ignore next 5 -- the action schema enum already rejects unknown actions. */
        default:
          throw new PatentToolError(
            'invalid_tool_input',
            `未知操作 "${String(input.action)}"（可选: transition / sync / replan）`,
          )
      }
    },
  })
}
