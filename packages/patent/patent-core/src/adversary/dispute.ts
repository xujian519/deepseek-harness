/**
 * src/adversary/dispute — 独立争议定位。
 *
 * 从 OA 通知书原文独立识别争议法条与涉及权项，不参考 dispute-framing 产出。
 * 这是五步处理流程的第一步：独立争议定位。
 *
 * 设计原则：
 * - 纯确定性：不调用模型，只从结构化字段（rejectionTypes、affectedClaims）与正文扫描
 * - 信息隔离：只读 office_action 与 claims，不读 dispute_framing_candidates 等己方产出
 * - 保守识别：宁可漏报不误报，无法规范化到已知法条的驳回类型记为 unverified
 */

import { scanClaimNumbers, scanDisputeText } from '../atoms/handlers/builtin/dispute-framing.ts'
import { GROUND_TO_STATUTE, type AdversaryDispute, type AdversaryOfficeAction } from './types.ts'

/**
 * 从通知书结构化字段独立识别争议法条。
 *
 * 优先使用 rejectionTypes → 法条编号映射；无法映射的类型记为 unverified。
 * affectedClaims 直接作为涉及权项；缺失时从正文扫描。
 *
 * @param officeAction - 通知书结构化字段。
 * @param claimsText - 权利要求书正文（用于权项号扫描回退）。
 * @returns 独立识别的争议点列表（relation 全部为 'missed_by_baseline'，待后续步骤比对）。
 */
export function locateDisputesIndependent(
  officeAction: AdversaryOfficeAction | undefined,
  claimsText: string,
): AdversaryDispute[] {
  if (officeAction === undefined) {
    // 无通知书：从权利要求书正文扫描法条候选，全部标记为 unverified
    const { statutes, claims } = scanDisputeText(claimsText)
    return statutes.map(statute => ({
      statute,
      claims: claims.length > 0 ? claims : scanClaimNumbers(claimsText),
      point: `正文提及法条 ${statute}，但缺少通知书结构化字段，无法确认争议要点`,
      relation: 'missed_by_baseline' as const,
      confidence: 0.3,
      tag: 'unverified' as const,
    }))
  }

  const disputes: AdversaryDispute[] = []
  const rejectionTypes = officeAction.rejectionTypes ?? []
  const affectedClaims = officeAction.affectedClaims ?? []

  // 从 rejectionTypes 独立识别法条
  const seenStatutes = new Set<string>()
  for (const ground of rejectionTypes) {
    if (typeof ground !== 'string') continue
    const statute = GROUND_TO_STATUTE.get(ground)
    if (statute === undefined || seenStatutes.has(statute)) continue
    seenStatutes.add(statute)
    disputes.push({
      statute,
      claims: affectedClaims.length > 0 ? [...affectedClaims] : scanClaimNumbers(claimsText),
      point: `通知书驳回理由 ${ground} 对应法条 ${statute}`,
      relation: 'missed_by_baseline', // 初始全部标记为 missed_by_baseline，待分歧检测修正
      confidence: 0.8,
      tag: 'heuristic',
    })
  }

  // 从正文补充扫描（捕获 rejectionTypes 未列明的法条）
  const { statutes: textStatutes } = scanDisputeText(claimsText)
  for (const statute of textStatutes) {
    if (seenStatutes.has(statute)) continue
    seenStatutes.add(statute)
    disputes.push({
      statute,
      claims: affectedClaims.length > 0 ? [...affectedClaims] : scanClaimNumbers(claimsText),
      point: `正文提及法条 ${statute}，但通知书结构化字段未列明`,
      relation: 'missed_by_baseline',
      confidence: 0.5,
      tag: 'heuristic',
    })
  }

  return disputes
}
