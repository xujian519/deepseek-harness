import { describe, expect, it } from 'vitest'
import type { PipelineState, StageProvider, WorkflowContext, WorkflowStage } from '@deepseek-ai/dsh-patent-core'
import { createChainStageExecutor } from '../src/tool/internal/workflow-helpers.ts'

const stage = (overrides: Partial<WorkflowStage> = {}): WorkflowStage => ({
  id: 'draft',
  strategy: 'chain',
  description: '撰写意见陈述书',
  ...overrides,
})

const ctx = (input: string): WorkflowContext => ({ input })

function captureProvider(): { provider: StageProvider; prompts: string[] } {
  const prompts: string[] = []
  const provider: StageProvider = {
    callLLM: async (prompt) => {
      prompts.push(prompt)
      return 'ok'
    },
  }
  return { provider, prompts }
}

describe('createChainStageExecutor', () => {
  it('无 guidance 时提示词只含角色、阶段描述与材料', async () => {
    const { provider, prompts } = captureProvider()
    const output = await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage(),
      ctx('交底书正文'),
      {},
    )
    expect(output).toBe('ok')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('撰写意见陈述书')
    expect(prompts[0]).toContain('<data>\n"交底书正文"\n</data>')
  })

  it('有 guidance 时指引插入阶段描述与材料之间', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage({ guidance: '驳回类型解析表：A-充分公开…' }),
      ctx('交底书正文'),
      {},
    )
    expect(prompts[0]).toContain('撰写意见陈述书\n驳回类型解析表：A-充分公开…\n<data>')
  })

  it('consumes 声明的上游产出按声明顺序注入', async () => {
    const { provider, prompts } = captureProvider()
    const state: PipelineState = { closest: 'D1 选定理由', diff: '区别特征清单', hint: '不应出现' }
    await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage({ consumes: ['diff', 'closest'] }),
      ctx('交底书正文'),
      state,
    )
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain('## 上游阶段产出: diff\n<data>\n"区别特征清单"\n</data>')
    expect(prompt).toContain('## 上游阶段产出: closest\n<data>\n"D1 选定理由"\n</data>')
    expect(prompt.indexOf('上游阶段产出: diff')).toBeLessThan(prompt.indexOf('上游阶段产出: closest'))
    expect(prompt).not.toContain('不应出现')
  })

  it('consumes 声明的阶段无产出时给出显式标记', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage({ consumes: ['closest'] }),
      ctx('交底书正文'),
      { closest: '   ' },
    )
    expect(prompts[0]).toContain('## 上游阶段产出: closest\n（该阶段无产出）')
  })

  it('consumes 声明的上游产出超长时截断并标注', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage({ consumes: ['closest'] }),
      ctx('交底书正文'),
      { closest: '长'.repeat(4001) },
    )
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain(`"${'长'.repeat(4000)}\\n（截断，完整内容见 run 记录）"`)
    expect(prompt).not.toContain('长'.repeat(4001))
  })

  it('材料超长时同样截断并标注', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(stage(), ctx('文'.repeat(12001)), {})
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain(`"${'文'.repeat(12000)}\\n（截断，完整内容见 run 记录）"`)
    expect(prompt).not.toContain('文'.repeat(12001))
  })

  it('提供 claims 时单独注入权利要求书块', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage(),
      ctx('通知书正文'),
      { claims: '1. 一种装置，其特征在于…' },
    )
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain('## 权利要求书（本次调用的 claims 参数）\n<data>\n"1. 一种装置，其特征在于…"\n</data>')
  })

  it('未提供 claims 时不注入权利要求书块', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(stage(), ctx('通知书正文'), {})
    expect(prompts[0]).not.toContain('权利要求书（本次调用的 claims 参数）')
  })
})
