/**
 * Decide one citation against the loaded legal-law index.
 *
 * The decision never silently passes: an article that is indexed but whose text
 * has not been transcribed is `unverified`, not `valid`. What a deployment does
 * with each decision is a policy choice.
 * @module @deepseek-ai/dsh-legal-law/verify
 */

import { findLegalArticle } from './baseline.ts'
import { extractLegalLawReferences, formatLegalLawReference } from './reference.ts'
import {
  createLegalOverlapIndex,
  LEGAL_PROPOSITION_SUPPORT_DEFAULT,
  legalTextOverlap,
  legalTopicOverlap,
  type LegalComparableEntry,
  type LegalOverlapIndex,
} from './support.ts'
import type {
  LegalArticleEntry,
  LegalCitationDecision,
  LegalCitationFinding,
  LegalCitationPolicy,
  LegalCitationPolicySet,
  LegalLawBaseline,
  LegalLawName,
  LegalLawReference,
} from './types.ts'

/**
 * Default policy: an article beyond a verified ceiling blocks; an entry whose
 * text is still awaiting transcription, and a proposition no entry carries,
 * are reported without blocking.
 */
export const DEFAULT_LEGAL_CITATION_POLICY: LegalCitationPolicySet = {
  mismatch: 'block',
  unmatched: 'warn',
  outOfRange: 'block',
  notIndexed: 'warn',
  unverified: 'warn',
}

/** Options for one verification call. */
export type LegalVerifyOptions = {
  /** The proposition the citation is offered in support of, when the caller has one. */
  proposition?: string
  /** Overlap a proposition must reach before an entry's text supports it. */
  supportThreshold?: number
}

/**
 * Verify one reference against the loaded index.
 * @param reference - the parsed reference.
 * @param baselines - the loaded index, keyed by law name.
 * @param options - the proposition the citation supports, when there is one.
 * @returns the finding, carrying the reason and the entry it used.
 */
export function verifyLegalCitation(
  reference: LegalLawReference,
  baselines: Map<LegalLawName, LegalLawBaseline>,
  options: LegalVerifyOptions = {},
): LegalCitationFinding {
  const baseline = baselines.get(reference.law)
  if (baseline === undefined) {
    return {
      raw: reference.raw,
      reference,
      decision: 'not-indexed',
      reason: `本次部署没有随包索引《${reference.law}》，该引用无法核验`,
    }
  }
  return verifyArticle(reference, baseline, options)
}

/**
 * Verify every reference in a text.
 * @param text - the text to scan and verify.
 * @param baselines - the loaded index, keyed by law name.
 * @param options - the proposition the text supports, when there is one.
 * @returns the findings, in order of appearance.
 */
export function verifyLegalCitations(
  text: string,
  baselines: Map<LegalLawName, LegalLawBaseline>,
  options: LegalVerifyOptions = {},
): LegalCitationFinding[] {
  return extractLegalLawReferences(text).map(reference => verifyLegalCitation(reference, baselines, options))
}

/**
 * Resolve how a finding is treated.
 * @param finding - the finding.
 * @param policies - the deployment's per-decision policy.
 * @returns `allow`, `warn`, or `block`.
 */
export function resolveLegalCitationPolicy(finding: LegalCitationFinding, policies: LegalCitationPolicySet): LegalCitationPolicy {
  if (finding.decision === 'valid') return 'allow'
  return policies[LEGAL_DECISION_POLICY_KEYS[finding.decision]]
}

/** Which policy field each non-`valid` decision reads. */
const LEGAL_DECISION_POLICY_KEYS: Record<Exclude<LegalCitationDecision, 'valid'>, keyof LegalCitationPolicySet> = {
  'mismatch': 'mismatch',
  'unmatched': 'unmatched',
  'out-of-range': 'outOfRange',
  'not-indexed': 'notIndexed',
  'unverified': 'unverified',
}

/**
 * Render the findings as a Markdown table for the model.
 * @param findings - the findings to render.
 * @param policies - the policy used, so each row states how it is treated.
 * @returns the Markdown report.
 */
export function renderLegalCitationFindings(findings: LegalCitationFinding[], policies: LegalCitationPolicySet): string {
  return renderLegalCitationRows(findings.map(finding => ({
    label: formatLegalLawReference(finding.reference),
    decision: finding.decision,
    policy: resolveLegalCitationPolicy(finding, policies),
    reason: finding.reason,
  })))
}

