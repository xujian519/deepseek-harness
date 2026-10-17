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

import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { EvidenceSpan } from './span.ts'
import { isLocatable } from './span.ts'
import {
  determinePublicationDate,
  extractDateFromText,
  inferredMonthEnd,
  isBeforeReferenceDate,
  isMonthOnlyDate,
  isPreciseDate,
  parseDateFlexible,
  priorArtReference,
  type PriorArtReference,
} from './date.ts'
import { credibilityToScore, evaluatePublicIntent, platformCategory, platformCredibility } from './credibility.ts'
import { DEFAULT_WEIGHTS, parseRuleSet } from './rule-set.ts'
import type {
  BurdenDetermination,
  ContentIntegrityStatus,
  DateDetermination,
  DimensionJudgment,
  ElementResult,
  EvidenceExternalInputs,
  EvidenceJudgment,
  EvidenceJudgmentEngine,
  EvidenceRule,
  EvidenceType,
  FourElementsResult,
  JudgmentIssue,
  PriorArtBasis,
  ProofStandardResult,
  RuleApplication,
  TypeSpecificJudgment,
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

/** 证明标准标识。 */
export const STANDARD_PREPONDERANCE = 'preponderance'
/** 高度盖然性（清晰且令人信服）证明标准标识。 */
export const STANDARD_CLEAR_CONVINCING = 'clear_and_convincing'

const LEVEL_HIGH = 'high'
const LEVEL_MEDIUM_HIGH = 'medium_high'
const LEVEL_MEDIUM = 'medium'
const LEVEL_LOW = 'low'

function levelFor(score: number, thresholds: Array<{ min: number; level: string }>, fallback: string): string {
  for (const t of thresholds) {
    if (score >= t.min) return t.level
  }
  return fallback
}

/** 字段是否填写了非空白内容。 */
function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

/** 三性评分基线：证据记录本身的完备度起点，不含任何加分。 */
const TRIPLE_ATTRIBUTE_BASE = 0.5

// ---------------------------------------------------------------------------
// 三性判定（对齐 Mady evaluateRelevance / evaluateLegality / evaluateAuthenticity）
// ---------------------------------------------------------------------------

function evaluateRelevance(span: EvidenceSpan): DimensionJudgment {
  let score = TRIPLE_ATTRIBUTE_BASE
  if (hasText(span.sourceUri)) score += 0.1
  if ((span.claimRefs?.length ?? 0) > 0) score += 0.2
  if (span.direction === 'supporting' || span.direction === 'contradicting') score += 0.1
  if (hasText(span.snippet)) score += 0.1
  score = Math.min(score, 1.0)
  return {
    dimension: 'relevance',
    score,
    level: levelFor(
      score,
      [
        { min: 0.85, level: LEVEL_HIGH },
        { min: 0.65, level: LEVEL_MEDIUM_HIGH },
        { min: 0.45, level: LEVEL_MEDIUM },
      ],
      LEVEL_LOW,
    ),
    reasoning: '相关性评估完成',
  }
}

/**
 * 真实性评分。只有当事人自报字段可用的，一律按记录完备度计分：内容哈希在判定阶段无法
 * 重算，只在调用方声明已独立核验（`integrityVerified`）时才计入。
 */
function evaluateAuthenticity(span: EvidenceSpan, external: EvidenceExternalInputs): DimensionJudgment {
  let score = TRIPLE_ATTRIBUTE_BASE
  if (hasText(span.docVersion)) score += 0.1
  if (hasText(span.contentHash) && external.integrityVerified === true) score += 0.3
  score = Math.min(score, 1.0)
  return {
    dimension: 'authenticity',
    score,
    level: levelFor(
      score,
      [
        { min: 0.85, level: LEVEL_HIGH },
        { min: 0.65, level: LEVEL_MEDIUM_HIGH },
      ],
      LEVEL_LOW,
    ),
    reasoning: '真实性评估完成',
  }
}

/**
 * 合法性评分。来源记录是唯一可核对的输入：内容哈希与合法性无关（哈希证明内容未被改动，
 * 不证明取证合法），不作为合法性的加分项。
 */
function evaluateLegality(span: EvidenceSpan): DimensionJudgment {
  const score = hasText(span.sourceUri) ? 0.7 : TRIPLE_ATTRIBUTE_BASE
  return {
    dimension: 'legality',
    score,
    level: levelFor(
      score,
      [
        { min: 0.85, level: LEVEL_HIGH },
        { min: 0.65, level: LEVEL_MEDIUM_HIGH },
      ],
      LEVEL_LOW,
    ),
    reasoning: '合法性评估完成',
  }
}

// ---------------------------------------------------------------------------
// 类型特定判定（对齐 Mady evaluateTypeSpecific + 使用公开辅助函数）
// ---------------------------------------------------------------------------

/**
 * 从证据特征推断证据类型；显式类型优先，否则按 URI scheme/内容启发式。
 * @param span - 证据实体。
 * @returns 推断出的证据类型。
 */
export function inferEvidenceType(span: EvidenceSpan): EvidenceType {
  const uri = span.sourceUri ?? ''
  if (uri.startsWith('web_pub:') || uri.startsWith('http_archive:')) return 'internet_publication'
  // web: 是工具文档约定的默认格式（"web:https://…判定平台可信度"）：网络来源
  // 走互联网公开类型特定检查（公开日/平台可信度/完整性/公开意图），
  // 而不是落回 general 仅做三性启发式评分。
  if (uri.startsWith('web:')) return 'internet_publication'
  if (uri.startsWith('pub_use:') || uri.startsWith('public_use:')) return 'public_use'
  if (uri.startsWith('witness:')) return 'witness_testimony'
  if (uri.startsWith('patent:') || uri.startsWith('prior_art:')) return 'prior_art_date'
  if (uri.startsWith('notary:') || uri.includes('notariz')) return 'notarial_certificate'
  return 'general'
}

/**
 * 内容完整性状态。当事人自报的哈希串只是可核验锚点，判定路径不重算哈希，因此仅有哈希
 * 记为 `partial`（部分验证）；只有调用方声明已独立核验（`integrityVerified`）才记
 * `verified`。
 */
function evaluateContentIntegrity(span: EvidenceSpan, external: EvidenceExternalInputs): ContentIntegrityStatus {
  if (!hasText(span.contentHash)) return 'unverified'
  return external.integrityVerified === true ? 'verified' : 'partial'
}

/** 互联网公开日期推定（页面标注日期 > Wayback Machine）。 */
function determineInternetPublicationDate(span: EvidenceSpan, reference?: PriorArtReference): DateDetermination {
  return determinePublicationDate(span.docVersion, span.sourceUri, reference)
}

function evaluateTypeSpecific(
  span: EvidenceSpan,
  evType: EvidenceType,
  external: EvidenceExternalInputs,
  reference?: PriorArtReference,
): TypeSpecificJudgment {
  const ts: TypeSpecificJudgment = { evidenceType: evType }
  const uri = span.sourceUri ?? ''

  switch (evType) {
    case 'electronic': {
      const level = platformCredibility(uri)
      ts.platformCredibility = level
      ts.credibilityScore = credibilityToScore(level)
      break
    }
    case 'foreign_language':
      ts.translationStatus = 'unknown'
      break
    case 'notarial_certificate':
      // 声明证据类型不等于公证已完成：公证状态只来自公证文书记载（外部输入 notarized）。
      ts.notarizationStatus = external.notarized === true ? 'confirmed' : 'unverified'
      break
    case 'witness_testimony':
      ts.witnessCredibility = 'medium'
      break
    case 'common_knowledge':
      ts.exemptionApplied = '无需举证'
      break
    case 'prior_art_date':
      ts.dateDetermination = determineInternetPublicationDate(span, reference)
      break
    case 'internet_publication': {
      ts.dateDetermination = determineInternetPublicationDate(span, reference)
      const level = platformCredibility(uri)
      ts.platformCredibility = level
      ts.credibilityScore = credibilityToScore(level)
      ts.platformCategory = platformCategory(uri)
      ts.contentIntegrity = evaluateContentIntegrity(span, external)
      ts.publicIntent = evaluatePublicIntent(uri)
      break
    }
    case 'public_use': {
      ts.dateDetermination = determinePublicUseDate(span, reference)
      ts.fourElementsCheck = evaluateFourElements(span)
      ts.burdenDifficulty = assessBurdenDifficulty(ts.fourElementsCheck)
      ts.chainIntegrity = assessChainIntegrity(span, external, ts.fourElementsCheck)
      break
    }
    default:
      break
  }
  return ts
}

/** 使用公开日期推定（主张日期 > 描述文本提取）。 */
function determinePublicUseDate(span: EvidenceSpan, reference?: PriorArtReference): DateDetermination {
  const result: DateDetermination = {
    sourceDate: span.docVersion ?? '',
    determined: 'unknown',
    method: 'public_use',
    isPriorArt: false,
    ...(reference !== undefined ? { referenceDate: reference.date, referenceBasis: reference.basis } : {}),
    reliability: 'low',
    sourceType: 'claimed_date',
  }
  if (span.docVersion !== undefined && span.docVersion !== '') {
    const parsed = parseDateFlexible(span.docVersion)
    if (parsed !== null) {
      /* v8 ignore else -- every parseDateFlexible-parseable string is precise or month-only, so the else-if chain's else arm is dead */
      if (isPreciseDate(span.docVersion)) {
        // 精确日期（含英文月份格式 "Jan 15, 2023"）：直接采用，不得截为年-月
        result.determined = span.docVersion
        result.reliability = 'medium'
      } else if (isMonthOnlyDate(span.docVersion)) {
        result.determined = inferredMonthEnd(parsed)
        result.reliability = 'low'
      } else {
        // 可解析但精度不足的日期：保留解析值（不再落 "unknown"）
        result.determined = span.docVersion
        result.reliability = 'low'
      }
      result.isPriorArt = isBeforeReferenceDate(result.determined, reference?.date)
      return result
    }
  }
  const extracted = extractDateFromText(span.snippet ?? '')
  if (extracted !== '') {
    result.sourceDate = extracted
    result.determined = extracted
    result.reliability = 'low'
    result.sourceType = 'inferred'
    result.isPriorArt = isBeforeReferenceDate(extracted, reference?.date)
  }
  return result
}

/** 拉丁词指示符：按词边界匹配，避免 "us" 命中 because / use 这类子串。 */
const LATIN_INDICATOR_RE = /^[a-z][a-z -]*$/

/** 否定标记：出现在指示符之前时，片段是在否认该事实，不能按肯定认定。 */
const NEGATION_MARKERS = ['尚未', '未', '没有', '不存在', '无', '不得', '不', '非', 'not ', 'no ', 'without ', "n't "]

/** 含「不／无」但不表示否定的常见组合，判定前先从否定窗口剔除。 */
const NEGATION_EXEMPT = ['不过', '不但', '不仅', '不只', '不单', '不无', '无不', 'not only']

/** 否定作用窗口：中文指示符前 6 字内出现否定标记即视为该处被否定。按窗口判定是近似——
 * 「无锡」「无论」这类词里的「无」也会算作否定，方向是少认定肯定线索，不误认。 */
const CJK_NEGATION_WINDOW = 6

/** 英文否定词与中心词之间常隔冠词（without any nda），窗口相应放宽。 */
const LATIN_NEGATION_WINDOW = 24

/**
 * 指示符匹配：中文指示符按子串，拉丁指示符按词边界，不区分肯定与否定。
 * @param snippet - 已小写的待匹配文本。
 * @param keywords - 指示符表。
 * @returns 是否出现任一指示符。
 */
function containsIndicator(snippet: string, keywords: readonly string[]): boolean {
  return keywords.some(kw => indicatorPattern(kw.toLowerCase()).test(snippet))
}

/**
 * 否定感知的指示符匹配：只认定未被否定的命中。片段写「未约定保密义务」时是在
 * 排除保密义务，不能据此认定存在保密义务；写「未在中国境内销售」时也不能认定
 * 使用地在中国境内。
 * @param snippet - 已小写的待匹配文本。
 * @param keywords - 指示符表。
 * @returns 是否存在未被否定的命中。
 */
function containsAffirmed(snippet: string, keywords: readonly string[]): boolean {
  return keywords.some(kw => hasAffirmedOccurrence(snippet, kw.toLowerCase()))
}

/**
 * 单个指示符的匹配式。拉丁指示符按词边界（前导字符在捕获组内，以便还原命中位置），
 * 中文指示符按子串。
 * @param needle - 已小写的指示符。
 * @param flags - 正则标志。
 * @returns 匹配式。
 */
function indicatorPattern(needle: string, flags = ''): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return LATIN_INDICATOR_RE.test(needle)
    ? new RegExp(`(^|[^a-z])${escaped}(?=[^a-z]|$)`, flags)
    : new RegExp(escaped, flags)
}

