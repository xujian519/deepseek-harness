/**
 * Law-reference parsing and formatting.
 *
 * Chinese patent citations arrive in mixed forms: decimal article numbers
 * (`专利法第22条第3款`), written numbers (`专利法第二十二条第三款`), the compact
 * examination form (`A22.3`), and guideline section paths
 * (`审查指南第二部分第四章3.2.1.1`). Everything downstream compares one
 * normalized reference, so the reference grammar lives here and nowhere else;
 * the numeral reader itself is shared with the patent-domain library.
 * @module @deepseek-ai/dsh-patent-law/reference
 */

import { parseCnNumber } from '@deepseek-ai/dsh-patent-core'
import type { LawReference, StatuteName } from './types.ts'

export { parseCnNumber }

/** Chinese numeral digits, indexed by value; used for rendering. */
const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** Number written in Chinese numerals or Arabic digits. */
const NUMBER = '[〇零一二三四五六七八九十百0-9]{1,6}'

// The house style separates Chinese text from digits with spaces (专利法第 22 条第 3
// 款), and a source copied out of a PDF may use full-width digits. Both are
// normalized before matching, so the grammar below allows whitespace at every
// token joint and receives ASCII digits.
const STATUTE_PATTERN = new RegExp(
  '(?<law>中华人民共和国专利法实施细则|专利法实施细则|实施细则|中华人民共和国专利法|专利法|细则)'
  // A formal citation wraps the law name in 《》 and omits 第 (专利法第二十二条); the
  // compact one writes 专利法第22条. Both are accepted; the closing 》 is dropped
  // from the written form by stripBookMarks.
  + '\\s*》?\\s*第?\\s*(?<article>'
  + NUMBER
  + ')\\s*条'
  + `(?:\\s*第\\s*(?<paragraph>${NUMBER})\\s*款)?`
  // 项 is written 第二项 or 第（二）项; the parenthesized form is the one a
  // formal citation uses.
  + `(?:\\s*第\\s*(?:[（(]\\s*(?<itemParen>${NUMBER})\\s*[）)]|(?<item>${NUMBER}))\\s*项)?`,
  'g',
)

const GUIDELINE_PATTERN = new RegExp(
  '(?:专利审查指南|审查指南)'
  + '\\s*》?\\s*'
  + `第\\s*(?<part>${NUMBER})\\s*部分`
  + `(?:\\s*第\\s*(?<chapter>${NUMBER})\\s*章)?`
  + '(?:\\s*第?\\s*(?<tail>[0-9]+(?:\\.[0-9]+)*)\\s*节?)?',
  'g',
)

/**
 * One reference that follows another in the same sentence and inherits its
 * context: `专利法第22条、第23条`, `第22条第2款、第3款`, or a chained
 * `、第26条第4款`. The leading coordinator is required, so a citation in the
 * next sentence is not folded into the previous one.
 */
const CONTINUATION_PATTERN = new RegExp(
  '\\s*[、，,和及与或]\\s*第\\s*'
  + `(?:[（(]\\s*(?<n1p>${NUMBER})\\s*[）)]|(?<n1>${NUMBER}))`
  + '\\s*(?<u1>条|款|项)'
  + `(?:\\s*第\\s*(?:[（(]\\s*(?<n2p>${NUMBER})\\s*[）)]|(?<n2>${NUMBER}))\\s*(?<u2>款|项))?`
  + `(?:\\s*第\\s*(?:[（(]\\s*(?<n3p>${NUMBER})\\s*[）)]|(?<n3>${NUMBER}))\\s*项)?`,
  'y',
)

/**
 * Compact examination form, e.g. `A22.3`. A letter, a digit, or a CJK character
 * immediately after the number means it is another token (`A4纸`), not a
 * citation.
 */
const COMPACT_PATTERN = /(?<![0-9A-Za-z])A(?<article>[0-9]{1,3})(?:\.(?<paragraph>[0-9]{1,2}))?(?![0-9A-Za-z\u4e00-\u9fff])/g

const STATUTE_NAMES: Record<string, StatuteName> = {
  '专利法': '专利法',
  '中华人民共和国专利法': '专利法',
  '专利法实施细则': '专利法实施细则',
  '实施细则': '专利法实施细则',
  '细则': '专利法实施细则',
}

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

/** The groups {@link GUIDELINE_PATTERN} always captures, typed for direct use. */
type GuidelineGroups = { part: string; chapter?: string; tail?: string }

