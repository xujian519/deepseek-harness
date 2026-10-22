import { describe, expect, it } from 'vitest'
import {
  AtomRegistry,
  ExtractHandler,
  StageHandlerRegistry,
  extractAtom,
  type StageProvider,
  type WorkflowManifest,
} from '@deepseek-ai/dsh-patent-core'
import { runWorkflow } from '@deepseek-ai/dsh-patent-workflow'
import { LegalGapsHandler, legalGapsAtom } from '../src/atoms/legal-gaps.ts'

/** Novelty 清单里所有未评估项的 checkId；反哺提取必须逐项回报。 */
const NOVELTY_TARGETS = ['time-baseline', 'grace-period', 'conflicting-application', 'novelty']

/**
 * 记录每次提取的提示词，并在反哺轮次返回逐项覆盖。
 * @returns provider 与调用记录。
 */
function feedbackProvider(): { provider: StageProvider; prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    provider: {
      callLLM: async (prompt) => {
        prompts.push(prompt)
        if (!prompt.includes('规则缺口反哺')) {
          return JSON.stringify({ features: ['第一轮特征'] })
        }
        return JSON.stringify({
          features: ['第二轮特征'],
          revision_coverage: Object.fromEntries(NOVELTY_TARGETS.map(id => [id, [`支持 ${id} 的事实`]])),
        })
      },
    },
  }
}

describe('legal-gaps 反哺采集回路', () => {
  it('未评估项回退到 extract，二次提取按清单覆盖，达到上限后停止', async () => {
    const manifest: WorkflowManifest = {
      id: 'feedback_loop',
      name: '反哺回路测试',
      caseType: 'novelty_search',
      stages: [
        {
          id: 'extract',
          strategy: 'chain',
          description: '提取技术特征',
          atom: 'extract',
          params: { output_key: 'features' },
        },
        {
          id: 'legal_gaps',
          strategy: 'chain',
          description: '法条缺口汇总',
          atom: 'legal-gaps',
          params: { profile: 'novelty' },
          retry: { whenRevisionRequested: true, rewindTo: 'extract', maxRetries: 1 },
        },
      ],
    }
    const atoms = new AtomRegistry()
    atoms.register(extractAtom)
    atoms.register(legalGapsAtom)
    const handlers = new StageHandlerRegistry()
    handlers.register(new ExtractHandler())
    let gapRounds = 0
    const gapHandler = new LegalGapsHandler()
    handlers.register({
      name: 'legal-gaps',
      category: 'gate',
      execute: async (input) => {
        gapRounds += 1
        return gapHandler.execute(input)
      },
    })
    const { provider, prompts } = feedbackProvider()

    const result = await runWorkflow(manifest, { input: '一种装置', text: '一种装置' }, undefined, {
      atoms,
      handlers,
      provider,
    })

    expect(prompts).toHaveLength(2)
    expect(prompts[0]).not.toContain('规则缺口反哺')
    expect(prompts[1]).toContain('[time-baseline]')
    expect(prompts[1]).toContain('revision_coverage')
    expect(gapRounds).toBe(2)
    expect(result.stages.find(stage => stage.stageId === 'extract')?.output).toContain('第二轮特征')
    // 每条未评估项一条记录：第一轮 4 条实际回退，第二轮 4 条耗尽并停止。
    expect(result.revisions?.map(record => record.outcome)).toEqual([
      'applied', 'applied', 'applied', 'applied',
      'exhausted', 'exhausted', 'exhausted', 'exhausted',
    ])
    expect(result.revisions?.filter(record => record.round === 1)).toHaveLength(4)
    expect(result.revisions?.filter(record => record.round === 2)).toHaveLength(4)
    // 结构化信号耗尽时保留 legal-gaps 原产出，不把常规未评估项判成降级。
    const gaps = result.stages.find(stage => stage.stageId === 'legal_gaps')
    expect(gaps?.degraded).toBe(false)
    expect(gaps?.output).toContain('法条缺口汇总')
    // 覆盖结果有消费方：仍未覆盖的条目在证据里标明上一轮补提过多少条事实。
    expect(gaps?.output).toContain('反哺轮次补提 1 条事实后仍未覆盖')
    expect(result.completed).toBe(true)
  })

  it('第二轮漏写 revision_coverage 时保留已抽取特征，不降级', async () => {
    const manifest: WorkflowManifest = {
      id: 'feedback_missing_coverage',
      name: '反哺缺覆盖测试',
      caseType: 'novelty_search',
      stages: [
        { id: 'extract', strategy: 'chain', description: '提取技术特征', atom: 'extract', params: { output_key: 'features' } },
        {
          id: 'legal_gaps',
          strategy: 'chain',
          description: '法条缺口汇总',
          atom: 'legal-gaps',
          params: { profile: 'novelty' },
          retry: { whenRevisionRequested: true, rewindTo: 'extract', maxRetries: 1 },
        },
      ],
    }
    const atoms = new AtomRegistry()
    atoms.register(extractAtom)
    atoms.register(legalGapsAtom)
    const handlers = new StageHandlerRegistry()
    handlers.register(new ExtractHandler())
    handlers.register(new LegalGapsHandler())
    let calls = 0
    const provider: StageProvider = {
      callLLM: async (prompt) => {
        calls += 1
        // 第二轮故意只返回 features，不返回 revision_coverage。
        return prompt.includes('规则缺口反哺')
          ? JSON.stringify({ features: ['第二轮补提特征'] })
          : JSON.stringify({ features: ['第一轮特征'] })
      },
    }

    const result = await runWorkflow(manifest, { input: '一种装置', text: '一种装置' }, undefined, {
      atoms,
      handlers,
      provider,
    })

    expect(calls).toBe(2)
    expect(result.stages.find(stage => stage.stageId === 'extract')?.output).toContain('第二轮补提特征')
    expect(result.stages.find(stage => stage.stageId === 'extract')?.degraded).toBe(false)
    expect(result.completed).toBe(true)
    // 第二轮缺口仍在：结构化信号耗尽只记录，不把阶段标记为降级。
    expect(result.revisions?.some(record => record.outcome === 'exhausted')).toBe(true)
  })
})