/**
 * 指示符是否存在未被否定的命中。
 * @param snippet - 已小写的待匹配文本。
 * @param needle - 已小写的指示符。
 * @returns 是否命中且未被否定。
 */
function hasAffirmedOccurrence(snippet: string, needle: string): boolean {
  const window = LATIN_INDICATOR_RE.test(needle) ? LATIN_NEGATION_WINDOW : CJK_NEGATION_WINDOW
  for (const match of snippet.matchAll(indicatorPattern(needle, 'g'))) {
    const start = match.index + (match[1]?.length ?? 0)
    if (!isNegatedAt(snippet, start, window)) return true
  }
  return false
}

/**
 * 指示符起始处之前是否带否定标记。
 * @param snippet - 已小写的待匹配文本。
 * @param start - 指示符起始下标。
 * @param window - 向前回看的字符数。
 * @returns 该处是否被否定。
 */
function isNegatedAt(snippet: string, start: number, window: number): boolean {
  const before = snippet.slice(Math.max(0, start - window), start)
  const stripped = NEGATION_EXEMPT.reduce((text, combo) => text.replaceAll(combo, ''), before)
  return NEGATION_MARKERS.some(marker => stripped.includes(marker))
}

/**
 * 使用公开四要件检查（时间/地点/方式/公众可获取性，对齐 Mady evaluateFourElements）。
 * 要件只能由片段中的线索认定：未提及即 `met: false` 并说明缺什么，不推定满足；
 * 被片段否认的线索（如「未在中国境内销售」「未约定保密义务」）同样不按肯定认定。
 * @param span - 证据实体。
 * @returns 四要件检查结果。
 */
