/**
 * src/adversary/divergence — 分歧检测。
 *
 * 这是五步处理流程的第四步：分歧检测。比对 adversary 独立识别的争议点 vs response-plan
 * 覆盖的理由，标记三类关系：
 * - agreement：adversary 与基线一致（同一法条被双方识别）
 * - disagreement：adversary 与基线存在分歧（如权项不对齐）
 * - missed_by_baseline：基线未覆盖的争议点
 *
 * 设计原则：
 * - 确定性内核：比对 (statute, claims) 对，不需要模型
 * - 以法条为键：同一法条的争议点合并，权项取并集
 */

import type { AdversaryDispute, AdversaryPlanEntry } from './types.ts'
import { GROUND_TO_STATUTE } from './types.ts'

/**
 * 比对独立识别的争议点与基线答复计划，标记关系。
 *
 * 算法：
 * 1. 从 response-plan 收集覆盖的法条集合（ground → statute）
 * 2. 对每个 adversary 争议点：
 *    - 若其 statute 在基线覆盖集合中 → agreement
 *    - 若其 relation 已是 'disagreement'（来自证据评估） → 保持 disagreement
 *    - 否则 → missed_by_baseline
 *
 * @param adversaryDisputes - 独立识别的争议点（来自 dispute.ts + assessment.ts）。
 * @param responsePlan - 基线答复计划条目。
 * @returns 标记好关系的争议点列表。
 */
export function detectDivergence(
  adversaryDisputes: AdversaryDispute[],
  responsePlan: AdversaryPlanEntry[] | undefined,
): AdversaryDispute[] {
  // 收集基线覆盖的法条
  const baselineStatutes = new Set<string>()
  if (responsePlan !== undefined) {
    for (const entry of responsePlan) {
      const statute = GROUND_TO_STATUTE.get(entry.ground)
      if (statute !== undefined) {
        baselineStatutes.add(statute)
      }
    }
  }

  // 标记关系
  return adversaryDisputes.map((dispute) => {
    // 已被证据评估标记为 disagreement 的保持不变
    if (dispute.relation === 'disagreement') {
      return dispute
    }

    // 检查是否在基线覆盖范围内
    if (baselineStatutes.has(dispute.statute)) {
      return { ...dispute, relation: 'agreement' as const }
    }

    // 基线未覆盖
    return { ...dispute, relation: 'missed_by_baseline' as const }
  })
}

/**
 * 计算整体置信度。
 *
 * 算法：加权平均，权重为各争议点的 confidence。无争议点时返回 0。
 *
 * @param disputes - 标记好关系的争议点列表。
 * @returns 整体置信度 [0,1]。
 */
export function computeOverallConfidence(disputes: AdversaryDispute[]): number {
  if (disputes.length === 0) return 0

  const totalWeight = disputes.reduce((sum, d) => sum + d.confidence, 0)
  const weightedSum = disputes.reduce((sum, d) => sum + d.confidence * d.confidence, 0)

  // 加权平均：sum(c^2) / sum(c)
  return totalWeight > 0 ? weightedSum / totalWeight : 0
}
