/**
 * 法律域证据判断引擎。
 *
 * 对单条证据做三性判定（关联性/合法性/真实性）+ 类型特定判定，综合评分。
 * 判定只使用证据记录本身与调用方声明的外部输入：自报字段不作为采信依据。
 *
 * 设计对齐专利域证据引擎：确定性判定（无 LLM），权重可经 YAML 资产
 * （assets/legal-evidence-rules.yaml）配置；资产缺失时降级为默认权重。
 */

import { DEFAULT_LEGAL_WEIGHTS, parseLegalRuleSet } from './rule-set.ts'
import type {
  LegalEvidenceAssessment,
  LegalEvidenceDimensionJudgment,
  LegalEvidenceEngineInterface,
  LegalEvidenceFinding,
  LegalEvidenceInput,
  LegalEvidenceRule,
  LegalEvidenceScore,
  LegalEvidenceType,
} from './types.ts'
import { getEvaluator } from './evaluators/index.ts'

/** 法律域证据判断引擎。 */
export class LegalEvidenceEngine implements LegalEvidenceEngineInterface {
  private weights = { ...DEFAULT_LEGAL_WEIGHTS }
  private rules: LegalEvidenceRule[] = []
  private readonly warnings: string[] = []

  constructor(yamlText?: string, source = '<inline>') {
    if (yamlText !== undefined) this.loadRules(yamlText, source)
  }

  /** 加载 YAML 规则资产。 */
  loadRules(yamlText: string, source = '<inline>'): void {
    const { ruleSet, warnings } = parseLegalRuleSet(yamlText, source)
    this.warnings.push(...warnings)
    if (ruleSet === null) return
    this.weights = { ...ruleSet.weights }
    this.rules = ruleSet.rules
  }

  /** 规则加载期间累积的警告。 */
  getWarnings(): string[] {
    return [...this.warnings]
  }

  /** 获取全部规则。 */
  getRules(): LegalEvidenceRule[] {
    return [...this.rules]
  }

  /** 按证据类型获取规则。 */
  getRulesByType(evidenceType: LegalEvidenceType): LegalEvidenceRule[] {
    return this.rules.filter(r => r.evidenceType === evidenceType || r.evidenceType === 'general')
  }

  /**
   * 对单条证据做三性判定。
   * @param input - 证据评估输入。
   * @returns 该证据的完整评估结果。
   */
  assess(input: LegalEvidenceInput): LegalEvidenceAssessment {
    const evaluator = getEvaluator(input.evidenceType)

    // 三性判定
    const relevance = evaluator.evaluateRelevance(input)
    const legality = evaluator.evaluateLegality(input)
    const authenticity = evaluator.evaluateAuthenticity(input)

    // 规则检查发现
    const findings = evaluator.checkFindings(input)

    // 综合评分
    const score = this.computeOverallScore(relevance, legality, authenticity)

    // 推理说明
    const reasoning = this.buildReasoning(relevance, legality, authenticity, findings)

    return {
      evidenceId: input.evidenceId,
      evidenceType: input.evidenceType,
      score,
      dimensions: { relevance, legality, authenticity },
      findings,
      ...(input.burdenHolder !== undefined ? { burdenHolder: input.burdenHolder } : {}),
      ...(input.standard !== undefined ? { standard: input.standard } : {}),
      reasoning,
    }
  }

  /** 批量判定。 */
  batchAssess(inputs: LegalEvidenceInput[]): LegalEvidenceAssessment[] {
    return inputs.map(input => this.assess(input))
  }

  /** 综合三性评分（权重可经 YAML 配置）。 */
  private computeOverallScore(
    relevance: LegalEvidenceDimensionJudgment,
    legality: LegalEvidenceDimensionJudgment,
    authenticity: LegalEvidenceDimensionJudgment,
  ): LegalEvidenceScore {
    const overall =
      relevance.score * this.weights.relevance
      + legality.score * this.weights.legality
      + authenticity.score * this.weights.authenticity
    return {
      relevance: relevance.score,
      legality: legality.score,
      authenticity: authenticity.score,
      overall: Math.min(1, Math.max(0, overall)),
    }
  }

  /** 构建推理说明。 */
  private buildReasoning(
    relevance: LegalEvidenceDimensionJudgment,
    legality: LegalEvidenceDimensionJudgment,
    authenticity: LegalEvidenceDimensionJudgment,
    findings: LegalEvidenceFinding[],
  ): string {
    const parts: string[] = []
    parts.push(`关联性[${relevance.level}]: ${relevance.reasoning}`)
    parts.push(`合法性[${legality.level}]: ${legality.reasoning}`)
    parts.push(`真实性[${authenticity.level}]: ${authenticity.reasoning}`)

    const criticalFindings = findings.filter(f => !f.passed && f.severity === 'critical')
    if (criticalFindings.length > 0) {
      parts.push(`存在 ${criticalFindings.length} 项严重问题：${criticalFindings.map(f => f.reason).join('；')}`)
    }

    return parts.join('; ')
  }
}