export function evaluateFourElements(span: EvidenceSpan): FourElementsResult {
  const timeElement = evaluatePublicUseTime(span)
  const placeElement = evaluatePublicUsePlace(span)
  const methodElement = evaluatePublicUseMethod(span)
  const accessibility = evaluatePublicUseAccessibility(span)
  const allMet = timeElement.met && placeElement.met && methodElement.met && accessibility.met
  return {
    timeElement,
    placeElement,
    methodElement,
    accessibility,
    allMet,
    overallScore: (timeElement.score + placeElement.score + methodElement.score + accessibility.score) / 4,
  }
}

function evaluatePublicUseTime(span: EvidenceSpan): ElementResult {
  if (span.docVersion === undefined || span.docVersion === '') {
    return { met: false, score: 0.25, detail: '未提供使用公开日期，无法判断是否在现有技术截止日之前' }
  }
  if (parseDateFlexible(span.docVersion) === null) {
    return { met: false, score: 0.3, detail: `日期格式无法识别: ${span.docVersion}` }
  }
  if (isPreciseDate(span.docVersion)) {
    return { met: true, score: 0.9, detail: `使用公开日期为 ${span.docVersion}，格式完整` }
  }
  return { met: true, score: 0.7, detail: `使用公开日期为 ${span.docVersion}，精度不足，需补充具体日期` }
}

