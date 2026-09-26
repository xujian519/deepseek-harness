/**
 * Decide one citation against the loaded law index.
 *
 * The decision never silently passes: an article that is indexed but whose text
 * has not been transcribed is `unverified`, not `valid`, and an article that is
 * beyond a *verified* article ceiling is `out-of-range`. What a deployment does
 * with each decision is a policy choice, so the decisions stay separate from the
 * policies that act on them.
 * @module @deepseek-ai/dsh-patent-law/verify
 */

import { findArticle, findSection } from './baseline.ts'
import { extractLawReferences, formatLawReference } from './reference.ts'
import type {
  ArticleEntry,
  CitationDecision,
  CitationFinding,
  CitationPolicy,
  CitationPolicySet,
  LawBaseline,
  LawName,
  LawReference,
  SectionEntry,
} from './types.ts'

/**
 * Default policy: an article beyond a verified ceiling, or a proposition that
 * contradicts a verified article, blocks; an entry whose text is still awaiting
 * transcription is reported without blocking, so a partially transcribed index
 * stays usable while every gap in it is visible.
 */
export const DEFAULT_CITATION_POLICY: CitationPolicySet = {
  mismatch: 'block',
  outOfRange: 'block',
  notIndexed: 'warn',
  unverified: 'warn',
}

/** Options for one verification call. */
export type VerifyOptions = {
  /** The proposition the citation is offered in support of, when the caller has one. */
  proposition?: string
}

/**
 * Verify one reference against the loaded index.
 * @param reference - the parsed reference.
 * @param baselines - the loaded index, keyed by law name.
 * @param options - the proposition the citation supports, when there is one.
 * @returns the finding, carrying the reason and the entry it used.
 */
export function verifyCitation(
  reference: LawReference,
  baselines: Map<LawName, LawBaseline>,
  options: VerifyOptions = {},
): CitationFinding {
  const baseline = baselines.get(reference.law)
  if (baseline === undefined) {
    return {
      raw: reference.raw,
      reference,
      decision: 'not-indexed',
      reason: `本次部署没有随包索引《${reference.law}》，该引用无法核验`,
    }
  }
  if (reference.kind === 'guideline-section') return verifySection(reference, baseline, options)
  return verifyArticle(reference, baseline, options)
}

/**
 * Verify every reference in a text.
 * @param text - the text to scan and verify.
 * @param baselines - the loaded index, keyed by law name.
 * @param options - the proposition the text supports, when there is one.
 * @returns the findings, in order of appearance.
 */
export function verifyCitations(
  text: string,
  baselines: Map<LawName, LawBaseline>,
  options: VerifyOptions = {},
): CitationFinding[] {
  return extractLawReferences(text).map(reference => verifyCitation(reference, baselines, options))
}

/**
 * Resolve how a finding is treated.
 *
 * The decision union is closed and the map below is exhaustive over it, so a new
 * decision fails to compile until it is given a policy.
 * @param finding - the finding.
 * @param policies - the deployment's per-decision policy.
 * @returns `allow`, `warn`, or `block`.
 */
export function resolveCitationPolicy(finding: CitationFinding, policies: CitationPolicySet): CitationPolicy {
  if (finding.decision === 'valid') return 'allow'
  return policies[DECISION_POLICY_KEYS[finding.decision]]
}

