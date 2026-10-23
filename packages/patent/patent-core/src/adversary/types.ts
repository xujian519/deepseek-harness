/**
 * src/adversary/types — 对立审查员模型的数据结构。
 *
 * 对立审查员从独立视角评估答复计划的薄弱环节：不消费己方中间推理（dispute_framing_report、
 * claim_chart、draft 等），只读 office_action、claims、response_plan 与 response_plan_summary。
 *
 * 输出两类结构：
 * - AdversaryDispute：单条争议点（法条 + 权项 + 关系标签 + 置信度）
 * - AdversaryReport：聚合报告（分类争议、整体置信度、摘要）
 */

/**
 * 对立审查员识别的单条争议点。
 *
 * `relation` 标记该争议点与基线答复计划的关系：
 * - `agreement`：对立审查员与基线一致
 * - `disagreement`：对立审查员与基线存在分歧
 * - `missed_by_baseline`：基线答复计划未覆盖的争议点
 */
export type AdversaryDispute = {
  /** 规范化法条编号（如 A22.3）。 */
  statute: string
  /** 涉及的权利要求编号。 */
  claims: number[]
  /** 争议要点（中文）。 */
  point: string
  /** 与基线答复计划的关系。 */
  relation: 'agreement' | 'disagreement' | 'missed_by_baseline'
  /** 与基线分歧的原因（仅 relation = 'disagreement' 时填写）。 */
  divergenceReason?: string
  /** 置信度 [0,1]。 */
  confidence: number
  /** 来源标签：`unverified` = 模型不可用时占位；`heuristic` = 启发式识别。 */
  tag: 'unverified' | 'heuristic'
}

/** 对立审查员聚合报告。 */
export type AdversaryReport = {
  /** 全部争议点（含三类关系）。 */
  disputes: AdversaryDispute[]
  /** 与基线一致的争议点。 */
  agreements: AdversaryDispute[]
  /** 与基线存在分歧的争议点。 */
  disagreements: AdversaryDispute[]
  /** 基线答复计划未覆盖的争议点。 */
  missedByBaseline: AdversaryDispute[]
  /** 模型不可用时的占位争议点。 */
  unverified: AdversaryDispute[]
  /** 整体置信度 [0,1]。 */
  overallConfidence: number
  /** 报告摘要（中文）。 */
  summary: string
}

/**
 * 对立审查员读取的通知书结构化字段（最小契约）。
 *
 * 与 dispute-framing 的 fromOfficeAction 一致：rejectionTypes + affectedClaims。
 * 对立审查员独立识别争议法条，不消费 dispute_framing_candidates 等己方中间产出。
 */
export type AdversaryOfficeAction = {
  rejectionTypes?: string[]
  affectedClaims?: number[]
  /** 审查员论点原文（可选；用于独立证据评估）。 */
  examinerArguments?: string
}

/**
 * 对立审查员读取的答复计划条目（最小契约）。
 *
 * response-plan 的每条策略对应一个 ResponsePlanSection；对立审查员只关心
 * ground（驳回类型）、strategy（策略标签）与 sections（必答段落）。
 */
export type AdversaryPlanEntry = {
  ground: string
  strategy: string
  claims?: number[]
  sections?: string[]
}

/** 法条编号 → 常见驳回类型映射（与 dispute-framing 共用同一套规范化）。 */
export const STATUTE_TO_GROUND: ReadonlyMap<string, string> = new Map([
  ['A22.2', 'novelty'],
  ['A22.3', 'inventiveness'],
  ['A22.4', 'utility'],
  ['A26.3', 'disclosure'],
  ['A26.4', 'claim-clarity'],
  ['A33', 'amendment'],
])

/** 常见驳回类型 → 法条编号映射。 */
export const GROUND_TO_STATUTE: ReadonlyMap<string, string> = new Map([
  ['novelty', 'A22.2'],
  ['inventiveness', 'A22.3'],
  ['utility', 'A22.4'],
  ['disclosure', 'A26.3'],
  ['claim-clarity', 'A26.4'],
  ['amendment', 'A33'],
  ['subject-matter-art2', 'A2.2'],
  ['subject-matter-art5', 'A5'],
  ['subject-matter-art25', 'A25'],
])