function evaluatePublicUsePlace(span: EvidenceSpan): ElementResult {
  const snippet = (span.snippet ?? '').toLowerCase()
  const domesticIndicators = ['中国', '北京', '上海', '广州', '深圳', '国内', '境内']
  const foreignIndicators = ['美国', '日本', '德国', '英国', '法国', '韩国', '国外', '境外', 'us', 'usa', 'europe', 'international']
  if (containsAffirmed(snippet, domesticIndicators)) {
    return { met: true, score: 0.85, detail: '使用行为发生在中国境内（构成国内公开）' }
  }
  if (containsAffirmed(snippet, foreignIndicators)) {
    return { met: true, score: 0.8, detail: '使用行为发生在境外（构成国外公开，中国专利法采用绝对新颖性标准）' }
  }
  return { met: false, score: 0.3, detail: '片段未提及使用地点，无法认定公开发生地，需补充使用地点的直接证据' }
}

function evaluatePublicUseMethod(span: EvidenceSpan): ElementResult {
  const snippet = (span.snippet ?? '').toLowerCase()
  const salesIndicators = ['销售', '出售', '售卖', '购买', 'sell', 'sale', 'transaction']
  const exhibitionIndicators = ['展览', '展出', '展示', '演示', 'exhibition', 'expo', 'fair', 'show', 'demonstrat']
  const publicationIndicators = ['出版', '发布', '发表', '公开', 'publish', 'release', 'post']
  const otherIndicators = ['使用', '实施', '制造', '生产', 'use', 'manufactur', 'produc']

  if (containsAffirmed(snippet, salesIndicators)) {
    return { met: true, score: 0.9, detail: '通过销售行为公开使用' }
  }
  if (containsAffirmed(snippet, exhibitionIndicators)) {
    return { met: true, score: 0.85, detail: '通过展览或展示行为公开使用' }
  }
  if (containsAffirmed(snippet, publicationIndicators)) {
    return { met: true, score: 0.75, detail: '通过发布/发表行为公开使用' }
  }
  if (containsAffirmed(snippet, otherIndicators)) {
    return { met: true, score: 0.6, detail: '通过其他方式公开使用，需进一步明确具体方式' }
  }
  return { met: false, score: 0.3, detail: '未识别出明确的使用公开方式，需补充公开方式的描述（如销售、展览、演示等）' }
}

