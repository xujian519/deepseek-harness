/**
 * 阶段回退清理原语：删除被回退阶段的 stage-id 键与其 atom 声明的 `outputSchema` 全部键。
 *
 * 声明式执行器（dsh-patent-workflow 的 runWorkflow）与图适配器
 * （graph/adapter.ts 的 retry 回退 router）共用这一条回退语义，故落在 patent-core。
 */

import type { AtomRegistry } from '../atoms/atom.ts'
import type { PipelineState } from '../atoms/handler.ts'
import type { WorkflowStage } from './types.ts'

/** clearStageOutputs 的调用参数。 */
export type ClearStageOutputsOptions = {
  /** 待原地清理的共享 state（调用方持有）。 */
  state: PipelineState
  /** 待清理的阶段集合——范围由调用方决定（回退起点至当前阶段）。 */
  stages: readonly WorkflowStage[]
  /** Atom 注册表，用于解析每个阶段写入的 outputSchema 键。 */
  atoms: AtomRegistry
}

/**
 * 回退清理：删除被回退阶段的 stage-id 键与其 atom 的 `outputSchema` 全部键。
 *
 * 只删 stage-id 键是不够的——重跑中某路解析失败（如 extract 返回非 JSON 时保留原文）
 * 会残留旧一代数组，下游 merge 混用两代提取结果且无降级告警。
 * @param options - 清理参数（共享 state / 阶段集合 / Atom 注册表）。
 */
export function clearStageOutputs(options: ClearStageOutputsOptions): void {
  const { state, stages, atoms } = options
  for (const stage of stages) {
    // 动态键删除走 Reflect.deleteProperty：oxlint no-dynamic-delete 拒绝 `delete state[k]`。
    Reflect.deleteProperty(state, stage.id)
    const atomName = stage.atom
    if (atomName === undefined) continue
    for (const key of atoms.lookup(atomName)?.outputSchema ?? []) {
      Reflect.deleteProperty(state, key)
    }
  }
}
