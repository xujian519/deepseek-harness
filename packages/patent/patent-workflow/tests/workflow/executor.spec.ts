import { describe, expect, it } from 'vitest'
import {
  AtomRegistry,
  InterruptStageError,
  StageHandlerRegistry,
  type StageHandler,
} from '@deepseek-ai/dsh-patent-core'
import { runStageOnce } from '@deepseek-ai/dsh-patent-workflow'
import type { WorkflowStage } from '@deepseek-ai/dsh-patent-core'

const APPROVAL_GRANTED_KEY = '__approval_granted__'

function makeRegistry(handler?: StageHandler): { handlers: StageHandlerRegistry; atoms: AtomRegistry } {
  const handlers = new StageHandlerRegistry()
  const atoms = new AtomRegistry()
  if (handler) {
    handlers.register(handler)
    atoms.register({
      name: handler.name,
      description: '提取',
      category: handler.category,
      inputSchema: [],
      outputSchema: ['result'],
    })
  }
  return { handlers, atoms }
}

function stage(overrides: Partial<WorkflowStage> = {}): WorkflowStage {
  return { id: 's1', strategy: 'chain', description: '测试阶段', ...overrides }
}

const emptyOptions = {
  handlers: new StageHandlerRegistry(),
  atoms: new AtomRegistry(),
  maxRetries: 2,
  ctx: {},
}

describe('runStageOnce', () => {
  it('atom handler output merges into state via the main output key', async () => {
    const { handlers, atoms } = makeRegistry({
      name: 'extract',
      category: 'extract',
      execute: async () => ({ result: '提取结果', extra: 1 }),
    })
    const state: Record<string, unknown> = {}
    const outcome = await runStageOnce(stage({ atom: 'extract' }), state, { ...emptyOptions, handlers, atoms })
    expect(outcome.output).toBe('提取结果')
    expect(state).toEqual({ result: '提取结果', extra: 1, s1: '提取结果' })
  })

  it('falls back to the executor when no atom is declared', async () => {
    let calls = 0
    const outcome = await runStageOnce(
      stage(),
      {},
      {
        ...emptyOptions,
        executor: async (s, _ctx) => {
          calls += 1
          expect(s.id).toBe('s1')
          return 'executor 产出'
        },
      },
    )
    expect(outcome.output).toBe('executor 产出')
    expect(calls).toBe(1)
  })

  it('handler throws, retries, then succeeds', async () => {
    let attempts = 0
    const { handlers, atoms } = makeRegistry({
      name: 'extract',
      category: 'extract',
      execute: async () => {
        attempts += 1
        if (attempts < 2) throw new Error('第一次失败')
        return { result: '第二次成功' }
      },
    })
    const outcome = await runStageOnce(stage({ atom: 'extract' }), {}, { ...emptyOptions, handlers, atoms })
    expect(outcome.output).toBe('第二次成功')
    expect(outcome.retries).toBe(1)
  })

  it('retries exhausted marks the degraded prefix', async () => {
    const { handlers, atoms } = makeRegistry({
      name: 'extract',
      category: 'extract',
      execute: async () => { throw new Error('始终失败') },
    })
    const outcome = await runStageOnce(stage({ atom: 'extract' }), {}, { ...emptyOptions, handlers, atoms })
    expect(outcome.output.startsWith('[WORKFLOW_DEGRADED] s1:')).toBe(true)
    expect(outcome.output).toMatch(/始终失败/)
  })

  it('setup_required configuration errors propagate (fail loud, not retried or degraded)', async () => {
    const { handlers, atoms } = makeRegistry({
      name: 'extract',
      category: 'extract',
      execute: async () => {
        throw Object.assign(new Error('未配置 LLM provider/model'), { code: 'setup_required' })
      },
    })
    await expect(
      runStageOnce(stage({ atom: 'extract' }), {}, { ...emptyOptions, handlers, atoms }),
    ).rejects.toThrow(/未配置 LLM/)
  })

  it('an approved gate injects the grant marker and placeholds APPROVED output', async () => {
    const { handlers, atoms } = makeRegistry({
      name: 'approval-gate',
      category: 'gate',
      execute: async (input) => {
        expect(input.state[APPROVAL_GRANTED_KEY]).toBe(true)
        return {}
      },
    })
    const outcome = await runStageOnce(
      stage({ atom: 'approval-gate' }),
      {},
      { ...emptyOptions, handlers, atoms, approvalGrants: ['s1'] },
    )
    expect(outcome.output).toBe('APPROVED')
  })

  it('InterruptStageError propagates as interrupted (not degraded)', async () => {
    const { handlers, atoms } = makeRegistry({
      name: 'approval-gate',
      category: 'gate',
      execute: async () => { throw new InterruptStageError('s1', '等待人工确认', { stageId: 's1' }) },
    })
    const outcome = await runStageOnce(stage({ atom: 'approval-gate' }), {}, { ...emptyOptions, handlers, atoms })
    expect(outcome.interrupted).toBeDefined()
    expect(outcome.interrupted!.stageId).toBe('s1')
    expect(outcome.output).toBe('')
  })
})