function evaluatePublicUseAccessibility(span: EvidenceSpan): ElementResult {
  const snippet = (span.snippet ?? '').toLowerCase()
  const confidentialityIndicators = ['保密', '秘密', 'confidential', '保密协议', 'nda', 'non-disclosure']
  const limitedAccessIndicators = ['内部', '内测', '内部测试', 'closed', 'internal', 'invite-only']
  const publicAccessIndicators = ['公开', '开放', '公众', 'public', 'open', 'anyone']

  if (containsAffirmed(snippet, confidentialityIndicators)) {
    return { met: false, score: 0.2, detail: '存在保密义务或保密措施，可能不构成公众可获取' }
  }
  if (containsAffirmed(snippet, limitedAccessIndicators)) {
    return { met: false, score: 0.35, detail: '使用行为限于特定范围，非对公众开放' }
  }
  if (containsAffirmed(snippet, publicAccessIndicators)) {
    return { met: true, score: 0.9, detail: '使用行为对公众开放，公众可获取' }
  }
  if (containsIndicator(snippet, confidentialityIndicators)) {
    return {
      met: false,
      score: 0.5,
      detail: '片段说明不存在保密义务，但未说明使用是否对不特定公众开放，公众可获取性要件仍未认定',
    }
  }
  return { met: false, score: 0.3, detail: '片段未提及使用是否对公众开放，无法认定公众可获取，需补充旁证' }
}

/**
 * 举证难度：按四要件满足数分档。要件缺失越多，补证负担越重。
 * @param fourElements - 四要件检查结果。
 * @returns 难度档位。
 */
function assessBurdenDifficulty(fourElements: FourElementsResult | undefined): string {
  /* v8 ignore next -- called only from the public_use branch with a computed FourElementsResult */
  if (fourElements === undefined) return '无法评估'
  const metCount = [
    fourElements.timeElement,
    fourElements.placeElement,
    fourElements.methodElement,
    fourElements.accessibility,
  ].filter(e => e.met).length
  if (metCount >= 4) return '中'
  if (metCount >= 2) return '高'
  return '极高'
}

/**
 * 证据链完整性建议。内容哈希只作锚点陈述：未经独立核验不称"完整"。
 * @param span - 证据实体。
 * @param external - 外部输入（是否已独立核验完整性）。
 * @param fourElements - 四要件检查结果。
 * @returns 证据链完整性表述。
 */
