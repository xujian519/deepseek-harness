/**
 * 举证责任分配与证明标准达成评估。
 *
 * 未知证明标准 fail-closed：status 为 `unknown-standard` 且 met 为 false，不以
 * 置信度推定达标。支持/矛盾按证据方向归类，neutral 不计入比较。
 * @module @deepseek-ai/dsh-patent-core/evidence/proof-standard
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { BurdenDetermination, EvidenceJudgment, ProofStandardResult } from './types.ts'

/** 证明标准标识。 */
export const STANDARD_PREPONDERANCE = 'preponderance'
/** 高度盖然性（清晰且令人信服）证明标准标识。 */
export const STANDARD_CLEAR_CONVINCING = 'clear_and_convincing'

/**
 * 举证责任分配（caseType: invalidation / infringement / new_product_method 等）。
 * @param caseType - 案件类型标识或中文名。
 * @param context - 调用方显式覆盖的举证方。
 * @returns 举证责任判定。
 */
export function assessBurdenOfProof(caseType: string, context?: Record<string, string>): BurdenDetermination {
  const det: BurdenDetermination = {
    burdenHolder: 'claimant',
    standard: STANDARD_PREPONDERANCE,
    hasShifted: false,
    reasoning: '适用谁主张谁举证原则',
  }
  switch (caseType.toLowerCase()) {
    case 'invalidation':
    case 'invalidity':
    case '无效':
      det.burdenHolder = 'claimant'
      det.reasoning = '无效宣告程序中，请求人对其主张承担举证责任'
      break
    case 'infringement':
    case '侵权':
      det.burdenHolder = 'claimant'
      det.standard = STANDARD_CLEAR_CONVINCING
      det.reasoning = '侵权诉讼中，权利人对其主张承担举证责任'
      break
    case 'new_product_method':
    case '新产品制造方法':
      det.burdenHolder = 'claimant'
      det.hasShifted = true
      det.shiftReason = '新产品制造方法举证责任倒置'
      det.reasoning =
        '权利人须先证明：1) 产品为新产品；2) 被诉产品与依专利方法制造的产品为同样产品。证明后举证责任转移至被诉侵权人'
      break
    default:
      det.burdenHolder = 'claimant'
      det.reasoning = '适用谁主张谁举证原则'
      break
  }
  if (context?.burden_holder !== undefined) det.burdenHolder = context.burden_holder
  return det
}

/**
 * 证明标准达成评估（查找表驱动）：
 *   preponderance/优势证据：支持 > 矛盾 且 置信度 ≥ 0.5
 *   clear_and_convincing/高度盖然性：置信度 ≥ 0.7 且 支持 > 2×矛盾
 *   未知标准：fail-closed —— `status: 'unknown-standard'` 且 `met: false`，不以置信度推定达标。
 * 支持/矛盾按证据的 `direction` 归类，不按评分：立场是当事人主张问题，评分是证明力
 * 问题，高分矛盾证据不是支持证据。neutral 证据不计入比较。置信度取全部证据评分的均值。
 * @param judgments - 待评价的证据判定结果。
 * @param standard - 证明标准标识或中文名。
 * @returns 达成评估结果。
 */
export function assessProofStandard(judgments: EvidenceJudgment[], standard: string): ProofStandardResult {
  const result: ProofStandardResult = {
    met: false,
    status: 'evaluated',
    standard,
    confidence: 0,
    supportingCount: 0,
    contradictingCount: 0,
    neutralCount: 0,
    reasoning: '',
    gaps: [],
  }
  let totalScore = 0
  let validCount = 0
  let supporting = 0
  let contradicting = 0
  let neutral = 0
  for (const j of judgments) {
    validCount += 1
    totalScore += j.overallScore
    switch (j.direction) {
      case 'supporting':
        supporting += 1
        break
      case 'contradicting':
        contradicting += 1
        break
      case 'neutral':
        neutral += 1
        break
      /* v8 ignore next -- closed-union backstop; the compiler rejects a new direction here. */
      default:
        assertNever(j.direction, 'evidence direction')
    }
  }
  result.supportingCount = supporting
  result.contradictingCount = contradicting
  result.neutralCount = neutral
  if (validCount > 0) result.confidence = totalScore / validCount

  const STANDARDS: Record<string, { minConfidence: number; ratio: 'preponderance' | 'clear_convincing' }> = {
    [STANDARD_PREPONDERANCE]: { minConfidence: 0.5, ratio: 'preponderance' },
    优势证据: { minConfidence: 0.5, ratio: 'preponderance' },
    [STANDARD_CLEAR_CONVINCING]: { minConfidence: 0.7, ratio: 'clear_convincing' },
    高度盖然性: { minConfidence: 0.7, ratio: 'clear_convincing' },
  }
  const rule = STANDARDS[standard]
  if (rule === undefined) {
    result.status = 'unknown-standard'
    result.gaps.push(
      standard.trim() === ''
        ? '无法识别的证明标准：未提供标准'
        : `无法识别的证明标准：${standard}`,
    )
  } else {
    result.met =
      rule.ratio === 'preponderance'
        ? supporting > contradicting && result.confidence >= rule.minConfidence
        : result.confidence >= rule.minConfidence && supporting > contradicting * 2
  }
  if (contradicting > 0) {
    result.gaps.push(`存在 ${contradicting} 件反证，需逐件评价证明力后再认定`)
  }
  if (validCount === 0) {
    result.gaps.push('无证据支持')
    result.met = false
  }
  result.reasoning =
    `支持证据 ${supporting} 件 / 反证 ${contradicting} 件 / 中性 ${neutral} 件，平均置信度 ${(result.confidence * 100).toFixed(0)}%` +
    (result.status === 'unknown-standard' ? '；证明标准无法识别，不能认定达标' : '')
  return result
}