/** The groups {@link COMPACT_PATTERN} always captures, typed for direct use. */
type CompactGroups = { article: string; paragraph?: string }

/** One parsed candidate with its span in the scanned text. */
type Candidate = { start: number; end: number; reference: LawReference }

/**
 * Normalize the forms a copied citation may carry before matching: full-width
 * digits, Latin letters, and full-width brackets become ASCII; Chinese
 * punctuation such as `、` and `。` is unchanged.
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
  // 一百零五 keeps the zero placeholder; 一百一十 must not gain one.
  else if (hundreds > 0 && ones > 0) parts.push('零')
  if (ones > 0) parts.push(cnDigit(ones))
  return parts.join('')
}

/**
 * Parse one reference standing alone in `text`.
 *
 * The whole text must be the reference, ignoring surrounding punctuation, so a
 * citation embedded in a sentence is found through {@link extractLawReferences}
 * instead.
 * @param text - the candidate reference text.
 * @returns the parsed reference, or null when the text is not exactly one.
 */
export function parseLawReference(text: string): LawReference | null {
  const trimmed = trimPunctuation(normalizeCitationText(text))
  if (trimmed === '') return null
  // A written reference keeps its closing book-title mark (专利法》第二十二条), which
  // the extracted form drops, so compare against the mark-free text.
  const comparable = stripBookMarks(trimmed)
  return extractLawReferences(trimmed).find(reference => reference.raw === comparable) ?? null
}

/**
 * Record one pattern match and the reference it resolved to, so every arm of the
 * extractor reports its span the same way.
 * @param candidates - the candidate list being built.
 * @param match - the pattern match.
 * @param reference - the reference the match resolved to.
 */
function addCandidate(candidates: Candidate[], match: RegExpExecArray, reference: LawReference): void {
  candidates.push({
    start: match.index,
    end: match.index + match[0].length,
    reference,
  })
}

/**
 * Resolve the references that follow `base` in the same sentence and inherit
 * its law, article, paragraph, or item.
 *
 * Only the gap before the next base match is scanned, and the first token must
 * begin with a coordinator, so `专利法第22条。第23条` stays two separate
 * sentences. The returned raw is the token alone (`第23条`), since the inherited
 * law is not written there.
 * @param text - the normalized text.
 * @param base - the base match whose context is inherited.
 * @param limit - the end of the gap to scan.
 * @returns the continuation candidates.
 */
