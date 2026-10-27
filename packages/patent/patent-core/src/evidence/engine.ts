/**
 * 证据判断引擎（移植自 Mady domains/evidence/engine.go + triple_attrs.go）。
 *
 * 对单条证据做三性判定（相关性/合法性/真实性）+ 类型特定判定（电子证据/
 * 互联网公开/域外/证人/公知常识/使用公开/现有技术日期），综合评分；
 * 并提供举证责任分配与证明标准达成评估。
 *
 * 判定只使用证据记录本身与调用方声明的外部输入：自报字段（哈希、证据类型标签）
 * 不作为采信依据——哈希只在调用方声明已独立核验时计入真实性，证据类型标签不
 * 代替公证文书、来源域名等可核对外部记载。
 *
 * 设计对齐 Mady：确定性判定（无 LLM），权重可经 YAML 资产
 * （rules/patent/evidence-rules.yaml）配置；外部服务不可用时降级而非失败。
 */

import { DEFAULT_WEIGHTS, parseRuleSet } from './rule-set.ts'
import { isLocatable, type EvidenceSpan } from './span.ts'
import { priorArtReference } from './date.ts'
import { computeOverallScore, buildReasoning, evaluateAuthenticity, evaluateLegality, evaluateRelevance, evaluateTypeSpecific, inferEvidenceType } from './judgment.ts'
import { applyRules } from './conditions.ts'
import { assessBurdenOfProof, assessProofStandard } from './proof-standard.ts'
import { hasText } from './signals.ts'
import type {
  BurdenDetermination,
  EvidenceExternalInputs,
  EvidenceJudgment,
  EvidenceJudgmentEngine,
  EvidenceRule,
  EvidenceType,
  JudgmentIssue,
  PriorArtBasis,
  ProofStandardResult,
} from './types.ts'

/**
 * 默认证据判断引擎。RuleIndex 内联实现（加载 YAML 资产 → 规则表），
 * 资产缺失时降级为默认权重 + 空规则表（不抛错）。
 */
export class EvidenceEngine implements EvidenceJudgmentEngine {
  private weights = { ...DEFAULT_WEIGHTS }
  private rules: EvidenceRule[] = []
  private readonly warnings: string[] = []

  constructor(yamlText?: string, source = '<inline>') {
    if (yamlText !== undefined) this.loadRules(yamlText, source)
  }

  loadRules(yamlText: string, source = '<inline>'): void {
    const { ruleSet, warnings } = parseRuleSet(yamlText, source)
    this.warnings.push(...warnings)
    if (ruleSet === null) return
    this.weights = { ...ruleSet.weights }
    this.rules = ruleSet.rules
  }

  /**
   * 规则加载期间累积的警告。
   * @returns 警告字符串数组副本。
   */
  getWarnings(): string[] {
    return [...this.warnings]
  }

  getRules(): EvidenceRule[] {
    return [...this.rules]
  }

  getRulesByType(evidenceType: EvidenceType): EvidenceRule[] {
    return this.rules.filter(r => r.evidenceType === evidenceType)
  }

  /**
   * 对单条证据做三性 + 类型特定判定（evidenceType 显式指定时覆盖 URI 推断）。
   * @param span - 证据实体。
   * @param basis - 申请日与优先权日（现有技术截止日取较早者）。
   * @param evidenceType - 显式证据类型，覆盖 URI 推断。
   * @param external - 外部输入（公证/译本/独立核验等）。
   * @returns 该证据的完整判定结果。
   */
  judge(
    span: EvidenceSpan,
    basis: PriorArtBasis = {},
    evidenceType?: EvidenceType,
    external: EvidenceExternalInputs = {},
  ): EvidenceJudgment {
    const evType = evidenceType ?? inferEvidenceType(span)
    const reference = priorArtReference(basis)
    const judgment: EvidenceJudgment = {
      spanId: span.id,
      direction: span.direction,
      confidence: 0.5,
      overallScore: 0.5,
      reasoning: '',
      flaggedIssues: [],
      rulesApplied: [],
    }

    judgment.relevanceJudgment = evaluateRelevance(span)
    judgment.legalityJudgment = evaluateLegality(span)
    judgment.authenticityJudgment = evaluateAuthenticity(span, external)

    // 缺陷提示按证据记录的语义条件判定，不按评分阈值：评分是完备度的连续量，整数阈值
    // 只会随权重调整而静默开关告警通道。
    const issues: JudgmentIssue[] = []
    if ((span.claimRefs?.length ?? 0) === 0) {
      issues.push({
        type: 'relevance',
        description: '证据未绑定任何权利要求或结论（claimRefs 为空），与待证事实的关联性无法确认',
        severity: 'major',
      })
    }
    if (!hasText(span.sourceUri)) {
      issues.push({
        type: 'legality',
        description: '未记录证据来源（sourceUri 为空），取证合法性无法确认',
        severity: 'critical',
      })
    }
    if (!isLocatable(span)) {
      issues.push({
        type: 'authenticity',
        description: '证据不可定位（无来源/版本/页码/字符区间/哈希），真实性无法核验',
        severity: 'critical',
      })
    }
    judgment.typeSpecificJudgment = evaluateTypeSpecific(span, evType, external, reference)
    if (judgment.typeSpecificJudgment.publicIntent === 'unknown') {
      issues.push({
        type: 'authenticity',
        description: '来源 URI 无法解析主机名，公开意图未知（未推定为公开），需人工核实证据是否对公众公开',
        severity: 'major',
      })
    }
    judgment.flaggedIssues = issues

    judgment.overallScore = computeOverallScore(judgment, this.weights)
    // confidence 与评分关联（低分证据不应宣称"确信"）——固定 1.0 是误导。
    judgment.confidence = Number(judgment.overallScore.toFixed(3))
    judgment.rulesApplied = applyRules(this.rules, span, evType, basis, reference, external)
    judgment.reasoning = buildReasoning(judgment, evType)
    return judgment
  }

  /**
   * 批量判定（同一时间基准与外部输入下的多条证据）。
   * @param spans - 证据实体列表。
   * @param basis - 申请日与优先权日。
   * @param evidenceType - 显式证据类型。
   * @param external - 外部输入。
   * @returns 逐条判定结果。
   */
  batchJudge(
    spans: EvidenceSpan[],
    basis: PriorArtBasis = {},
    evidenceType?: EvidenceType,
    external?: EvidenceExternalInputs,
  ): EvidenceJudgment[] {
    return spans.map(span => this.judge(span, basis, evidenceType, external))
  }

  /** 举证责任分配（caseType: invalidation / infringement / new_product_method 等）。 */
  assessBurdenOfProof(caseType: string, context?: Record<string, string>): BurdenDetermination {
    return assessBurdenOfProof(caseType, context)
  }

  /**
   * 证明标准达成评估（查找表驱动）。
   * @param judgments - 待评价的证据判定结果。
   * @param standard - 证明标准标识或中文名。
   * @returns 达成评估结果。
   */
  assessProofStandard(judgments: EvidenceJudgment[], standard: string): ProofStandardResult {
    return assessProofStandard(judgments, standard)
  }
}
