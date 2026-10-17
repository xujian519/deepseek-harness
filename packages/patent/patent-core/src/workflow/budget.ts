/**
 * src/patent/workflow — 单个 manifest 的阶段预算校验。
 *
 * 预算只约束规模，不改变执行语义：加载期超限即抛 WorkflowError，避免新增阶段
 * 在部署中悄悄放大调用成本。
 */

import type { AtomRegistry } from '../atoms/index.ts'
import { WorkflowError, type WorkflowManifest } from './types.ts'

/** 单个 manifest 的阶段数上限。 */
export type WorkflowStageBudget = {
  /** 允许的最大阶段数。 */
  maxStages: number
  /** 允许的最大模型调用阶段数。 */
  maxLlmStages: number
}

/** 预算校验所需的原子契约查询面。 */
type AtomLookup = Pick<AtomRegistry, 'lookup'>

/**
 * 统计会调用模型的阶段数。
 *
 * 未声明 atom 的阶段由调用方 executor 执行，本仓库的 executor 会发起模型调用；
 * 声明 atom 的阶段只在原子契约标记 `usesModel` 时计入。
 * @param manifest - 待统计的工作流 manifest。
 * @param atoms - 原子契约注册表。
 * @returns 模型调用阶段数。
 * @throws WorkflowError 当阶段声明了未注册的 atom 时（无法判定其是否调用模型）。
 */
export function countWorkflowLlmStages(manifest: WorkflowManifest, atoms: AtomLookup): number {
  let count = 0
  for (const stage of manifest.stages) {
    if (stage.atom === undefined) {
      count += 1
      continue
    }
    const atom = atoms.lookup(stage.atom)
    if (atom === undefined) {
      throw new WorkflowError(`阶段 ${stage.id} 声明了未知 atom: ${stage.atom}（无法计入阶段预算）`)
    }
    if (atom.usesModel === true) count += 1
  }
  return count
}

/**
 * 校验 manifest 未超出阶段预算。
 * @param manifest - 待校验的工作流 manifest。
 * @param budget - 阶段数与模型调用阶段数上限。
 * @param atoms - 原子契约注册表。
 * @throws WorkflowError 当预算非法、声明未知 atom 或任一上限被超出时。
 */
export function validateWorkflowBudget(
  manifest: WorkflowManifest,
  budget: WorkflowStageBudget,
  atoms: AtomLookup,
): void {
  if (!Number.isFinite(budget.maxStages) || budget.maxStages < 1) {
    throw new WorkflowError('阶段预算 maxStages 必须为有限正数')
  }
  if (!Number.isFinite(budget.maxLlmStages) || budget.maxLlmStages < 1) {
    throw new WorkflowError('阶段预算 maxLlmStages 必须为有限正数')
  }
  if (manifest.stages.length > budget.maxStages) {
    throw new WorkflowError(
      `manifest ${manifest.id} 的阶段数 ${manifest.stages.length} 超出预算 ${budget.maxStages}`,
    )
  }
  const llmStages = countWorkflowLlmStages(manifest, atoms)
  if (llmStages > budget.maxLlmStages) {
    throw new WorkflowError(
      `manifest ${manifest.id} 的模型调用阶段数 ${llmStages} 超出预算 ${budget.maxLlmStages}`,
    )
  }
}