function assessChainIntegrity(
  span: EvidenceSpan,
  external: EvidenceExternalInputs,
  fourElements: FourElementsResult | undefined,
): string {
  /* v8 ignore next -- called only from the public_use branch with a computed FourElementsResult */
  if (fourElements === undefined) return '无法评估'
  if (fourElements.allMet) {
    if (hasText(span.contentHash) && external.integrityVerified === true) {
      return '完整（四要素齐全且内容哈希经独立核验）'
    }
    return '较完整（四要素齐全，建议补充旁证印证）'
  }
  if (hasText(span.snippet)) {
    return '需补充证据（部分要件缺失，建议提供销售合同/展览记录等直接证据）'
  }
  return '证据链不完整，建议收集多份相互印证的证据'
}

// ---------------------------------------------------------------------------
// DefaultEngine（对齐 Mady DefaultEngine）
// ---------------------------------------------------------------------------

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
    judgment.flaggedIssues = issues

    judgment.typeSpecificJudgment = evaluateTypeSpecific(span, evType, external, reference)
    judgment.overallScore = this.computeOverallScore(judgment)
    // confidence 与评分关联（低分证据不应宣称"确信"）——固定 1.0 是误导。
    judgment.confidence = Number(judgment.overallScore.toFixed(3))
    judgment.rulesApplied = this.applyRules(span, evType, basis, reference, external)
    judgment.reasoning = this.buildReasoning(judgment, evType)
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

  /**
   * 规则表应用（evidence-rules.yaml）：每条匹配证据类型的规则，对其 check.conditions
   * 逐项评估——已知条件（span/日期可判）确定 true/false；外部输入条件（公证/译本等）
   * 未提供时标记 pending（不误判为失败）。满足全部条件的规则为实际适用（rulesMatched）。
   * @param span - 证据实体。
   * @param evType - 证据类型。
   * @param basis - 申请日与优先权日。
   * @param reference - 解析出的现有技术截止日。
   * @param external - 外部输入。
   * @returns 每条候选规则的适用结果。
   */
  private applyRules(
    span: EvidenceSpan,
    evType: EvidenceType,
    basis: PriorArtBasis,
    reference: PriorArtReference | undefined,
    external: EvidenceExternalInputs,
  ): RuleApplication[] {
    const ctx: ConditionContext = { span, basis, reference, external }
    const applicable = this.rules.filter(r => r.evidenceType === evType || r.evidenceType === 'general')
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

  /** 举证责任分配（caseType: invalidation / infringement / new_product_method 等）。 */
  assessBurdenOfProof(caseType: string, context?: Record<string, string>): BurdenDetermination {
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
   *   未知标准：置信度 ≥ 0.5（宽松放行）
   * 支持/矛盾按证据的 `direction` 归类，不按评分：立场是当事人主张问题，评分是证明力
   * 问题，高分矛盾证据不是支持证据。neutral 证据不计入比较。置信度取全部证据评分的均值。
   * @param judgments - 待评价的证据判定结果。
   * @param standard - 证明标准标识或中文名。
   * @returns 达成评估结果。
   */
  assessProofStandard(judgments: EvidenceJudgment[], standard: string): ProofStandardResult {
    const result: ProofStandardResult = {
      met: false,
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
    if (rule !== undefined) {
      result.met =
        rule.ratio === 'preponderance'
          ? supporting > contradicting && result.confidence >= rule.minConfidence
          : result.confidence >= rule.minConfidence && supporting > contradicting * 2
    } else {
      result.met = result.confidence >= 0.5
    }
    if (contradicting > 0) {
      result.gaps.push(`存在 ${contradicting} 件反证，需逐件评价证明力后再认定`)
    }
    if (validCount === 0) {
      result.gaps.push('无证据支持')
      result.met = false
    }
    result.reasoning =
      `支持证据 ${supporting} 件 / 反证 ${contradicting} 件 / 中性 ${neutral} 件，平均置信度 ${(result.confidence * 100).toFixed(0)}%`
    return result
  }

  /** 综合三性评分（权重可经 YAML 配置）；电子/互联网公开类按平台可信度修正。 */
  private computeOverallScore(judgment: EvidenceJudgment): number {
    const dims: Array<DimensionJudgment | undefined> = [
      judgment.relevanceJudgment,
      judgment.legalityJudgment,
      judgment.authenticityJudgment,
    ]
    const weights = [this.weights.relevance, this.weights.legality, this.weights.authenticity]
    let total = 0
    let weightSum = 0
    dims.forEach((d, i) => {
      const weight = weights[i]
      /* v8 ignore next -- judge() always sets all three dimension judgments and weights are numbers */
      if (d !== undefined && weight !== undefined) {
        total += d.score * weight
        weightSum += weight
      }
    })
    if (weightSum === 0) return 0.5
    let base = total / weightSum

    const ts = judgment.typeSpecificJudgment
    if (ts?.credibilityScore !== undefined) {
      const modifier = 0.9 + 0.2 * ts.credibilityScore
      base *= modifier
    }
    // 0-1 评分契约：可信度修正可能使综合分超过 1.0（官方平台 0.95 → 修正 1.09），必须截断
    return Math.min(1, base)
  }

  private buildReasoning(judgment: EvidenceJudgment, evType: EvidenceType): string {
    const parts: string[] = []
    /* v8 ignore next 2 -- judge() always sets the relevance judgment */
    if (judgment.relevanceJudgment !== undefined) {
      parts.push(`关联性[${judgment.relevanceJudgment.level}]: ${judgment.relevanceJudgment.reasoning}`)
    }
    /* v8 ignore next 2 -- judge() always sets the legality judgment */
    if (judgment.legalityJudgment !== undefined) {
      parts.push(`合法性[${judgment.legalityJudgment.level}]: ${judgment.legalityJudgment.reasoning}`)
    }
    /* v8 ignore next 2 -- judge() always sets the authenticity judgment */
    if (judgment.authenticityJudgment !== undefined) {
      parts.push(`真实性[${judgment.authenticityJudgment.level}]: ${judgment.authenticityJudgment.reasoning}`)
    }
    const ts = judgment.typeSpecificJudgment
    /* v8 ignore next -- judge() always sets the type-specific judgment */
    if (ts !== undefined) {
      switch (evType) {
        case 'internet_publication': {
          const dd = ts.dateDetermination
          /* v8 ignore next -- internet_publication always carries a date determination */
          const dateStr = dd !== undefined ? `${dd.determined}(${dd.reliability}/${dd.sourceType})` : '未知'
          /* v8 ignore next -- internet_publication always sets platform credibility, integrity and intent */
          parts.push(
            `类型检查[互联网公开]: 日期=${dateStr}, 可信度=${ts.platformCredibility ?? '未知'}(${(ts.credibilityScore ?? 0).toFixed(2)}), 完整性=${ts.contentIntegrity ?? '未知'}, 意图=${ts.publicIntent ?? '未知'}`,
          )
          break
        }
        case 'electronic':
          /* v8 ignore next -- electronic always sets platform credibility and score */
          parts.push(
            `类型检查[电子证据]: 可信度=${ts.platformCredibility ?? '未知'}(${(ts.credibilityScore ?? 0).toFixed(2)})`,
          )
          break
        case 'public_use': {
          const fe = ts.fourElementsCheck
          /* v8 ignore next -- public_use always sets fourElements, burden difficulty and chain integrity */
          parts.push(
            `类型检查[使用公开]: 四要件=${fe === undefined ? '未评估' : fe.allMet ? '全部满足' : '未全部满足'}, 举证难度=${ts.burdenDifficulty ?? '未知'}, 证据链=${ts.chainIntegrity ?? '未知'}`,
          )
          break
        }
        case 'common_knowledge':
          parts.push(`类型检查[公知常识]: ${ts.exemptionApplied ?? '已完成'}`)
          break
        default:
          parts.push(`类型检查[${evType}]: 已完成`)
          break
      }
    }
    /* v8 ignore next -- the three dimension judgments above always populate parts */
    return parts.length === 0 ? '未执行评估' : parts.join('; ')
  }
}
