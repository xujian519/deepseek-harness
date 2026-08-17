import { expect, it } from 'vitest'
import {
  GraphBuilder,
  InterruptStageError,
  globalAtomRegistry,
  globalStageHandlerRegistry,
  handlerNode,
  manifestToGraph,
  registerBuiltinAtoms,
  type StageHandler,
  type StageProvider,
  type WorkflowContext,
  type WorkflowManifest,
  type WorkflowStage,
} from '@deepseek-ai/dsh-patent-core'

registerBuiltinAtoms()

// ---------------------------------------------------------------------------
// mock provider（prompt 特征匹配，对齐 tests/patent/atoms.spec.ts 风格）
// ---------------------------------------------------------------------------

const provider: StageProvider = {
  callLLM: async (prompt) => {
    if (prompt.includes('技术分析助手')) {
      return JSON.stringify({ features: ['特征A', '特征B'], problems: ['问题1'], effects: ['效果1'] })
    }
    if (prompt.includes('交底书分析师')) {
      return JSON.stringify({
        scores: [
          { feature: '特征A', score: 0.9, reason: '原文记载' },
          { feature: '特征B', score: 0.3, reason: '推断' },
        ],
        feedback: '特征B依据不足',
      })
    }
    if (prompt.includes('检索关键词')) {
      return JSON.stringify({ keywords: ['分拣', '自动化', '传感器'] })
    }
    if (prompt.includes('新颖性分析专家')) {
      return JSON.stringify({
        assessments: [{ feature: '特征A', prior_art: 'D1', disclosed: false, reasoning: '未公开' }],
        conclusion: '具备新颖性（置信度 0.8）',
      })
    }
    if (prompt.includes('权利要求撰写专家')) {
      return JSON.stringify({
        claims: ['1. 一种自动化分拣装置，其特征在于，包括传送带与识别传感器。'],
        notes: '独立权利要求',
      })
    }
    return '默认推理结论'
  },
  search: async query => [{ title: `文献: ${query}`, snippet: '摘要', url: 'https://example.com/1' }],
}

const okExecutor = (stage: WorkflowStage, ctx: WorkflowContext): Promise<string> =>
  Promise.resolve(`[${stage.id}] 完成。输入: ${ctx.input ?? ''}`)

// ---------------------------------------------------------------------------
// handlerNode
// ---------------------------------------------------------------------------

it('handlerNode: 普通 handler 作为图节点执行', async () => {
  const handler: StageHandler = {
    name: 't',
    category: 'extract',
    execute: async () => ({ out: 'hello' }),
  }
  const builder = new GraphBuilder()
  builder.addNode('t', handlerNode(handler)).addEdge('t', '__end__')
  const graph = builder.compile('t')
  const result = await graph.run({})
  expect(result.state.out).toBe('hello')
})

it('handlerNode: InterruptStageError 转 GraphInterruptError（引擎暂停）', async () => {
  const handler: StageHandler = {
    name: 'approve',
    category: 'gate',
    execute: async () => {
      throw new InterruptStageError('approve', '需要确认', { ctx: 'x' })
    },
  }
  const builder = new GraphBuilder()
  builder
    .addNode('approve', handlerNode(handler))
    .addNode('after', async () => ({ never: true }))
    .addEdge('approve', 'after')
  const graph = builder.compile('approve')
  const result = await graph.run({})
  expect(result.completed).toBe(false)
  expect(result.interrupted).toEqual({ node: 'approve', message: '需要确认', data: { ctx: 'x' } })
  expect(result.state.never).toBeUndefined()
})

// ---------------------------------------------------------------------------
// manifestToGraph（WorkflowManifest → 图）
// ---------------------------------------------------------------------------

it('manifestToGraph: 简单线性 manifest 输出各阶段结果', async () => {
  const manifest: WorkflowManifest = {
    id: 'equiv_linear',
    name: '线性等价',
    caseType: 'test',
    stages: [
      { id: 's1', strategy: 'chain', description: '一' },
      { id: 's2', strategy: 'chain', description: '二' },
      { id: 's3', strategy: 'chain', description: '三' },
    ],
  }
  const ctx = { input: '输入' }
  const graph = manifestToGraph(manifest, { executor: okExecutor })
  const gr = await graph.run({ ...ctx })
  expect(gr.completed).toBe(true)
  for (const stage of manifest.stages) {
    expect(gr.state[stage.id]).toBe(await okExecutor(stage, ctx))
  }
})

it('manifestToGraph: retry 回退重跑 extract', async () => {
  const retryManifest: WorkflowManifest = {
    id: 'equiv_retry',
    name: '回退等价',
    caseType: 'test',
    stages: [
      {
        id: 'extract',
        strategy: 'chain',
        description: '提取',
        atom: 'extract',
        params: { extraction_type: '提取技术特征', output_key: 'features' },
      },
      {
        id: 'check',
        strategy: 'chain',
        description: '一致性检查',
        retry: { whenOutputMatches: '不一致', rewindTo: 'extract', maxRetries: 1 },
      },
      { id: 'done', strategy: 'chain', description: '结束' },
    ],
  }
  const grExecutor = makeFlakyExecutor()
  const ctx = { input: '一种装置' }

  const graph = manifestToGraph(retryManifest, {
    handlers: globalStageHandlerRegistry,
    atoms: globalAtomRegistry,
    executor: grExecutor.fn,
    provider,
  })
  const gr = await graph.run({ ...ctx })

  // 回退触发：extract 被重跑两次，check 最终输出 "一致"。
  expect(gr.state.check).toBe('一致')
  expect(grExecutor.calls()).toBe(2)
  expect(gr.state.done).toBe('[done] 完成')
})

/** 第 1 次返回"存在不一致"（触发回退），之后"一致"；记录调用次数。 */
function makeFlakyExecutor(): { fn: (stage: WorkflowStage) => Promise<string>; calls: () => number } {
  const state = { calls: 0 }
  return {
    calls: () => state.calls,
    fn: async (stage: WorkflowStage) => {
      if (stage.id === 'check') {
        state.calls += 1
        return state.calls === 1 ? '存在不一致' : '一致'
      }
      return `[${stage.id}] 完成`
    },
  }
}

it('manifestToGraph: 未知 atom fail-fast', () => {
  const manifest: WorkflowManifest = {
    id: 'bad',
    name: '未知原子',
    caseType: 'test',
    stages: [{ id: 's1', strategy: 'chain', description: '一', atom: 'no-such-atom' }],
  }
  expect(() => manifestToGraph(manifest)).toThrow(/未知 atom/)
})
