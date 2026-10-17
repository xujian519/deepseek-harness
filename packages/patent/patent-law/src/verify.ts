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
import {
  createOverlapIndex,
  PROPOSITION_SUPPORT_DEFAULT,
  textOverlap,
  topicOverlap,
  type ComparableEntry,
  type OverlapIndex,
} from './support.ts'
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
 * transcription, and a proposition no entry carries, are reported without
 * blocking, so a partially transcribed index stays usable while every gap in it
 * is visible.
 */
export const DEFAULT_CITATION_POLICY: CitationPolicySet = {
  mismatch: 'block',
  unmatched: 'warn',
  outOfRange: 'block',
  notIndexed: 'warn',
  unverified: 'warn',
}

/** Options for one verification call. */
export type VerifyOptions = {
  /** The proposition the citation is offered in support of, when the caller has one. */
  proposition?: string
  /** Overlap a proposition must reach before an entry's text supports it; defaults to {@link PROPOSITION_SUPPORT_DEFAULT}. */
  supportThreshold?: number
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
  'unmatched': '未与条文对应（未判定）',
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

/**
 * Decide a citation whose entry is transcribed, against the proposition the
 * citation is offered in support of.
 *
 * The entry itself must carry the proposition first, by its topic keywords or by
 * its own transcribed wording. Only when it does not, and another entry of the
 * same law does, is the citation reported as a mismatch — so a proposition
 * reworded around a synonym this index cannot see is reported as undecided
 * rather than as a contradiction.
 * @param reference - the parsed reference.
 * @param entry - the indexed entry the reference resolved to.
 * @param text - the entry's transcribed text, which the caller has established is present.
 * @param baseline - the law's baseline, whose other entries are the competing homes.
 * @param options - the proposition and the support threshold.
 * @param validReason - the reason a supported citation reports.
 * @returns the finding.
 */
function decideTranscribed(
  reference: Extract<LawReference, { kind: 'law-article' }>,
  entry: ArticleEntry,
  text: string,
  baseline: LawBaseline,
  options: VerifyOptions,
  validReason: string,
): CitationFinding {
  const proposition = options.proposition?.trim()
  if (proposition === undefined || proposition === '') return finding(reference, 'valid', validReason, entry)
  const threshold = options.supportThreshold ?? PROPOSITION_SUPPORT_DEFAULT
  const index = overlapIndex(baseline)
  const overlap = textOverlap(index, proposition, text)
  if (topicOverlap(entry.topics, proposition) || overlap >= threshold) {
    return finding(reference, 'valid', validReason, entry)
  }
  const elsewhere = supportingLabels(baseline, index, proposition, threshold, `第 ${entry.article} 条`)
  if (elsewhere.length > 0) {
    return finding(
      reference,
      'mismatch',
      `所引条目未被该命题支撑：《${baseline.law}》${elsewhere.join('、')}更贴近命题「${truncate(proposition)}」`,
      entry,
    )
  }
  return finding(
    reference,
    'unmatched',
    `所引条目的文本与命题「${truncate(proposition)}」的字面重合 ${percent(overlap)}，低于支撑阈值 ${percent(threshold)}，且本索引中没有条目支撑该命题——请核对条号或改写命题`,
    entry,
  )
}

/** The overlap indices of the loaded baselines, so a baseline's texts are indexed once. */
const overlapIndices = new WeakMap<LawBaseline, OverlapIndex>()

/**
 * Get the overlap index of one baseline.
 * @param baseline - the loaded baseline.
 * @returns its index, built on first use.
 */
function overlapIndex(baseline: LawBaseline): OverlapIndex {
  const cached = overlapIndices.get(baseline)
  if (cached !== undefined) return cached
  const built = createOverlapIndex(comparableEntries(baseline))
  overlapIndices.set(baseline, built)
  return built
}

/**
 * List every entry of a baseline as a proposition candidate.
 * @param baseline - the loaded baseline.
 * @returns the law's articles or its guideline sections.
 */
function comparableEntries(baseline: LawBaseline): ComparableEntry[] {
  if (baseline.sections.length > 0) {
    return baseline.sections.map(section => ({ label: section.path, topics: section.topics, text: section.text }))
  }
  return baseline.articles.map(article => ({
    label: `第 ${article.article} 条`,
    topics: article.topics,
    text: article.text,
  }))
}

/**
 * Find the entries of the cited entry's law that carry the proposition instead.
 *
 * A subsection of a cited section is not a competing home: the citation covers it.
 * @param baseline - the law's baseline.
 * @param index - the baseline's overlap index.
 * @param proposition - the claim the citation is offered in support of.
 * @param threshold - overlap at which transcribed text counts as support.
 * @param cited - the cited entry's label, which is excluded.
 * @returns the labels of the entries that carry the proposition, at most three.
 */
function supportingLabels(
  baseline: LawBaseline,
  index: OverlapIndex,
  proposition: string,
  threshold: number,
  cited: string,
): string[] {
  const nested = baseline.sections.length > 0
  return comparableEntries(baseline)
    .filter(entry => entry.label !== cited)
    .filter(entry => !(nested && coversSection(cited, entry.label)))
    .filter(entry => topicOverlap(entry.topics, proposition)
      || (entry.text !== null && textOverlap(index, proposition, entry.text) >= threshold))
    .map(entry => entry.label)
    .slice(0, 3)
}

/** Render a 0–1 score as a whole percentage for a reason line. */
function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`
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
    entry.text,
    baseline,
    options,
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

/** One transcribed guideline text a proposition can be matched against. */
type SectionText = {
  /** Normalized path of the section or subsection this text belongs to. */
  path: string
  /** Topic keywords the entry declares. */
  topics: string[]
  /** Transcribed section text. */
  text: string
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
  const candidates = sectionTexts(baseline, reference.path)
  if (candidates.length === 0) {
    return finding(
      reference,
      'unverified',
      `《专利审查指南》${reference.path} 已索引，但本节及其子节的正文尚未转录核验`,
      entry,
    )
  }
  return decideSection(reference, entry, candidates, baseline, options)
}

/**
 * The transcribed texts one guideline citation covers: the cited section's own
 * body and every subsection under it.
 *
 * A citation to a section covers what its subsections say, so the proposition is
 * matched against the whole section. A part or chapter carries no text of its own
 * and is decided by its sections alone.
 * @param baseline - the guideline baseline.
 * @param path - the cited normalized section path.
 * @returns the texts to match against, the cited section first when it has one.
 */
function sectionTexts(baseline: LawBaseline, path: string): SectionText[] {
  return baseline.sections
    .filter((section): section is SectionEntry & { text: string } =>
      section.text !== null && coversSection(path, section.path))
    .map(section => ({ path: section.path, topics: section.topics, text: section.text }))
}

/**
 * Whether one section path names the cited section or a section under it.
 * @param cited - the cited normalized section path.
 * @param path - the path to test.
 * @returns true when the path is the cited one or below it.
 */
function coversSection(cited: string, path: string): boolean {
  if (path === cited) return true
  if (!path.startsWith(cited)) return false
  const rest = path.slice(cited.length)
  // A level inside a section number follows a dot, so 2.10 is not under 2.1. A
  // part or a chapter states the next part, chapter or section number directly,
  // as 第二部分第二章 and 第一部分第一章4.2 do.
  return /\d$/u.test(cited) ? rest.startsWith('.') : /^[第0-9]/u.test(rest)
}

/**
 * Decide a guideline citation. A proposition its own section carries is supported;
 * so is one carried by a subsection, which the citation covers; so is one whose
 * subject the section's topic keywords name. Only when none of those hold, and an
 * unrelated entry of the guideline carries the proposition, is the citation
 * reported as a mismatch.
 * @param reference - the parsed reference.
 * @param entry - the indexed section the reference resolved to.
 * @param candidates - the transcribed texts of the section and its subsections.
 * @param baseline - the guideline's baseline, whose other entries are the competing homes.
 * @param options - the proposition and the support threshold.
 * @returns the finding.
 */
function decideSection(
  reference: Extract<LawReference, { kind: 'guideline-section' }>,
  entry: SectionEntry,
  candidates: readonly SectionText[],
  baseline: LawBaseline,
  options: VerifyOptions,
): CitationFinding {
  const proposition = options.proposition?.trim()
  const hasOwn = candidates.some(candidate => candidate.path === reference.path)
  if (proposition === undefined || proposition === '') {
    return finding(reference, 'valid', sectionReason(reference.path, entry, null, hasOwn), entry)
  }
  const threshold = options.supportThreshold ?? PROPOSITION_SUPPORT_DEFAULT
  const index = overlapIndex(baseline)
  const scored = candidates.map(candidate => ({
    candidate,
    score: textOverlap(index, proposition, candidate.text),
  }))
  const carrier = scored.find(({ candidate, score }) =>
    score >= threshold || topicOverlap(candidate.topics, proposition))
  if (carrier !== undefined) {
    return finding(
      reference,
      'valid',
      sectionReason(reference.path, entry, carrier.candidate.path, hasOwn),
      entry,
    )
  }
  const elsewhere = supportingLabels(baseline, index, proposition, threshold, reference.path)
  if (elsewhere.length > 0) {
    return finding(
      reference,
      'mismatch',
      `所引条目未被该命题支撑：《${baseline.law}》${elsewhere.join('、')}更贴近命题「${truncate(proposition)}」`,
      entry,
    )
  }
  const best = Math.max(0, ...scored.map(entry => entry.score))
  return finding(
    reference,
    'unmatched',
    hasOwn
      ? `本节及其子节的文本与命题「${truncate(proposition)}」的字面重合 ${percent(best)}，低于支撑阈值 ${percent(threshold)}，且本索引中没有条目支撑该命题——请核对节号或改写命题`
      : `《专利审查指南》${reference.path} 的节正文未转录，其下已转录的各节与命题「${truncate(proposition)}」都不相符——请核对节号或改写命题`,
    entry,
  )
}

/** The reason a supported guideline citation reports. */
function sectionReason(path: string, entry: SectionEntry, carrier: string | null, hasOwn: boolean): string {
  if (!hasOwn) {
    return `与《专利审查指南》${path} 一致（本节正文未单独转录，判定依据其下各节）`
  }
  if (carrier !== null && carrier !== path) {
    return `与《专利审查指南》${path} 一致（命题由本节下的 ${carrier} 承载）`
  }
  return `与《专利审查指南》${path} 一致（来源：${entry.sourceDoc ?? '未标注'}）`
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

/** Truncate a proposition for a report line. */
function truncate(value: string): string {
  return value.length <= 40 ? value : `${value.slice(0, 40)}…`
}
