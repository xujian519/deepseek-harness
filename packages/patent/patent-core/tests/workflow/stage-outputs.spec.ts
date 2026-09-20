import { describe, expect, it } from 'vitest'
import { AtomRegistry, clearStageOutputs, type WorkflowStage } from '@deepseek-ai/dsh-patent-core'

/**
 * 回退清理原语的直接单测。
 *
 * 存在的理由：这条语义被两处消费——声明式执行器（runWorkflow 的 retry 回退）与
 * 图适配器（manifestToGraph 的 retry 条件边 router）。两处原先各写一份
 * `Reflect.deleteProperty` 循环时都只删 stage-id 键，把语义钉在这里比只测两侧集成
 * 更能定位回归。
 */

/** 构造含多输出键 atom（extract）与零输出键 atom（reasoning）的注册表。 */
function makeAtoms(): AtomRegistry {
  const registry = new AtomRegistry()
  registry.register({
    name: 'extract',
    description: '提取',
    category: 'extract',
    inputSchema: ['text'],
    outputSchema: ['features', 'problems', 'effects'],
  })
  registry.register({
    name: 'reasoning',
    description: '推理',
    category: 'reason',
    inputSchema: [],
    outputSchema: [],
  })
  return registry
}

describe('clearStageOutputs', () => {
  it('删 stage-id 键 + 该 atom 的 outputSchema 全部键（不只 stage-id）', () => {
    const atoms = makeAtoms()
    const stages: WorkflowStage[] = [
      { id: 'extract_features', strategy: 'chain', description: '提取', atom: 'extract' },
      { id: 'check', strategy: 'chain', description: '检查', atom: 'reasoning' },
    ]
    const state: Record<string, unknown> = {
      input: '交底书',
      extract_features: '旧输出',
      features: ['旧特征'],
      problems: ['旧问题'],
      effects: ['旧效果'],
      check: '旧一致性',
    }
    clearStageOutputs({ state, stages, atoms })
    expect(state).toEqual({ input: '交底书' })
  })

  it('无 atom 阶段只删 stage-id 键；范围之外的阶段不受影响', () => {
    const atoms = makeAtoms()
    const stages: WorkflowStage[] = [
      { id: 'preprocess', strategy: 'chain', description: '预处理' },
      { id: 'extract_features', strategy: 'chain', description: '提取', atom: 'extract' },
    ]
    const state: Record<string, unknown> = {
      preprocess: '旧预处理',
      extract_features: '旧输出',
      features: ['旧特征'],
      report: '后续阶段输出（不在清理范围内）',
    }
    clearStageOutputs({ state, stages: [stages[0]!], atoms })
    expect(state).toEqual({
      extract_features: '旧输出',
      features: ['旧特征'],
      report: '后续阶段输出（不在清理范围内）',
    })
  })

  it('atom 未注册时不抛错（只清 stage-id 键）', () => {
    const atoms = makeAtoms()
    const state: Record<string, unknown> = { ghost: '输出', features: ['不该删'] }
    clearStageOutputs({
      state,
      stages: [{ id: 'ghost', strategy: 'chain', description: '未注册原子', atom: 'no-such-atom' }],
      atoms,
    })
    expect(state).toEqual({ features: ['不该删'] })
  })
})
