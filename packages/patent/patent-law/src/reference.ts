/**
 * Law-reference parsing and formatting.
 *
 * Chinese patent citations arrive in mixed forms: decimal article numbers
 * (`专利法第22条第3款`), written numbers (`专利法第二十二条第三款`), the compact
 * examination form (`A22.3`), and guideline section paths
 * (`审查指南第二部分第四章3.2.1.1`). Everything downstream compares one
 * normalized reference, so the parsing lives here and nowhere else.
 * @module @deepseek-ai/dsh-patent-law/reference
 */

import type { LawReference, StatuteName } from './types.ts'

/** Chinese numeral digits, indexed by value; used for rendering. */
const CN_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** Chinese numeral digits accepted when parsing. */
const DIGITS: Record<string, number> = {
  '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
}

const UNITS: Record<string, number> = { '十': 10, '百': 100 }

/** Number written in Chinese numerals or Arabic digits. */
const NUMBER = '[〇零一二三四五六七八九十百0-9]{1,6}'

const STATUTE_PATTERN = new RegExp(
  '(?<law>中华人民共和国专利法实施细则|专利法实施细则|实施细则|中华人民共和国专利法|专利法|细则)'
  // A formal citation wraps the law name in 《》 and omits 第 (专利法第二十二条); the
  // compact one writes 专利法第22条. Both are accepted; the closing 》 is dropped
  // from the written form by stripBookMarks.
  + '》?第?(?<article>'
  + NUMBER
  + ')条'
  + `(?:第(?<paragraph>${NUMBER})款)?`
  + `(?:第(?<item>${NUMBER})项)?`,
  'g',
)

const GUIDELINE_PATTERN = new RegExp(
  '(?:专利审查指南|审查指南)'
  + '》?'
  + `第(?<part>${NUMBER})部分`
  + `(?:第(?<chapter>${NUMBER})章)?`
  + '(?:\\s*第?(?<tail>[0-9]+(?:\\.[0-9]+)*)节?)?',
  'g',
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
type StatuteGroups = { law: string; article: string; paragraph?: string; item?: string }

/** The groups {@link GUIDELINE_PATTERN} always captures, typed for direct use. */
type GuidelineGroups = { part: string; chapter?: string; tail?: string }

/** The groups {@link COMPACT_PATTERN} always captures, typed for direct use. */
type CompactGroups = { article: string; paragraph?: string }

/** One parsed candidate with its span in the scanned text. */
type Candidate = { start: number; end: number; reference: LawReference }

/**
 * Parse a number written in Chinese numerals (`二十二`) or Arabic digits (`22`).
 * @param text - the number text.
 * @returns the number, or null when it is not a plain number below one thousand.
 */
export function parseCnNumber(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (/^[0-9]+$/.test(trimmed)) {
    const value = Number.parseInt(trimmed, 10)
    return Number.isSafeInteger(value) ? value : null
  }
  if (!/^[〇零一二三四五六七八九十百]+$/.test(trimmed)) return null
  let total = 0
  let pending: number | null = null
  let lastUnit = Number.POSITIVE_INFINITY
  for (const char of trimmed) {
    const digit = DIGITS[char]
    if (digit !== undefined) {
      pending = digit
      continue
    }
    const unit = UNITS[char]
    if (unit === undefined || unit >= lastUnit) return null
    // 十五 is 15: a unit with no leading digit multiplies one.
    total += (pending ?? 1) * unit
    pending = null
    lastUnit = unit
  }
  return total + (pending ?? 0)
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
  const trimmed = trimPunctuation(text)
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
 * Extract every law reference in `text`, in order of appearance and deduplicated
 * by the reference as written. The three patterns match disjoint spans, so the
 * candidates only need ordering.
 * @param text - the text to scan.
 * @returns the parsed references.
 */
export function extractLawReferences(text: string): LawReference[] {
  const candidates: Candidate[] = []

  for (const match of text.matchAll(STATUTE_PATTERN)) {
    const groups = match.groups as StatuteGroups
    const article = parseCnNumber(groups.article)
    // A number the pattern allows but the numeral parser rejects, e.g. 第十十条.
    if (article === null) continue
    addCandidate(candidates, match, {
      kind: 'law-article',
      law: STATUTE_NAMES[groups.law] as StatuteName,
      article,
      ...narrowed(groups.paragraph, groups.item),
      raw: stripBookMarks(match[0]),
    })
  }

  for (const match of text.matchAll(GUIDELINE_PATTERN)) {
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

  for (const match of text.matchAll(COMPACT_PATTERN)) {
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

  const seen = new Set<string>()
  const references: LawReference[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.reference.raw)) continue
    seen.add(candidate.reference.raw)
    references.push(candidate.reference)
  }
  return references
}

/**
 * Render a reference the way a formal Chinese document writes it, e.g.
 * `《专利法》第二十二条第三款`.
 * @param reference - the reference to render.
 * @returns the rendered text.
 */
export function formatLawReference(reference: LawReference): string {
  if (reference.kind === 'guideline-section') return `《专利审查指南》${reference.path}`
  const paragraph = reference.paragraph === undefined ? '' : `第${formatCnNumber(reference.paragraph)}款`
  const item = reference.item === undefined ? '' : `第${formatCnNumber(reference.item)}项`
  return `《${reference.law}》第${formatCnNumber(reference.article)}条${paragraph}${item}`
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

/** Drop the punctuation a citation may be wrapped in. */
function trimPunctuation(text: string): string {  return text
  .trim()
  .replace(/^[（(《【[]+/, '')
  .replace(/[）)》】\];；,，.。、:：]+$/, '')
  .trim()
}
