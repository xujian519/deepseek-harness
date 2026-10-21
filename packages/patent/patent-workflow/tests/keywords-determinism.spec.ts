import { expect, it } from 'vitest'
import { registerBuiltinAtoms, type StageProvider, type WorkflowManifest } from '@deepseek-ai/dsh-patent-core'
import { runWorkflow } from '@deepseek-ai/dsh-patent-workflow'

registerBuiltinAtoms()

/**
 * 两路 extract 连续同原子 → merge → keywords：默认并行窗口会在并行时删除
 * `extraction_result` 主键，串行时保留最后一次抽取的原文。keywords 必须以
 * PFIE 融合结果为输入，两种并行度下提示词才会一致。
 */
const manifest: WorkflowManifest = {
  id: 'keywords-pfie-determinism',
  name: 'keywords PFIE 输入一致性',
  caseType: 'test',
  stages: [
    {
      id: 'extract_features',
      strategy: 'chain',
      description: '技术特征抽取',
      atom: 'extract',
      params: { output_key: 'features', extraction_type: '技术特征抽取' },
    },
    {
      id: 'extract_problems',
      strategy: 'chain',
      description: '技术问题抽取',
      atom: 'extract',
      params: { output_key: 'problems', extraction_type: '技术问题抽取' },
    },
    { id: 'merge', strategy: 'chain', description: 'PFIE 融合', atom: 'merge' },
    { id: 'generate_keywords', strategy: 'chain', description: '生成检索关键词', atom: 'keywords' },
  ],
}

/** 按抽取任务应答，并捕获 keywords 的提示词。 */
function captureProvider(keywordsPrompts: string[]): StageProvider {
  return {
    callLLM: async (prompt) => {
      if (prompt.includes('任务：技术特征抽取')) {
        return JSON.stringify({ features: ['传送带', '识别传感器'] })
      }
      if (prompt.includes('任务：技术问题抽取')) {
        return JSON.stringify({ problems: ['如何自动分拣'] })
      }
      if (prompt.includes('专利检索关键词生成助手')) {
        keywordsPrompts.push(prompt)
        return JSON.stringify({ keywords: ['分拣', '传感器'] })
      }
      return '{}'
    },
  }
}

it('keywords 提示词不随 maxParallelStages 变化，且使用 PFIE 融合结果', async () => {
  const keywordsPrompts: string[] = []
  const provider = captureProvider(keywordsPrompts)

  for (const maxParallelStages of [1, 4]) {
    const result = await runWorkflow(
      manifest,
      { text: '一种分拣装置，包括传送带与识别传感器' },
      undefined,
      { provider, maxParallelStages },
    )
    expect(result.completed, `maxParallelStages=${maxParallelStages}`).toBe(true)
  }

  expect(keywordsPrompts).toHaveLength(2)
  expect(keywordsPrompts[0]).toBe(keywordsPrompts[1])
  const prompt = keywordsPrompts[0]!
  expect(prompt).toContain('【PFIE 分析结果】')
  expect(prompt).toContain('问题：如何自动分拣')
  expect(prompt).toContain('特征：传送带；识别传感器')
  expect(prompt).not.toContain('一种分拣装置')
})