/** One rendered citation: what was cited, how it was decided, and how it is treated. */
export type LegalCitationRow = {
  /** The citation as it should be shown. */
  label: string
  decision: LegalCitationDecision
  policy: LegalCitationPolicy
  reason: string
}

/**
 * Render citation rows as a Markdown table.
 * @param rows - the rows to render.
 * @returns the Markdown report.
 */
export function renderLegalCitationRows(rows: LegalCitationRow[]): string {
  if (rows.length === 0) {
    return '未在文本中识别到法条引用。\n\n注意：没有引用不等于引用正确——结论性论断仍须给出可核验的来源。'
  }
  return [
    '| 引用 | 判定 | 处置 | 说明 |',
    '|---|---|---|---|',
    ...rows.map(row => `| ${cell(row.label)} | ${LEGAL_DECISION_LABELS[row.decision]} | ${LEGAL_POLICY_LABELS[row.policy]} | ${cell(row.reason)} |`),
  ].join('\n')
}

/** Escape a table cell so a proposition containing `|` cannot split the row. */
function cell(value: string): string {
  return value.replaceAll('|', '\\|')
}

const LEGAL_DECISION_LABELS: Record<LegalCitationDecision, string> = {
  'valid': '已核验',
  'mismatch': '与所引命题不符',
  'unmatched': '未与条文对应（未判定）',
  'out-of-range': '条号超出有效范围',
  'not-indexed': '索引中不存在',
  'unverified': '条文未转录（未核验）',
}

const LEGAL_POLICY_LABELS: Record<LegalCitationPolicy, string> = {
  block: '拦截',
  warn: '警告',
  allow: '放行',
}

/** Build one finding, omitting the entry when the decision used none. */
function finding(
  reference: LegalLawReference,
  decision: LegalCitationDecision,
  reason: string,
  entry?: LegalArticleEntry,
): LegalCitationFinding {
  return {
    raw: reference.raw,
    reference,
    decision,
    reason,
    ...(entry === undefined ? {} : { entry }),
  }
}

/**
 * Decide a citation whose entry is transcribed, against the proposition the
 * citation is offered in support of.
 */
function decideTranscribed(
  reference: LegalLawReference,
  entry: LegalArticleEntry,
  text: string,
  baseline: LegalLawBaseline,
  options: LegalVerifyOptions,
  validReason: string,
): LegalCitationFinding {
  const proposition = options.proposition?.trim()
  if (proposition === undefined || proposition === '') return finding(reference, 'valid', validReason, entry)
  const threshold = options.supportThreshold ?? LEGAL_PROPOSITION_SUPPORT_DEFAULT
  const index = legalOverlapIdx(baseline)
  const overlap = legalTextOverlap(index, proposition, text)
  if (legalTopicOverlap(entry.topics, proposition) || overlap >= threshold) {
    return finding(reference, 'valid', validReason, entry)
  }
  const elsewhere = supportingLabels(baseline, index, proposition, threshold, `第 ${entry.article} 条`)
  if (elsewhere.length > 0) {
    return finding(reference, 'mismatch', mismatchReason(baseline, proposition, elsewhere), entry)
  }
  return finding(
    reference,
    'unmatched',
    `所引条目的文本与命题「${truncate(proposition)}」的字面重合 ${percent(overlap)}，低于支撑阈值 ${percent(threshold)}，且本索引中没有条目支撑该命题——请核对条号或改写命题`,
    entry,
  )
}

/** The overlap indices of the loaded baselines. */
const legalOverlapIndices = new WeakMap<LegalLawBaseline, LegalOverlapIndex>()

/**
 * Get the overlap index of one baseline.
 * @param baseline - the loaded baseline.
 * @returns its index, built on first use.
 */
function legalOverlapIdx(baseline: LegalLawBaseline): LegalOverlapIndex {
  const cached = legalOverlapIndices.get(baseline)
  if (cached !== undefined) return cached
  const built = createLegalOverlapIndex(comparableEntries(baseline))
  legalOverlapIndices.set(baseline, built)
  return built
}

/**
 * List every entry of a baseline as a proposition candidate.
 * @param baseline - the loaded baseline.
 * @returns the law's articles.
 */
