/**
 * src/adversary/assessment — 独立证据评估。
 *
 * 从对立视角评估 response-plan 中每条策略的证据支撑强度。这是五步处理流程的第二步：
 * 独立证据评估。
 *
 * 当前实现为简化版本（确定性骨架）：
 * - 检查 response-plan 是否覆盖了通知书的全部驳回理由
 * - 对每条策略检查其 claims 字段是否与 affectedClaims 有交集
 * - 未覆盖的理由或无交集的策略标记为分歧
 *
 * TODO：完整版应调用模型（通过 StageProvider.llm）对每条策略做独立证据评估，
 * 从对立视角判断证据支撑强度、论证逻辑是否充分。当前版本只做覆盖率检查。
 */

import type { AdversaryDispute, AdversaryOfficeAction, AdversaryPlanEntry } from './types.ts'
import { GROUND_TO_STATUTE } from './types.ts'

/**
 * 从对立视角评估答复计划的证据支撑强度（简化版）。
 *
 * 检查维度：
 * 1. 覆盖率：response-plan 是否覆盖了通知书的全部驳回理由
 * 2. 权项对齐：每条策略的 claims 是否与 affectedClaims 有交集
 *
 * @param officeAction - 通知书结构化字段。
 * @param responsePlan - 答复计划条目列表。
 * @returns 评估结果：未覆盖或权项不对齐的争议点（relation = 'disagreement'）。
 */
export function assessEvidenceIndependent(
  officeAction: AdversaryOfficeAction | undefined,
  responsePlan: AdversaryPlanEntry[] | undefined,
): AdversaryDispute[] {
  if (officeAction === undefined || responsePlan === undefined || responsePlan.length === 0) {
    return []
  }

  const disputes: AdversaryDispute[] = []
  const rejectionTypes = officeAction.rejectionTypes ?? []
  const affectedClaims = officeAction.affectedClaims ?? []

  // 收集 response-plan 覆盖的驳回理由
  const coveredGrounds = new Set(responsePlan.map(entry => entry.ground))

  // 检查每个驳回理由是否被覆盖
  for (const ground of rejectionTypes) {
    if (typeof ground !== 'string') continue
    if (!coveredGrounds.has(ground)) {
      const statute = GROUND_TO_STATUTE.get(ground)
      if (statute !== undefined) {
        disputes.push({
          statute,
          claims: affectedClaims.length > 0 ? [...affectedClaims] : [],
          point: `答复计划未覆盖驳回理由 ${ground}，存在遗漏风险`,
          relation: 'disagreement',
          divergenceReason: `答复计划未覆盖驳回理由 ${ground}`,
          confidence: 0.9,
          tag: 'heuristic',
        })
      }
    }
  }

  // 检查每条策略的权项是否与 affectedClaims 有交集
  for (const entry of responsePlan) {
    const entryClaims = entry.claims ?? []
    if (entryClaims.length === 0 || affectedClaims.length === 0) continue

    const hasIntersection = entryClaims.some(claim => affectedClaims.includes(claim))
    if (!hasIntersection) {
      const statute = GROUND_TO_STATUTE.get(entry.ground)
      if (statute !== undefined) {
        disputes.push({
          statute,
          claims: entryClaims,
          point: `策略 ${entry.strategy}（理由 ${entry.ground}）的权项 ${entryClaims.join(', ')} 与通知书 affectedClaims ${affectedClaims.join(', ')} 无交集`,
          relation: 'disagreement',
          divergenceReason: '策略权项与通知书涉及权项不对齐',
          confidence: 0.7,
          tag: 'heuristic',
        })
      }
    }
  }

  return disputes
}
