import { describe, expect, it } from 'vitest'
import {
  patentDisclosureManifest,
  runWorkflow,
  validateWorkflowManifest,
  type WorkflowManifest,
  type WorkflowStage,
} from '@deepseek-ai/dsh-patent-workflow'
import { globalAtomRegistry, registerBuiltinAtoms } from '@deepseek-ai/dsh-patent-core'

describe('workflow retry validation', () => {
  it('validate: empty or invalid retry.whenOutputMatches is rejected', () => {
    expect(() => {
      validateWorkflowManifest({
        id: 't', name: 't', caseType: 't',
        stages: [{ id: 'a', strategy: 'chain', description: 'a', retry: { whenOutputMatches: '  ' } }],
      }) },
    ).toThrow(/whenOutputMatches 不能为空/)
    expect(() => {
      validateWorkflowManifest({
        id: 't', name: 't', caseType: 't',
        stages: [{ id: 'a', strategy: 'chain', description: 'a', retry: { whenOutputMatches: '(' } }],
      }) },
    ).toThrow(/非法正则/)
  })

  it('validate: rewindTo pointing to missing or self stages is rejected', () => {
    expect(() => {
      validateWorkflowManifest({
        id: 't', name: 't', caseType: 't',
        stages: [
          { id: 'a', strategy: 'chain', description: 'a' },
          { id: 'b', strategy: 'chain', description: 'b', retry: { whenOutputMatches: 'x', rewindTo: 'nope' } },
        ],
      }) },
    ).toThrow(/rewindTo 指向不存在的阶段/)
    expect(() => {
      validateWorkflowManifest({
        id: 't', name: 't', caseType: 't',
        stages: [{ id: 'a', strategy: 'chain', description: 'a', retry: { whenOutputMatches: 'x', rewindTo: 'a' } }],
      }) },
    ).toThrow(/不能指向自身/)
  })

  it('runWorkflow: consistency signal rewinds and re-executes (including intermediate stages)', async () => {
    const manifest: WorkflowManifest = {
      id: 'disclosure_test',
      name: '披露测试',
      caseType: 'disclosure_analysis',
      stages: [
        { id: 'extract', strategy: 'chain', description: '提取特征' },
        { id: 'merge', strategy: 'chain', description: '融合' },
        {
          id: 'consistency',
          strategy: 'chain',
          description: '一致性检查',
          retry: { whenOutputMatches: '不一致|矛盾', rewindTo: 'extract', maxRetries: 1 },
        },
      ],
      validation: { requireAllSteps: true },
    }
    const calls: string[] = []
    const executor = async (stage: WorkflowStage) => {
      calls.push(stage.id)
      if (stage.id === 'extract') return '特征A、特征B'
      if (stage.id === 'merge') return 'PFE 融合完成'
      const extractCalls = calls.filter(c => c === 'extract').length
      return extractCalls < 2 ? '检查发现：特征与效果不一致' : '检查通过：特征-效果因果链闭合'
    }

    const result = await runWorkflow(manifest, { input: '交底书' }, executor)
    expect(result.completed).toBe(true)
    expect(calls.filter(c => c === 'extract')).toHaveLength(2)
    expect(result.stages).toHaveLength(3)
    const consistency = result.stages.find(s => s.stageId === 'consistency')!
    expect(consistency.output).toMatch(/检查通过/)
    expect(consistency.degraded).toBe(false)
    expect(result.degradedSteps).toHaveLength(0)
  })

  it('runWorkflow: exceeding max rewinds keeps the inconsistent output and marks degraded', async () => {
    const manifest: WorkflowManifest = {
      id: 'disclosure_exhaust',
      name: '披露耗尽测试',
      caseType: 'disclosure_analysis',
      stages: [
        { id: 'extract', strategy: 'chain', description: '提取特征' },
        {
          id: 'consistency',
          strategy: 'chain',
          description: '一致性检查',
          retry: { whenOutputMatches: '不一致', rewindTo: 'extract', maxRetries: 1 },
        },
      ],
      validation: { requireAllSteps: true },
    }
    let extractCalls = 0
    const executor = async (stage: WorkflowStage) => {
      if (stage.id === 'extract') { extractCalls += 1; return '特征A' }
      return '检查发现：特征与效果不一致'
    }

    const result = await runWorkflow(manifest, { input: '交底书' }, executor)
    expect(extractCalls).toBe(2)
    const consistency = result.stages.find(s => s.stageId === 'consistency')!
    expect(consistency.degraded).toBe(true)
    expect(consistency.output).toMatch(/\[WORKFLOW_RETRY_EXHAUSTED\]/)
    expect(result.degradedSteps).toContain('consistency')
    expect(result.completed).toBe(false)
  })

  it('runWorkflow: output without a signal advances without rewinding', async () => {
    const manifest: WorkflowManifest = {
      id: 'no_retry',
      name: '无回退测试',
      caseType: 'disclosure_analysis',
      stages: [
        { id: 'a', strategy: 'chain', description: 'a' },
        { id: 'b', strategy: 'chain', description: 'b', retry: { whenOutputMatches: '不一致', rewindTo: 'a' } },
      ],
    }
    let aCalls = 0
    const executor = async (stage: WorkflowStage) => {
      if (stage.id === 'a') { aCalls += 1; return '特征' }
      return '检查通过'
    }
    const result = await runWorkflow(manifest, { input: 'x' }, executor)
    expect(aCalls).toBe(1)
    expect(result.stages).toHaveLength(2)
    expect(result.degradedSteps).toHaveLength(0)
  })

  it('runWorkflow: negated phrasing does not rewind (未发现不一致)', async () => {
    const manifest: WorkflowManifest = {
      id: 'negated_signal',
      name: '否定信号测试',
      caseType: 'disclosure_analysis',
      stages: [
        { id: 'extract', strategy: 'chain', description: '提取特征' },
        {
          id: 'consistency',
          strategy: 'chain',
          description: '一致性检查',
          retry: { whenOutputMatches: '不一致|矛盾|缺少|孤立', rewindTo: 'extract', maxRetries: 1 },
        },
      ],
      validation: { requireAllSteps: true },
    }
    let extractCalls = 0
    const executor = async (stage: WorkflowStage) => {
      if (stage.id === 'extract') { extractCalls += 1; return '特征A' }
      return '检查通过：未发现不一致、矛盾或缺少内容，各要素相互印证'
    }
    const result = await runWorkflow(manifest, { input: '交底书' }, executor)
    expect(extractCalls).toBe(1)
    expect(result.completed).toBe(true)
    expect(result.degradedSteps).toHaveLength(0)
  })

  it('runWorkflow: rewind rolls back stage state (no stale output reused)', async () => {
    const manifest: WorkflowManifest = {
      id: 'state_rollback',
      name: '状态回滚测试',
      caseType: 'disclosure_analysis',
      stages: [
        { id: 'extract', strategy: 'chain', description: '提取特征' },
        {
          id: 'consistency',
          strategy: 'chain',
          description: '一致性检查',
          retry: { whenOutputMatches: '不一致', rewindTo: 'extract', maxRetries: 1 },
        },
      ],
    }
    let round = 0
    const executor = async (stage: WorkflowStage) => {
      if (stage.id === 'extract') { round += 1; return round === 1 ? '旧特征' : '新特征' }
      return round === 1 ? '不一致' : '一致'
    }
    const result = await runWorkflow(manifest, { input: 'x' }, executor)
    const extract = result.stages.find(s => s.stageId === 'extract')!
    expect(extract.output).toBe('新特征')
    const consistency = result.stages.find(s => s.stageId === 'consistency')!
    expect(consistency.output).toBe('一致')
    expect(result.degradedSteps).toHaveLength(0)
  })

  it('validate: rewindTo pointing to a later stage is rejected', () => {
    expect(() => {
      validateWorkflowManifest({
        id: 't', name: 't', caseType: 't',
        stages: [
          { id: 'a', strategy: 'chain', description: 'a' },
          { id: 'b', strategy: 'chain', description: 'b', retry: { whenOutputMatches: 'x', rewindTo: 'c' } },
          { id: 'c', strategy: 'chain', description: 'c' },
        ],
      }) },
    ).toThrow(/rewindTo 指向不存在的阶段/)
  })

  it('patentDisclosureManifest: structure and retry declarations are valid', () => {
    expect(() => { validateWorkflowManifest(patentDisclosureManifest) }).not.toThrow()
    expect(patentDisclosureManifest.id).toBe('patent_disclosure_v1')
    expect(patentDisclosureManifest.stages).toHaveLength(13)
    const consistency = patentDisclosureManifest.stages.find(s => s.id === 'consistency')!
    expect(consistency.retry?.rewindTo).toBe('extract_problem')
    expect(consistency.retry!.whenOutputMatches).toMatch(/不一致\|矛盾\|缺少\|孤立/)
    const atoms = patentDisclosureManifest.stages.filter(s => s.atom !== undefined).map(s => s.atom)
    expect([...new Set(atoms)].sort()).toEqual([
      'approval-gate', 'draft-claims', 'extract', 'groundedness', 'keywords', 'merge', 'novelty', 'search',
    ])
    const extractStages = patentDisclosureManifest.stages.filter(s => s.id.startsWith('extract_'))
    expect(extractStages).toHaveLength(3)
    expect(extractStages.map(s => s.params?.output_key).sort()).toEqual(['effects', 'features', 'problems'])
    const ids = patentDisclosureManifest.stages.map(s => s.id)
    expect(ids.indexOf('extract_effects') < ids.indexOf('merge')).toBe(true)
    expect(ids.indexOf('report') < ids.indexOf('review_gate')).toBe(true)
    expect(ids.indexOf('review_gate') < ids.indexOf('draft_claims')).toBe(true)
    expect(patentDisclosureManifest.stages.find(s => s.id === 'review_gate')?.atom).toBe('approval-gate')
    expect(patentDisclosureManifest.stages.find(s => s.id === 'draft_claims')?.atom).toBe('draft-claims')
    expect(ids.indexOf('generate_keywords') < ids.indexOf('search')).toBe(true)
    expect(ids.indexOf('search') < ids.indexOf('novelty')).toBe(true)
    expect(ids.indexOf('novelty') < ids.indexOf('report')).toBe(true)
  })

  it('patentDisclosureManifest: declared atoms exist after builtin registration', () => {
    registerBuiltinAtoms()
    expect(() => {
      validateWorkflowManifest(patentDisclosureManifest, {
        atomNames: new Set(globalAtomRegistry.list().map(a => a.name)),
      }) },
    ).not.toThrow()
  })
})