function readContinuations(text: string, base: Candidate, limit: number): Candidate[] {
  const reference = base.reference
  if (reference.kind !== 'law-article') return []
  // Scan only the gap before the next base match, so a continuation can never
  // absorb a citation that the base patterns already own.
  const gap = text.slice(base.end, limit)
  const out: Candidate[] = []
  let cursor = 0
  // Each continuation inherits from the previous one, not from the base: in
  // 专利法第22条、第23条第2款、第3款 the last 款 belongs to 第23条.
  let article = reference.article
  let paragraph = reference.paragraph
  let item = reference.item
  while (cursor < gap.length) {
    CONTINUATION_PATTERN.lastIndex = cursor
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
    // 条 → 款 → 项 is the only narrowing order; a 款 after an item, or a
    // repeated unit, is not a reference this parser can attribute.
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
    // The match always starts with the coordinator and then 第, so the raw
    // reference begins at that 第 and excludes the coordinator.
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
  // A parenthesized number is an item (第（二）项), never a 条 or 款.
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
 * Extract every law reference in `text`, in order of appearance and deduplicated
 * by the reference as written. The three base patterns match disjoint spans, so
 * they only need ordering; a pass over the gap between two base matches then
 * resolves the references that inherit their context (`、第23条`, `、第3款`).
 * @param text - the text to scan.
 * @returns the parsed references.
 */
export function extractLawReferences(text: string): LawReference[] {
  const normalized = normalizeCitationText(text)
  const candidates: Candidate[] = []

  for (const match of normalized.matchAll(STATUTE_PATTERN)) {
    const groups = match.groups as StatuteGroups
    const article = parseCnNumber(groups.article)
    // A number the pattern allows but the numeral parser rejects, e.g. 第十十条.
    if (article === null || article < 1) continue
    addCandidate(candidates, match, {
      kind: 'law-article',
      law: STATUTE_NAMES[groups.law] as StatuteName,
      article,
      ...narrowed(groups.paragraph, groups.itemParen ?? groups.item),
      raw: stripBookMarks(match[0]),
    })
  }

  for (const match of normalized.matchAll(GUIDELINE_PATTERN)) {
    const groups = match.groups as GuidelineGroups
    const path = guidelinePath(groups.part, groups.chapter, groups.tail)
    if (path === null) continue
    addCandidate(candidates, match, {
      kind: 'guideline-section',
      law: '专利审查指南',
      path,
      raw: stripBookMarks(match[0]),
    })
  }

  for (const match of normalized.matchAll(COMPACT_PATTERN)) {
    const groups = match.groups as CompactGroups
    addCandidate(candidates, match, {
      kind: 'law-article',
      law: '专利法',
      // The pattern captures one to three digits, so the parse is always safe.
      article: Number.parseInt(groups.article, 10),
      ...narrowed(groups.paragraph, undefined),
      raw: match[0],
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
  const references: LawReference[] = []
  for (const candidate of withContinuations) {
    if (seen.has(candidate.reference.raw)) continue
    seen.add(candidate.reference.raw)
    references.push(candidate.reference)
  }
  return references
}

/**
 * A fragment that looks like a citation but was not resolved: an article,
 * paragraph, or item number, or the compact examination form.
 */
const UNRECOGNIZED_PATTERN = new RegExp(
  `第\\s*${NUMBER}\\s*[条款项]`
  + '|(?<![0-9A-Za-z])A[0-9]{1,3}(?:\\.[0-9]{1,2})?(?![0-9A-Za-z\\u4e00-\\u9fff])',
  'g',
)

/**
 * List the citation-like fragments in `text` that the parser did not resolve.
 *
 * The tool reports these instead of leaving them invisible: a text whose first
 * citation was recognized but whose later citation was not must not read as a
 * complete check. A fragment already carried by a recognized reference is not
 * reported.
 * @param text - the text that was scanned.
 * @param recognized - the references the parser resolved.
 * @returns the unresolved fragments, deduplicated and capped at ten.
 */
export function scanUnrecognizedCitations(text: string, recognized: readonly LawReference[]): string[] {
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
 * Render a reference the way a formal Chinese document writes it, e.g.
 * `《专利法》第二十二条第三款`.
 * @param reference - the reference to render.
 * @returns the rendered text.
 */
export function formatLawReference(reference: LawReference): string {
  if (reference.kind === 'guideline-section') return `《专利审查指南》${reference.path}`
  const paragraph = reference.paragraph === undefined ? '' : `第${formatCitationNumber(reference.paragraph)}款`
  const item = reference.item === undefined ? '' : `第${formatCitationNumber(reference.item)}项`
  return `《${reference.law}》第${formatCitationNumber(reference.article)}条${paragraph}${item}`
}

/**
 * Render a citation number in Chinese numerals when it is in the documented
 * range, and keep the digits otherwise. An out-of-range article is reported,
 * not thrown on, so a citation beyond the ceiling still gets a row.
 * @param value - the number to render.
 * @returns the Chinese numeral or the decimal digits.
 */
function formatCitationNumber(value: number): string {
  return value >= 0 && value <= 999 ? formatCnNumber(value) : String(value)
}

/** Chinese numeral for one digit, used by {@link formatCnNumber}. */
function cnDigit(value: number): string {
  // formatCnNumber validates 0..999 and only passes a digit here.
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

/** Normalize a guideline match into a section path, or null when the part is unreadable. */
function guidelinePath(part: string, chapter: string | undefined, tail: string | undefined): string | null {
  const partValue = parseCnNumber(part)
  if (partValue === null || partValue < 1) return null
  const chapterValue = chapter === undefined ? null : parseCnNumber(chapter)
  if (chapter !== undefined && (chapterValue === null || chapterValue < 1)) return null
  const chapterText = chapterValue === null ? '' : `第${formatCnNumber(chapterValue)}章`
  return `第${formatCnNumber(partValue)}部分${chapterText}${tail ?? ''}`
}

/** Drop the closing book-title mark a citation may carry, e.g. `专利法》第二十二条`. */
function stripBookMarks(text: string): string {
  return text.replaceAll('》', '')
}

/** Drop the punctuation or quotation marks a citation may be wrapped in. */
function trimPunctuation(text: string): string {
  return text
    .trim()
    .replace(/^[（(《【[“‘「『]+/, '')
    .replace(/[）)》】\];；,，.。、:：”’」』]+$/, '')
    .trim()
}
