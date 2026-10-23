/**
 * Legal-law reference parsing and formatting.
 *
 * Chinese legal citations arrive in mixed forms: `民法典第143条`, `民法典第一百四十三条`,
 * `民事诉讼法第66条第2款`. Everything downstream compares one normalized reference,
 * so the reference grammar lives here and nowhere else; the numeral reader
 * itself is shared with the patent-domain library.
 * @module @deepseek-ai/dsh-legal-law/reference
 */

import { parseCnNumber } from '@deepseek-ai/dsh-patent-core'
import type { LegalLawName, LegalLawReference } from './types.ts'

export { parseCnNumber }

/** Chinese numeral digits, indexed by value; used for rendering. */
const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

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

/**
 * One reference that follows another in the same sentence and inherits its
 * context: `民法典第143条、第144条`, `第143条第2款、第3款`.
 */
const CONTINUATION_PATTERN = new RegExp(
  '\\s*[、，,和及与或]\\s*第\\s*'
  + `(?:[（(]\\s*(?<n1p>${NUMBER})\\s*[）)]|(?<n1>${NUMBER}))`
  + '\\s*(?<u1>条|款|项)'
  + `(?:\\s*第\\s*(?:[（(]\\s*(?<n2p>${NUMBER})\\s*[）)]|(?<n2>${NUMBER}))\\s*(?<u2>款|项))?`
  + `(?:\\s*第\\s*(?:[（(]\\s*(?<n3p>${NUMBER})\\s*[）)]|(?<n3>${NUMBER}))\\s*项)?`,
  'y',
)

/** The groups {@link STATUTE_PATTERN} always captures, typed for direct use. */
type StatuteGroups = {
  law: string
  article: string
  paragraph?: string
  item?: string
  itemParen?: string
}

/** The groups {@link CONTINUATION_PATTERN} captures, typed for direct use. */
type ContinuationGroups = {
  n1: string
  n1p?: string
  u1: string
  n2?: string
  n2p?: string
  u2?: string
  n3?: string
  n3p?: string
}

/** One parsed candidate with its span in the scanned text. */
type Candidate = { start: number; end: number; reference: LegalLawReference }

/**
 * Normalize the forms a copied citation may carry before matching: full-width
 * digits, Latin letters, and full-width brackets become ASCII.
 * @param text - the text to normalize.
 * @returns the normalized text.
 */
function normalizeCitationText(text: string): string {
  return text.normalize('NFKC')
}

/**
 * Render a number in Chinese numerals, the form a formal Chinese document uses.
 * @param value - an integer from 0 through 999.
 * @returns the Chinese numeral text.
 * @throws RangeError when the value is not an integer in that range.
 */
export function formatCnNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    throw new RangeError(`formatCnNumber expects an integer in 0..999, received ${value}`)
  }
  if (value === 0) return '〇'
  if (value < 10) return cnDigit(value)
  const hundreds = Math.floor(value / 100)
  const tens = Math.floor((value % 100) / 10)
  const ones = value % 10
  const parts: string[] = []
  if (hundreds > 0) parts.push(`${cnDigit(hundreds)}百`)
  if (tens > 0) parts.push(tens === 1 && hundreds === 0 ? '十' : `${cnDigit(tens)}十`)
  else if (hundreds > 0 && ones > 0) parts.push('零')
  if (ones > 0) parts.push(cnDigit(ones))
  return parts.join('')
}

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
 * Record one pattern match and the reference it resolved to.
 * @param candidates - the candidate list being built.
 * @param match - the pattern match.
 * @param reference - the reference the match resolved to.
 */
function addCandidate(candidates: Candidate[], match: RegExpExecArray, reference: LegalLawReference): void {
  candidates.push({
    start: match.index,
    end: match.index + match[0].length,
    reference,
  })
}

/**
 * Resolve the references that follow `base` in the same sentence and inherit
 * its law, article, paragraph, or item.
 * @param text - the normalized text.
 * @param base - the base match whose context is inherited.
 * @param limit - the end of the gap to scan.
 * @returns the continuation candidates.
 */
function readContinuations(text: string, base: Candidate, limit: number): Candidate[] {
  const reference = base.reference
  const out: Candidate[] = []
  let cursor = 0
  let article = reference.article
  let paragraph = reference.paragraph
  let item = reference.item
  while (cursor < limit - base.end) {
    CONTINUATION_PATTERN.lastIndex = cursor
    const gap = text.slice(base.end, limit)
    const match = CONTINUATION_PATTERN.exec(gap)
    if (match === null) break
    const groups = match.groups as ContinuationGroups
    const units: Array<{ unit: string; value: number }> = []
    const first = readContinuationUnit(groups.n1p ?? groups.n1, groups.u1, groups.n1p !== undefined)
    if (first === null) break
    units.push(first)
    if (groups.u2 !== undefined) {
      const second = readContinuationUnit(
        (groups.n2p ?? groups.n2) as string,
        groups.u2,
        groups.n2p !== undefined,
      )
      if (second === null) break
      units.push(second)
    }
    if (groups.n3 !== undefined || groups.n3p !== undefined) {
      const third = readContinuationUnit(
        (groups.n3p ?? groups.n3) as string,
        '项',
        groups.n3p !== undefined,
      )
      if (third === null) break
      units.push(third)
    }
    if (!narrowingUnits(units)) break
    for (const { unit, value } of units) {
      if (unit === '条') {
        article = value
        paragraph = undefined
        item = undefined
      } else if (unit === '款') {
        paragraph = value
        item = undefined
      } else {
        item = value
      }
    }
    const startInGap = match.index + match[0].indexOf('第')
    const endInGap = match.index + match[0].length
    out.push({
      start: base.end + startInGap,
      end: base.end + endInGap,
      reference: {
        kind: 'law-article',
        law: reference.law,
        article,
        ...(paragraph === undefined ? {} : { paragraph }),
        ...(item === undefined ? {} : { item }),
        raw: gap.slice(startInGap, endInGap),
      },
    })
    cursor = endInGap
  }
  return out
}

