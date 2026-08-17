import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerBuiltinAtoms, type PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import type { FlexiblePlanState, FlexiblePlanStore } from '@deepseek-ai/dsh-patent-workflow'
import { PatentToolError } from '../src/error.ts'
import {
  createFlexiblePlanTool,
  renderFlexiblePlan,
  type FlexiblePlanOutput,
} from '../src/tool/patent-flexible-plan.ts'

registerBuiltinAtoms()

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

/** In-memory plan store so tests never touch the real filesystem for plans. */
class MemoryPlanStore implements FlexiblePlanStore {
  private readonly plans = new Map<string, FlexiblePlanState>()

  async savePlan(state: FlexiblePlanState): Promise<void> {
    this.plans.set(state.caseId, structuredClone(state))
  }

  async loadPlan(caseId: string): Promise<FlexiblePlanState | undefined> {
    const plan = this.plans.get(caseId)
    return plan === undefined ? undefined : structuredClone(plan)
  }

  async listCaseIds(): Promise<string[]> {
    return [...this.plans.keys()]
  }
}

function fakeModel(): PatentModelPort {
  return {
    stream: async function* () {
      yield { type: 'delta', text: 'plain text output' }
      yield { type: 'done' }
    },
  }
}

const STAGES = [
  { id: 'extract', name: '提取', goal: '提取技术特征', strategy: 'chain' as const },
  { id: 'report', name: '报告', goal: '生成报告', strategy: 'chain' as const },
]

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

describe('flexible_plan', () => {
  it('registers under flexible_plan', () => {
    expect(createFlexiblePlanTool().name).toBe('flexible_plan')
  })

  it('creates and gets a plan', async () => {
    const store = new MemoryPlanStore()
    const tool = createFlexiblePlanTool({ store })
    const created = (await tool.execute(
      { action: 'create', caseId: 'case-1', caseType: 'novelty_search', stages: STAGES },
      exec,
    )) as FlexiblePlanOutput
    expect(created.plan?.status).toBe('active')
    expect(created.plan?.stages).toHaveLength(2)
    expect(created.plan?.currentStageId).toBe('extract')

    const got = (await tool.execute({ action: 'get', caseId: 'case-1' }, exec)) as FlexiblePlanOutput
    expect(got.plan?.caseId).toBe('case-1')
  })

  it('confirms then rolls back a stage', async () => {
    const store = new MemoryPlanStore()
    const tool = createFlexiblePlanTool({ store })
    await tool.execute({ action: 'create', caseId: 'c', caseType: 'drafting', stages: STAGES }, exec)
    const confirmed = (await tool.execute({ action: 'confirm', caseId: 'c', stageId: 'extract' }, exec)) as FlexiblePlanOutput
    expect(confirmed.plan?.stages[0]?.status).toBe('confirmed')

    const rolled = (await tool.execute({ action: 'rollback', caseId: 'c', stageId: 'extract' }, exec)) as FlexiblePlanOutput
    expect(rolled.plan?.stages[0]?.status).toBe('rolled_back')
  })

  it('adds, removes, reorders, and completes', async () => {
    const store = new MemoryPlanStore()
    const tool = createFlexiblePlanTool({ store })
    await tool.execute({ action: 'create', caseId: 'c', caseType: 'drafting', stages: STAGES }, exec)

    const added = (await tool.execute(
      { action: 'add', caseId: 'c', stage: { id: 'extra', name: '额外', goal: 'g', strategy: 'chain' } },
      exec,
    )) as FlexiblePlanOutput
    expect(added.plan?.stages).toHaveLength(3)

    const removed = (await tool.execute({ action: 'remove', caseId: 'c', stageId: 'extra' }, exec)) as FlexiblePlanOutput
    expect(removed.plan?.stages).toHaveLength(2)

    const reordered = (await tool.execute(
      { action: 'reorder', caseId: 'c', stageIds: ['report', 'extract'] },
      exec,
    )) as FlexiblePlanOutput
    expect(reordered.plan?.stages[0]?.id).toBe('report')

    const completed = (await tool.execute({ action: 'complete', caseId: 'c' }, exec)) as FlexiblePlanOutput
    expect(completed.plan?.status).toBe('completed')
  })

  it('abandons with a reason kept for audit', async () => {
    const store = new MemoryPlanStore()
    const tool = createFlexiblePlanTool({ store })
    await tool.execute({ action: 'create', caseId: 'c', caseType: 'drafting', stages: STAGES }, exec)
    const abandoned = (await tool.execute(
      { action: 'abandon', caseId: 'c', reason: '客户撤回' },
      exec,
    )) as FlexiblePlanOutput
    expect(abandoned.plan?.status).toBe('abandoned')
    expect(abandoned.plan?.abandonReason).toBe('客户撤回')
  })

  it('runs unconfirmed stages through runWorkflow', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-tools-'))
    const store = new MemoryPlanStore()
    const tool = createFlexiblePlanTool({ store, model: fakeModel(), cwd: temp })
    await tool.execute({ action: 'create', caseId: 'c', caseType: 'drafting', inputText: '交底书', stages: STAGES }, exec)

    const run = (await tool.execute({ action: 'run', caseId: 'c' }, exec)) as FlexiblePlanOutput
    expect(run.run?.manifestId).toBe('flexible_c')
    expect(run.run?.completed).toBe(true)
    expect(run.run?.stages).toHaveLength(2)
  })

  it('fails closed on create without caseType', async () => {
    const tool = createFlexiblePlanTool({ store: new MemoryPlanStore() })
    await expect(tool.execute({ action: 'create', caseId: 'c' }, exec)).rejects.toThrow('create 需要 caseType')
  })

  it('fails closed on a missing plan', async () => {
    const tool = createFlexiblePlanTool({ store: new MemoryPlanStore() })
    await expect(tool.execute({ action: 'get', caseId: 'nope' }, exec)).rejects.toThrow(PatentToolError)
  })

  it('fails closed on an unknown action via args validation', async () => {
    const tool = createFlexiblePlanTool({ store: new MemoryPlanStore() })
    await expect(tool.execute({ action: 'nope', caseId: 'c' }, exec)).rejects.toThrow('invalid arguments')
  })

  it('renders plan summary prose', () => {
    const plan: FlexiblePlanState = {
      caseId: 'c',
      caseType: 'drafting',
      status: 'active',
      stages: [
        { id: 'extract', name: '提取', goal: '提取特征', strategy: 'chain', status: 'pending', artifacts: [], constraintIds: [], articleJudgments: [] },
      ],
      currentStageId: 'extract',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    const text = renderFlexiblePlan(
      { action: 'get', caseId: 'c' },
      { action: 'get', caseId: 'c', plan },
    )
    expect(text).toContain('flexible_plan(caseId=c, caseType=drafting, status=active)')
    expect(text).toContain('- ⏳ extract（chain）: 提取特征')
  })
})
