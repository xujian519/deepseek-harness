/**
 * 证人证言判定器（《民事诉讼法》第 66 条第 6 项）。
 *
 * 证人证言评估要点：
 * - 关联性：待证事实明确性、证言与待证事实的关联度
 * - 合法性：证人资格合法、取证程序合法
 * - 真实性：利害关系披露、证言一致性、佐证情况
 */

import type { LegalEvidenceDimensionJudgment, LegalEvidenceFinding, LegalEvidenceInput } from '../types.ts'
import { evaluateGenericRelevance, hasText, levelFor, TRIPLE_ATTRIBUTE_BASE, type LegalEvidenceEvaluator } from './base.ts'

/** 证人证言判定器实现。 */
export const witnessTestimonyEvaluator: LegalEvidenceEvaluator = {
  evaluateRelevance(input: LegalEvidenceInput): LegalEvidenceDimensionJudgment {
    return evaluateGenericRelevance(input)
  },

  evaluateLegality(input: LegalEvidenceInput): LegalEvidenceDimensionJudgment {
    let score = TRIPLE_ATTRIBUTE_BASE
    const reasons: string[] = []

    if (input.collectionLegal === true) {
      score += 0.25
      reasons.push('证人证言收集程序合法')
    } else if (input.collectionLegal === false) {
      score -= 0.3
      reasons.push('证人证言收集程序合法性存疑')
    }

    if (input.formLegal === true) {
      score += 0.2
      reasons.push('证人证言形式合法')
    }

    if (hasText(input.source)) {
      score += 0.05
      reasons.push('已记录证人身份')
    }

    score = Math.max(0, Math.min(score, 1.0))
    return {
      dimension: 'legality',
      score,
      level: levelFor(score),
      reasoning: reasons.length > 0 ? `证人证言合法性评估：${reasons.join('；')}` : '证人证言合法性评估：基础评分',
    }
  },

  evaluateAuthenticity(input: LegalEvidenceInput): LegalEvidenceDimensionJudgment {
    let score = TRIPLE_ATTRIBUTE_BASE
    const reasons: string[] = []

    // 利害关系
    if (input.witnessHasConflict === true) {
      if (input.conflictDisclosed === true) {
        score += 0.05
        reasons.push('证人有利害关系但已披露')
      } else {
        score -= 0.2
        reasons.push('证人有利害关系且未披露')
      }
    } else if (input.witnessHasConflict === false) {
      score += 0.15
      reasons.push('证人与案件无利害关系')
    }

    // 佐证情况
    if (input.corroborated === true) {
      score += 0.2
      reasons.push('证人证言有其他证据佐证')
    } else if (input.corroborated === false) {
      score -= 0.15
      reasons.push('证人证言缺乏佐证')
    }

    // 证言内容
    if (hasText(input.content)) {
      score += 0.1
      reasons.push('已记录证言内容')
    }

    score = Math.max(0, Math.min(score, 1.0))
    return {
      dimension: 'authenticity',
      score,
      level: levelFor(score),
      reasoning: reasons.length > 0 ? `证人证言真实性评估：${reasons.join('；')}` : '证人证言真实性评估：基础评分',
    }
  },

  checkFindings(input: LegalEvidenceInput): LegalEvidenceFinding[] {
    const findings: LegalEvidenceFinding[] = []

    // LEGAL-EVI-007: 证人应与案件无利害关系或已披露
    if (input.witnessHasConflict === true && input.conflictDisclosed !== true) {
      findings.push({
        ruleId: 'LEGAL-EVI-007',
        passed: false,
        reason: '证人与案件有利害关系且未披露',
        severity: 'critical',
      })
    } else if (input.witnessHasConflict === true) {
      findings.push({
        ruleId: 'LEGAL-EVI-007',
        passed: true,
        reason: '证人有利害关系但已披露',
        severity: 'info',
      })
    } else {
      findings.push({
        ruleId: 'LEGAL-EVI-007',
        passed: true,
        reason: '证人与案件无利害关系',
        severity: 'info',
      })
    }

    // LEGAL-EVI-008: 证人证言应有佐证
    if (input.corroborated !== true) {
      findings.push({
        ruleId: 'LEGAL-EVI-008',
        passed: false,
        reason: '证人证言缺乏其他证据佐证',
        severity: 'warning',
      })
    }

    return findings
  },
}
