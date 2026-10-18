import { describe, expect, it } from 'vitest'
import {
  DEGRADED_ERROR_KEY,
  DEGRADED_RETRYABLE_KEY,
  AtomRegistry,
  StageHandlerRegistry,
  type StageHandler,
  type WorkflowStage,
} from '@deepseek-ai/dsh-patent-core'
import { runStageOnce } from '@deepseek-ai/dsh-patent-workflow'

/** 注册一个只输出 `result` 的 Atom + Handler。 */
function makeRegistry(handler: StageHandler): { handlers: StageHandlerRegistry; atoms: AtomRegistry } {
  const handlers = new StageHandlerRegistry()
  const atoms = new AtomRegistry()
  handlers.register(handler)
  atoms.register({
    name: handler.name,
    description: '降级语义测试',
    category: handler.category,
    inputSchema: [],
    outputSchema: ['result'],
  })
  return { handlers, atoms }
}

function stage(): WorkflowStage {
  return { id: 's1', strategy: 'chain', description: '降级测试', atom: 'test-atom' }
}

describe('runStageOnce 降级语义', () => {
  it('终态 _error：只调用一次，输出原因，不写入共享 state', async () => {
    let calls = 0
    const { handlers, atoms } = makeRegistry({
      name: 'test-atom',
      category: 'extract',
      execute: async () => {
        calls += 1
        return { [DEGRADED_ERROR_KEY]: '[test-atom] 缺少输入' }
      },
    })
    const state: Record<string, unknown> = {}
    const outcome = await runStageOnce(stage(), state, {
      handlers,
      atoms,
      maxRetries: 2,
      ctx: {},
    })

    expect(calls).toBe(1)
    expect(outcome.output).toBe('[WORKFLOW_DEGRADED] [test-atom] 缺少输入')
    expect(outcome.retries).toBe(0)
    expect(state[DEGRADED_ERROR_KEY]).toBeUndefined()
    expect(state[DEGRADED_RETRYABLE_KEY]).toBeUndefined()
    expect(state.s1).toBe('[WORKFLOW_DEGRADED] [test-atom] 缺少输入')
  })

  it('可重试 _error 后成功：按失败次数重试，成功后不残留诊断', async () => {
    let calls = 0
    const { handlers, atoms } = makeRegistry({
      name: 'test-atom',
      category: 'extract',
      execute: async () => {
        calls += 1
        if (calls === 1) {
          return {
            [DEGRADED_ERROR_KEY]: '[test-atom] 临时失败',
            [DEGRADED_RETRYABLE_KEY]: true,
          }
        }
        return { result: '第二次成功' }
      },
    })
    const state: Record<string, unknown> = {}
    const outcome = await runStageOnce(stage(), state, {
      handlers,
      atoms,
      maxRetries: 2,
      ctx: {},
    })

    expect(calls).toBe(2)
    expect(outcome.output).toBe('第二次成功')
    expect(outcome.retries).toBe(1)
    expect(state[DEGRADED_ERROR_KEY]).toBeUndefined()
    expect(state[DEGRADED_RETRYABLE_KEY]).toBeUndefined()
  })

  it('可重试 _error 耗尽：输出最后原因，不写入共享 state', async () => {
    let calls = 0
    const { handlers, atoms } = makeRegistry({
      name: 'test-atom',
      category: 'extract',
      execute: async () => {
        calls += 1
        return {
          [DEGRADED_ERROR_KEY]: '[test-atom] 始终临时失败',
          [DEGRADED_RETRYABLE_KEY]: true,
        }
      },
    })
    const state: Record<string, unknown> = {}
    const outcome = await runStageOnce(stage(), state, {
      handlers,
      atoms,
      maxRetries: 1,
      ctx: {},
    })

    expect(calls).toBe(2)
    expect(outcome.output).toBe('[WORKFLOW_DEGRADED] [test-atom] 始终临时失败')
    expect(outcome.retries).toBe(1)
    expect(state[DEGRADED_ERROR_KEY]).toBeUndefined()
    expect(state[DEGRADED_RETRYABLE_KEY]).toBeUndefined()
  })

  it('可重试失败后空输出：保留上一轮真实原因，不被空输出覆盖', async () => {
    let calls = 0
    const { handlers, atoms } = makeRegistry({
      name: 'test-atom',
      category: 'extract',
      execute: async () => {
        calls += 1
        if (calls === 1) {
          return {
            [DEGRADED_ERROR_KEY]: '[test-atom] 临时失败',
            [DEGRADED_RETRYABLE_KEY]: true,
          }
        }
        return {}
      },
    })
    const outcome = await runStageOnce(stage(), {}, {
      handlers,
      atoms,
      maxRetries: 1,
      ctx: {},
    })

    expect(calls).toBe(2)
    expect(outcome.output).toContain('[test-atom] 临时失败')
  })

  it('终态 _error 与部分结果并存：保留部分结果，诊断作为主输出', async () => {
    const { handlers, atoms } = makeRegistry({
      name: 'test-atom',
      category: 'extract',
      execute: async () => ({
        result: '部分结果',
        [DEGRADED_ERROR_KEY]: '[test-atom] 终态失败',
      }),
    })
    const state: Record<string, unknown> = {}
    const outcome = await runStageOnce(stage(), state, {
      handlers,
      atoms,
      maxRetries: 2,
      ctx: {},
    })

    expect(outcome.output).toBe('[WORKFLOW_DEGRADED] [test-atom] 终态失败')
    expect(outcome.retries).toBe(0)
    expect(state.result).toBe('部分结果')
    expect(state[DEGRADED_ERROR_KEY]).toBeUndefined()
  })
})
