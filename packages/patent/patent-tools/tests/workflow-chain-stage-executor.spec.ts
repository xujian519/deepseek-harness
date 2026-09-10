import { describe, expect, it } from 'vitest'
import type { StageProvider, WorkflowContext, WorkflowStage } from '@deepseek-ai/dsh-patent-core'
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
    )
    expect(output).toBe('ok')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('撰写意见陈述书')
    expect(prompts[0]).toContain('```\n交底书正文\n```')
  })

  it('有 guidance 时指引插入阶段描述与材料之间', async () => {
    const { provider, prompts } = captureProvider()
    await createChainStageExecutor(provider, 'patent_workflow_run')(
      stage({ guidance: '驳回类型解析表：A-充分公开…' }),
      ctx('交底书正文'),
    )
    expect(prompts[0]).toContain('撰写意见陈述书\n驳回类型解析表：A-充分公开…\n```')
  })
})
