/**
 * Legal-law reference parsing and formatting.
 *
 * Chinese legal citations arrive in mixed forms: `民法典第143条`, `民法典第一百四十三条`,
 * `民事诉讼法第66条第2款`. Everything downstream compares one normalized reference,
 * so the reference grammar lives here and nowhere else; the numeral reader
 * and the citation text helpers are shared with the patent-domain library.
 * @module @deepseek-ai/dsh-legal-law/reference
 */

import {
  articleReferenceIdentity,
  collectReferences,
  formatArticleCitation,
  formatCnNumber,
  normalizeCitationText,
  parseCnNumber,
  readArticleContinuations,
  readStatuteArticleCandidate,
  scanUnrecognizedReferences,
  stripBookMarks,
  trimPunctuation,
} from '@deepseek-ai/dsh-patent-core'
import type { LegalLawName, LegalLawReference } from './types.ts'

export { formatCnNumber, parseCnNumber }

/** Number written in Chinese numerals or Arabic digits. */
const NUMBER = '[〇零一二三四五六七八九十百0-9]{1,6}'

// The house style separates Chinese text from digits with spaces (民法典第 143 条),
// and a source copied out of a PDF may use full-width digits. Both are
// normalized before matching.

/**
 * Known full-law-name → short-name pairs used by the statute regex.
 * Extended at load time when new baselines are discovered.
 */
const STATUTE_NAMES: Record<string, LegalLawName> = {
  '民法典': '民法典',
  '中华人民共和国民法典': '民法典',
  '劳动合同法': '劳动合同法',
  '中华人民共和国劳动合同法': '劳动合同法',
  '公司法': '公司法',
  '中华人民共和国公司法': '公司法',
  '民事诉讼法': '民事诉讼法',
  '中华人民共和国民事诉讼法': '民事诉讼法',
}

/**
 * Build the statute-matching regex from the current set of known law names.
 * @param lawNames - short law names to include in the alternation.
 * @returns a global RegExp that captures the law name, article, paragraph, and item.
 */
function buildStatutePattern(lawNames: readonly string[]): RegExp {
  // Collect all name forms (short + full) for the alternation, longest first
  // so the greedy match prefers the longer form.
  const nameForms = new Set<string>()
  for (const [key] of Object.entries(STATUTE_NAMES)) {
    nameForms.add(key)
  }
  for (const name of lawNames) {
    nameForms.add(name)
  }
  // Sort longest-first so the regex prefers longer matches.
  const sorted = [...nameForms].sort((a, b) => b.length - a.length)
  const alternation = sorted.map(escapeRegExp).join('|')
  return new RegExp(
    `(?<law>${alternation})`
    + '\\s*》?\\s*第?\\s*(?<article>'
    + NUMBER
    + ')\\s*条'
    + `(?:\\s*第\\s*(?<paragraph>${NUMBER})\\s*款)?`
    + `(?:\\s*第\\s*(?:[（(]\\s*(?<itemParen>${NUMBER})\\s*[）)]|(?<item>${NUMBER}))\\s*项)?`,
    'g',
  )
}

/** Escape special regex characters in a string. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The initial set of law names used before baselines are loaded. */
const INITIAL_LAW_NAMES: readonly LegalLawName[] = ['民法典', '民事诉讼法', '劳动合同法', '公司法']

/** The active statute pattern; rebuilt when new baselines are loaded. */
let STATUTE_PATTERN: RegExp = buildStatutePattern(INITIAL_LAW_NAMES)

/**
 * Rebuild the statute-matching regex after new baselines have been loaded.
 * Called by {@link loadLegalLawBaselines} to keep the pattern in sync.
 * @param lawNames - all known short law names.
 */
export function rebuildStatutePattern(lawNames: readonly string[]): void {
  STATUTE_PATTERN = buildStatutePattern(lawNames)
}

/** The groups {@link STATUTE_PATTERN} always captures, typed for direct use. */
type StatuteGroups = {
  law: string
  article: string
  paragraph?: string
  item?: string
  itemParen?: string
}

/** One parsed candidate with its span in the scanned text. */
type Candidate = { start: number; end: number; reference: LegalLawReference }

/**
 * Parse one reference standing alone in `text`.
 * @param text - the candidate reference text.
 * @returns the parsed reference, or null when the text is not exactly one.
 */
export function parseLegalLawReference(text: string): LegalLawReference | null {
  const trimmed = trimPunctuation(normalizeCitationText(text))
  if (trimmed === '') return null
  const comparable = stripBookMarks(trimmed)
  return extractLegalLawReferences(trimmed).find(reference => reference.raw === comparable) ?? null
}

/**
 * Extract every legal-law reference in `text`, in order of appearance.
 * @param text - the text to scan.
 * @returns the parsed references.
 */
export function extractLegalLawReferences(text: string): LegalLawReference[] {
  const normalized = normalizeCitationText(text)
  const candidates: Candidate[] = []

  for (const match of normalized.matchAll(STATUTE_PATTERN)) {
    const groups = match.groups as StatuteGroups
    const lawName = STATUTE_NAMES[groups.law]
    if (lawName === undefined) continue
    const candidate = readStatuteArticleCandidate(match, groups, lawName)
    if (candidate !== null) candidates.push(candidate)
  }

  return collectReferences(
    candidates,
    normalized.length,
    (candidate, limit) => readArticleContinuations(normalized, candidate, limit),
    referenceIdentity,
  )
}

/**
 * Stable identity of a resolved reference.
 * @param reference - the resolved reference.
 * @returns a string equal for two references to the same provision.
 */
function referenceIdentity(reference: LegalLawReference): string {
  return articleReferenceIdentity(reference.law, reference.article, reference.paragraph, reference.item)
}

/**
 * A fragment that looks like a citation but was not resolved.
 */
const UNRECOGNIZED_PATTERN = new RegExp(
  `第\\s*${NUMBER}\\s*[条款项]`,
  'g',
)

/**
 * List the citation-like fragments in `text` that the parser did not resolve.
 * @param text - the text that was scanned.
 * @param recognized - the references the parser resolved.
 * @returns the unresolved fragments, deduplicated and capped at ten.
 */
export function scanUnrecognizedLegalCitations(text: string, recognized: readonly LegalLawReference[]): string[] {
  return scanUnrecognizedReferences(text, recognized, UNRECOGNIZED_PATTERN)
}

/**
 * Render a reference the way a formal Chinese document writes it.
 * @param reference - the reference to render.
 * @returns the rendered text.
 */
export function formatLegalLawReference(reference: LegalLawReference): string {
  return formatArticleCitation(reference)
}