function comparableEntries(baseline: LegalLawBaseline): LegalComparableEntry[] {
  return baseline.articles.map(article => ({
    label: `第 ${article.article} 条`,
    topics: article.topics,
    text: transcribedText(article),
  }))
}

/**
 * The text a proposition may be matched against.
 * @param entry - the article entry.
 * @returns its text when the transcription record is complete, otherwise null.
 */
function transcribedText(entry: {
  text: string | null
  sourceDoc: string | null
  verifiedOn: string | null
}): string | null {
  return entry.text !== null && entry.sourceDoc !== null && entry.verifiedOn !== null ? entry.text : null
}

/**
 * Find the entries of the cited entry's law that carry the proposition instead.
 * @param baseline - the law's baseline.
 * @param index - the baseline's overlap index.
 * @param proposition - the claim the citation is offered in support of.
 * @param threshold - overlap at which transcribed text counts as support.
 * @param cited - the cited entry's label, which is excluded.
 * @returns the labels of the entries that carry the proposition, at most three.
 */
function supportingLabels(
  baseline: LegalLawBaseline,
  index: LegalOverlapIndex,
  proposition: string,
  threshold: number,
  cited: string,
): string[] {
  return comparableEntries(baseline)
    .filter(entry => entry.label !== cited)
    .filter(entry => legalTopicOverlap(entry.topics, proposition)
      || (entry.text !== null && legalTextOverlap(index, proposition, entry.text) >= threshold))
    .map(entry => entry.label)
    .slice(0, 3)
}

/** The reason a citation reports when another entry of the law carries the proposition. */
function mismatchReason(baseline: LegalLawBaseline, proposition: string, elsewhere: readonly string[]): string {
  return `所引条目未被该命题支撑：《${baseline.law}》${elsewhere.join('、')}更贴近命题「${truncate(proposition)}」`
}

/** Render a 0–1 score as a whole percentage for a reason line. */
function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`
}

/** Verify one statute-article reference. */
function verifyArticle(
  reference: LegalLawReference,
  baseline: LegalLawBaseline,
  options: LegalVerifyOptions,
): LegalCitationFinding {
  const entry = findLegalArticle(baseline, reference.article)
  if (entry === undefined) return articleGap(reference, baseline)
  if (entry.verifiedOn === null || entry.text === null || entry.sourceDoc === null) {
    return finding(
      reference,
      'unverified',
      `《${baseline.law}》第 ${reference.article} 条已索引，但条文尚未转录核验（条目主题：${entry.topics.join('、')}）`,
      entry,
    )
  }
  const narrowing = checkNarrowing(reference, entry)
  if (narrowing !== null) return finding(reference, 'mismatch', narrowing, entry)
  return decideTranscribed(
    reference,
    entry,
    entry.text,
    baseline,
    options,
    `与《${baseline.law}》第 ${reference.article} 条一致（来源：${entry.sourceDoc}）`,
  )
}

/**
 * Decide an article the index does not hold.
 */
function articleGap(
  reference: LegalLawReference,
  baseline: LegalLawBaseline,
): LegalCitationFinding {
  if (baseline.maxArticle !== null && baseline.maxVerifiedOn !== null && reference.article > baseline.maxArticle) {
    return finding(reference, 'out-of-range', `《${baseline.law}》共 ${baseline.maxArticle} 条，第 ${reference.article} 条不存在`)
  }
  if (baseline.maxArticle !== null && reference.article > baseline.maxArticle) {
    return finding(
      reference,
      'unverified',
      `第 ${reference.article} 条超出索引声明的上限 ${baseline.maxArticle} 条，但该上限本身尚未核验`,
    )
  }
  return finding(reference, 'not-indexed', `《${baseline.law}》第 ${reference.article} 条不在索引中`)
}

/** Report a cited paragraph the entry knows to be absent, or null when it is consistent. */
function checkNarrowing(
  reference: LegalLawReference,
  entry: LegalArticleEntry,
): string | null {
  if (reference.paragraph === undefined || entry.paragraphs === undefined) return null
  if (entry.paragraphs.includes(reference.paragraph)) return null
  return `第 ${entry.article} 条索引载明共 ${entry.paragraphs.length} 款，不含第 ${reference.paragraph} 款`
}

/** Truncate a proposition for a report line. */
function truncate(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`
}
