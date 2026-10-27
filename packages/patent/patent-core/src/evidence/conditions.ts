/**
 * 规则条件评估：把 evidence-rules.yaml 的条件名映射到证据字段与日期判定。
 *
 * 外部输入条件未提供时返回 undefined（pending），未知条件同样返回 undefined；
 * 两条路径都不把缺失输入误判为失败。
 * @module @deepseek-ai/dsh-patent-core/evidence/conditions
 */

import { determinePublicationDate, type PriorArtReference } from './date.ts'
import { evaluateFourElements } from './public-use.ts'
import { hasText } from './signals.ts'
import type { EvidenceSpan } from './span.ts'
import type {
  EvidenceExternalInputs,
  EvidenceRule,
  EvidenceType,
  FourElementsResult,
  PriorArtBasis,
  RuleApplication,
} from './types.ts'

/** 规则条件评估上下文。 */
type ConditionContext = {
  span: EvidenceSpan
  /** 调用方给出的申请日/优先权日。 */
  basis: PriorArtBasis
  /** 解析出的现有技术截止日（不可解析时为 undefined）。 */
  reference: PriorArtReference | undefined
  external: EvidenceExternalInputs
}

/**
 * 使用公开四要件条件名 → 对应要件的判定。条件名与 `evidence-rules.yaml` 的 EVI-015 一致。
 */
const PUBLIC_USE_CONDITIONS: Record<string, (fourElements: FourElementsResult) => boolean> = {
  public_use_time_available: fourElements => fourElements.timeElement.met,
  public_use_place_identified: fourElements => fourElements.placeElement.met,
  public_use_method_identified: fourElements => fourElements.methodElement.met,
  public_use_publicly_accessible: fourElements => fourElements.accessibility.met,
}

/**
 * 规则条件评估器：已知条件（span/日期可判）返回 true/false；
 * 外部输入条件（公证/译本/证人披露等）未提供时返回 undefined（pending）；
 * 未知条件返回 undefined（不误判）。
 */
function evaluateCondition(name: string, ctx: ConditionContext): boolean | undefined {
  const publicUseCheck = PUBLIC_USE_CONDITIONS[name]
  if (publicUseCheck !== undefined) return publicUseCheck(evaluateFourElements(ctx.span))
  switch (name) {
    case 'evidence_has_claim_refs':
      return (ctx.span.claimRefs?.length ?? 0) > 0
    case 'evidence_direction_clear':
      return ctx.span.direction === 'supporting' || ctx.span.direction === 'contradicting'
    case 'evidence_source_identified':
      return hasText(ctx.span.sourceUri)
    case 'evidence_content_hash_available':
    case 'content_hash_provided':
      return hasText(ctx.span.contentHash)
    case 'evidence_source_uri_or_doc_version_available':
      return hasText(ctx.span.sourceUri) || hasText(ctx.span.docVersion)
    case 'evidence_has_source_uri':
      return hasText(ctx.span.sourceUri)
    case 'publication_date_available':
      // The condition is about an ascertained date, not about a non-empty field:
      // an unparseable page date or a Wayback URL both go through the same
      // determination the judgment reports.
      return determinePublicationDate(ctx.span.docVersion, ctx.span.sourceUri, ctx.reference).determined !== 'unknown'
    case 'prior_art_reference_available':
      return ctx.reference !== undefined
    case 'evidence_notarized':
      return ctx.external.notarized
    case 'evidence_legalized':
      return ctx.external.legalized
    case 'evidence_translated':
      return ctx.external.translated
    case 'evidence_witness_disclosed':
      return ctx.external.witnessDisclosed
    case 'fact_is_well_known':
      return ctx.external.isWellKnown
    case 'fact_is_uncontested':
      return ctx.external.isUncontested
    case 'deadline_defined':
      return ctx.external.deadlineDefined
    case 'submission_within_deadline':
      return ctx.external.submissionWithinDeadline
    // ── EVI-002 证据收集合法性（外部输入；未提供时 pending）──
    case 'evidence_collection_legal':
      return ctx.external.collectionLegal
    // ── EVI-020 举证责任：案件类型已识别（外部输入；未提供时 pending）──
    case 'case_type_identified':
      return typeof ctx.external.caseType === 'string' && ctx.external.caseType.trim().length > 0 ? true : undefined
    // ── EVI-030 证明标准：支持/矛盾证据已计数（外部输入；未提供时 pending）──
    case 'supporting_evidence_counted':
      return typeof ctx.external.supportingCount === 'number' ? true : undefined
    case 'contradicting_evidence_counted':
      return typeof ctx.external.contradictingCount === 'number' ? true : undefined
    // ── EVI-050 证据链：保管链可追溯 / 完整性已核验（外部输入；未提供时 pending）──
    case 'custody_chain_traceable':
      return ctx.external.custodyChainTraceable
    case 'evidence_integrity_verified':
      return ctx.external.integrityVerified
    default:
      return undefined
  }
}

/**
 * 规则表应用（evidence-rules.yaml）：每条匹配证据类型的规则，对其 check.conditions
 * 逐项评估——已知条件（span/日期可判）确定 true/false；外部输入条件（公证/译本等）
 * 未提供时标记 pending（不误判为失败）。满足全部条件的规则为实际适用（rulesMatched）。
 * @param rules - 候选规则表。
 * @param span - 证据实体。
 * @param evType - 证据类型。
 * @param basis - 申请日与优先权日。
 * @param reference - 解析出的现有技术截止日。
 * @param external - 外部输入。
 * @returns 每条候选规则的适用结果。
 */
export function applyRules(
  rules: readonly EvidenceRule[],
  span: EvidenceSpan,
  evType: EvidenceType,
  basis: PriorArtBasis,
  reference: PriorArtReference | undefined,
  external: EvidenceExternalInputs,
): RuleApplication[] {
  const ctx: ConditionContext = { span, basis, reference, external }
  const applicable = rules.filter(r => r.evidenceType === evType || r.evidenceType === 'general')
  return applicable.map((rule) => {
    const conditions = rule.check?.conditions ?? []
    const pendingInputs: string[] = []
    const failedConditions: string[] = []
    let allMet = true
    for (const condition of conditions) {
      const result = evaluateCondition(condition, ctx)
      if (result === undefined) {
        pendingInputs.push(condition)
      } else if (!result) {
        allMet = false
        failedConditions.push(condition)
      }
    }
    return {
      ruleId: rule.ruleId,
      name: rule.name,
      action: rule.action,
      severity: rule.severity,
      // 有 pending 条件的规则不算实际适用（需外部输入确认后才 satisfied）
      satisfied: allMet && pendingInputs.length === 0,
      pendingInputs,
      failedConditions,
    }
  })
}