/** Which policy field each non-`valid` decision reads. */
const DECISION_POLICY_KEYS: Record<Exclude<CitationDecision, 'valid'>, keyof CitationPolicySet> = {
  'mismatch': 'mismatch',
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
export function renderCitationFindings(findings: CitationFinding[], policies: CitationPolicySet): string {
  return renderCitationRows(findings.map(finding => ({
    label: formatLawReference(finding.reference),
    decision: finding.decision,
    policy: resolveCitationPolicy(finding, policies),
    reason: finding.reason,
  })))
}

/** One rendered citation: what was cited, how it was decided, and how it is treated. */
export type CitationRow = {
  /** The citation as it should be shown. */
  label: string
  decision: CitationDecision
  policy: CitationPolicy
  reason: string
}

/**
 * Render citation rows as a Markdown table.
 * @param rows - the rows to render.
 * @returns the Markdown report.
 */
export function renderCitationRows(rows: CitationRow[]): string {
  if (rows.length === 0) {
    return '未在文本中识别到法条引用。\n\n注意：没有引用不等于引用正确——结论性论断仍须给出可核验的来源。'
  }
  return [
    '| 引用 | 判定 | 处置 | 说明 |',
    '|---|---|---|---|',
    ...rows.map(row => `| ${row.label} | ${DECISION_LABELS[row.decision]} | ${POLICY_LABELS[row.policy]} | ${row.reason} |`),
  ].join('\n')
}

const DECISION_LABELS: Record<CitationDecision, string> = {
  'valid': '已核验',
  'mismatch': '与所引命题不符',
  'out-of-range': '条号超出有效范围',
  'not-indexed': '索引中不存在',
  'unverified': '条文未转录（未核验）',
}

const POLICY_LABELS: Record<CitationPolicy, string> = {
  block: '拦截',
  warn: '警告',
  allow: '放行',
}

/** Build one finding, omitting the entry when the decision used none. */
function finding(
  reference: LawReference,
  decision: CitationDecision,
  reason: string,
  entry?: ArticleEntry | SectionEntry,
): CitationFinding {
  return {
    raw: reference.raw,
    reference,
    decision,
    reason,
    ...(entry === undefined ? {} : { entry }),
  }
}

/** Decide a citation whose entry is transcribed: a mismatch, or the supported citation. */
function decideTranscribed(
  reference: LawReference,
  entry: ArticleEntry | SectionEntry,
  proposition: string | undefined,
  validReason: string,
): CitationFinding {
  const mismatch = matchProposition(entry, proposition)
  if (mismatch !== null) return finding(reference, 'mismatch', mismatch, entry)
  return finding(reference, 'valid', validReason, entry)
}

/** Verify one statute-article reference. */
function verifyArticle(
  reference: Extract<LawReference, { kind: 'law-article' }>,
  baseline: LawBaseline,
  options: VerifyOptions,
): CitationFinding {
  const entry = findArticle(baseline, reference.article)
  if (entry === undefined) return articleGap(reference, baseline)
  const narrowing = checkNarrowing(reference, entry)
  if (narrowing !== null) return finding(reference, 'mismatch', narrowing, entry)
  if (entry.verifiedOn === null || entry.text === null) {
    return finding(
      reference,
      'unverified',
      `《${baseline.law}》第 ${reference.article} 条已索引，但条文尚未转录核验（条目主题：${entry.topics.join('、')}）`,
      entry,
    )
  }
  return decideTranscribed(
    reference,
    entry,
    options.proposition,
    `与《${baseline.law}》第 ${reference.article} 条一致（来源：${entry.sourceDoc ?? '未标注'}）`,
  )
}

/**
 * Decide an article the index does not hold. Only a *verified* article ceiling
 * proves a number does not exist; beyond an unverified ceiling the answer is that
 * nothing here can say.
 */
function articleGap(
  reference: Extract<LawReference, { kind: 'law-article' }>,
  baseline: LawBaseline,
): CitationFinding {
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

/** Verify one guideline-section reference. */
function verifySection(
  reference: Extract<LawReference, { kind: 'guideline-section' }>,
  baseline: LawBaseline,
  options: VerifyOptions,
): CitationFinding {
  const entry = findSection(baseline, reference.path)
  if (entry === undefined) {
    return finding(reference, 'not-indexed', `《专利审查指南》${reference.path} 不在索引中`)
  }
  if (entry.verifiedOn === null || entry.text === null) {
    return finding(
      reference,
      'unverified',
      `《专利审查指南》${reference.path} 已索引，但章节内容尚未转录核验`,
      entry,
    )
  }
  return decideTranscribed(
    reference,
    entry,
    options.proposition,
    `与《专利审查指南》${reference.path} 一致（来源：${entry.sourceDoc ?? '未标注'}）`,
  )
}

/** Report a cited paragraph the entry knows to be absent, or null when it is consistent. */
function checkNarrowing(
  reference: Extract<LawReference, { kind: 'law-article' }>,
  entry: ArticleEntry,
): string | null {
  if (reference.paragraph === undefined || entry.paragraphs === undefined) return null
  if (entry.paragraphs.includes(reference.paragraph)) return null
  return `第 ${entry.article} 条索引载明共 ${entry.paragraphs.length} 款，不含第 ${reference.paragraph} 款`
}

/** Report a proposition the verified entry does not support, or null when it matches or is absent. */
function matchProposition(entry: ArticleEntry | SectionEntry, proposition: string | undefined): string | null {
  if (proposition === undefined || proposition.trim() === '') return null
  const needle = proposition.trim()
  const matched = entry.topics.some(topic => needle.includes(topic) || topic.includes(needle))
  if (matched) return null
  return `该条目主题为「${entry.topics.join('、')}」，未支撑所引命题「${truncate(needle)}」`
}

/** Truncate a proposition for a report line. */
function truncate(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`
}