/** One unit of a continuation reference: its kind and parsed number. */
type ContinuationUnit = { unit: string; value: number }

/**
 * Parse one unit of a continuation reference.
 * @param value - the number text.
 * @param unit - 条, 款, or 项.
 * @param parenthesized - whether the number was written as 第（二）项.
 * @returns the unit, or null when the number or the wrapping is invalid.
 */
function readContinuationUnit(value: string, unit: string, parenthesized: boolean): ContinuationUnit | null {
  if (parenthesized && unit !== '项') return null
  const parsed = parseCnNumber(value)
  if (parsed === null || parsed < 1) return null
  return { unit, value: parsed }
}

/**
 * Whether the units narrow in the only order a citation uses: 条, then 款,
 * then 项, each at most once.
 * @param units - the units of one continuation.
 * @returns true when the order is 条 → 款 → 项 without repeats.
 */
function narrowingUnits(units: readonly ContinuationUnit[]): boolean {
  let previous = -1
  for (const { unit } of units) {
    const rank = unit === '条' ? 0 : unit === '款' ? 1 : 2
    if (rank <= previous) return false
    previous = rank
  }
  return true
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
    const article = parseCnNumber(groups.article)
    if (article === null || article < 1) continue
    const lawName = STATUTE_NAMES[groups.law]
    if (lawName === undefined) continue
    addCandidate(candidates, match, {
      kind: 'law-article',
      law: lawName,
      article,
      ...narrowed(groups.paragraph, groups.itemParen ?? groups.item),
      raw: stripBookMarks(match[0]),
    })
  }

  candidates.sort((a, b) => a.start - b.start)
  const withContinuations = [...candidates]
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] as Candidate
    const limit = candidates[index + 1]?.start ?? normalized.length
    withContinuations.push(...readContinuations(normalized, candidate, limit))
  }
  withContinuations.sort((a, b) => a.start - b.start)

  const seen = new Set<string>()
  const references: LegalLawReference[] = []
  for (const candidate of withContinuations) {
    const identity = referenceIdentity(candidate.reference)
    if (seen.has(identity)) continue
    seen.add(identity)
    references.push(candidate.reference)
  }
  return references
}

/**
 * Stable identity of a resolved reference.
 * @param reference - the resolved reference.
 * @returns a string equal for two references to the same provision.
 */
function referenceIdentity(reference: LegalLawReference): string {
  return `article:${reference.law}:${reference.article}:${reference.paragraph ?? ''}:${reference.item ?? ''}`
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
  const raws = recognized.map(reference => compactCitation(normalizeCitationText(reference.raw)))
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of normalizeCitationText(text).matchAll(UNRECOGNIZED_PATTERN)) {
    const token = match[0]
    const key = compactCitation(token)
    if (raws.some(raw => raw.includes(key))) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
    if (out.length === 10) break
  }
  return out
}

/** Drop the layout spaces a citation may carry, for containment checks. */
function compactCitation(value: string): string {
  return value.replace(/\s+/g, '')
}

/**
 * Render a reference the way a formal Chinese document writes it.
 * @param reference - the reference to render.
 * @returns the rendered text.
 */
export function formatLegalLawReference(reference: LegalLawReference): string {
  const paragraph = reference.paragraph === undefined ? '' : `第${formatCitationNumber(reference.paragraph)}款`
  const item = reference.item === undefined ? '' : `第${formatCitationNumber(reference.item)}项`
  return `《${reference.law}》第${formatCitationNumber(reference.article)}条${paragraph}${item}`
}

/**
 * Render a citation number in Chinese numerals when it is in the documented
 * range, and keep the digits otherwise.
 * @param value - the number to render.
 * @returns the Chinese numeral or the decimal digits.
 */
function formatCitationNumber(value: number): string {
  return value >= 0 && value <= 999 ? formatCnNumber(value) : String(value)
}

/** Chinese numeral for one digit, used by {@link formatCnNumber}. */
function cnDigit(value: number): string {
  return CN_DIGITS[value] as string
}

/** Paragraph and item fields a reference carries, omitted when the text names none. */
function narrowed(paragraph: string | undefined, item: string | undefined): {
  paragraph?: number
  item?: number
} {
  const paragraphValue = paragraph === undefined ? null : parseCnNumber(paragraph)
  const itemValue = item === undefined ? null : parseCnNumber(item)
  return {
    ...(paragraphValue !== null ? { paragraph: paragraphValue } : {}),
    ...(itemValue !== null ? { item: itemValue } : {}),
  }
}

/** Drop the closing book-title mark a citation may carry. */
function stripBookMarks(text: string): string {
  return text.replaceAll('》', '')
}

/** Drop the punctuation or quotation marks a citation may be wrapped in. */
function trimPunctuation(text: string): string {
  return text
    .trim()
    .replace(/^[（(《【["'「『]+/, '')
    .replace(/[）)》】\];；,，.。、:："'」』]+$/, '')
    .trim()
}
