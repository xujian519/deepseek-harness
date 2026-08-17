import { describe, expect, it } from 'vitest'
import { addStage, confirmStage, createFlexiblePlan, runWorkflow, toManifest } from '@deepseek-ai/dsh-patent-workflow'
import { registerBuiltinAtoms, type StageProvider } from '@deepseek-ai/dsh-patent-core'

const provider: StageProvider = {
  callLLM: async () => JSON.stringify({ features: ['双层真空结构'], problems: ['保温不足'], effects: ['长保温'] }),
}

function stage(id: string, name: string, goal: string, extra: Partial<{ atom: string; strategy: 'chain' | 'react' | 'sub_agent'; params: Record<string, unknown> }> = {}) {
  return { id, name, goal, strategy: (extra.strategy ?? 'sub_agent') as 'chain' | 'react' | 'sub_agent', status: 'pending' as const, artifacts: [], constraintIds: [], articleJudgments: [], ...extra }
}

describe('flexible-plan → toManifest → runWorkflow (atomic execution)', () => {
  it('an extract stage is atomically executed through runWorkflow', async () => {
    registerBuiltinAtoms()
    let plan = createFlexiblePlan('demo-1', 'disclosure_analysis')
    plan = addStage(plan, stage('extract_features', '提取技术特征', '从交底书提取技术特征', { atom: 'extract', params: { extraction_type: '提取技术特征', output_key: 'features' } }))
    plan = addStage(plan, stage('report', '撰写报告', '汇总披露分析报告', { strategy: 'chain' }))

    const manifest = toManifest(plan)
    expect(manifest.id).toBe('flexible_demo-1')
    expect(manifest.stages).toHaveLength(2)
    expect(manifest.stages[0]!.atom).toBe('extract')

    const executor = async (): Promise<string> => '透传输入'
    const result = await runWorkflow(manifest, { text: '交底书原文' }, executor, { provider })

    const extractStage = result.stages.find(s => s.stageId === 'extract_features')
    expect(extractStage).toBeDefined()
    expect(extractStage!.degraded).toBe(false)
    expect(extractStage!.output).toMatch(/双层真空结构/)
    const reportStage = result.stages.find(s => s.stageId === 'report')
    expect(reportStage?.degraded).toBe(false)
  })

  it('execution results flow back through confirmStage: confirmed stages leave the next manifest', async () => {
    registerBuiltinAtoms()
    let plan = createFlexiblePlan('demo-2', 'disclosure_analysis')
    plan = addStage(plan, stage('extract_problem', '提取技术问题', '提取待解决的技术问题', { atom: 'extract', params: { extraction_type: '提取待解决的技术问题', output_key: 'problems' } }))
    plan = addStage(plan, stage('novelty_check', '新颖性初判', '逐特征新颖性初判', { atom: 'novelty', strategy: 'chain' }))

    const firstManifest = toManifest(plan)
    const first = await runWorkflow(firstManifest, { text: '交底书' }, async () => '', { provider })
    expect(first.stages.find(s => s.stageId === 'extract_problem')?.degraded).toBe(false)

    plan = confirmStage(plan, 'extract_problem')
    const secondManifest = toManifest(plan)
    expect(secondManifest.stages.map(s => s.id)).toEqual(['novelty_check'])

    const second = await runWorkflow(secondManifest, { text: '交底书', features: ['特征A'] }, async () => '', { provider })
    const noveltyStage = second.stages.find(s => s.stageId === 'novelty_check')
    expect(noveltyStage).toBeDefined()
  })
})
