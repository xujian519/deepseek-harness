/**
 * Parse a single legal Markdown file into a structured {@link ParsedLaw} object.
 *
 * The parser handles the unified format used by the Laws-1.0.0 corpus:
 *
 * ```markdown
 * # 法律全称
 * [# 副标题（民法典按编拆分时使用）]
 * [空行]
 * 通过日期 会议信息
 * [修正历史记录...]
 * [施行日期]
 * [空行]
 * <!-- INFO END -->
 * [正文：章/节/条结构]
 * ```
 *
 * @module parse-law-md
 */

import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'

/** One recorded amendment from the metadata block. */
export type Amendment = {
  /** Amendment date in `YYYY-MM-DD` or `YYYY年MM月DD日` form. */
  date: string
  /** What the amendment did (修正 / 修订 / 通过). */
  description: string
}

/** A chapter (章) heading and the article numbers it contains. */
export type Chapter = {
  /** Chapter number (1-based). */
  number: number
  /** Chapter title text, excluding the `第N章` prefix. */
  title: string
  /** Article numbers that fall under this chapter. */
  articles: number[]
}

/** One parsed article (条). */
export type Article = {
  /** Article number (1-based). */
  number: number
  /** Full article text, including all paragraphs (款). */
  text: string
  /** Chapter number this article belongs to; absent or undefined when not determinable. */
  chapter?: number | undefined
}

/** The complete parse result for one legal Markdown file. */
export type ParsedLaw = {
  /** Law full name as it appears in the `# ` heading. */
  name: string
  /** Short / common name inferred from `name` (e.g. `民法典` from `中华人民共和国民法典`). */
  shortName: string
  /** Date the law was originally adopted, in `YYYY-MM-DD` form when parseable. */
  adoptDate: string
  /** Date the law took effect, in `YYYY-MM-DD` form when parseable. */
  effectiveDate: string
  /** Amendment history extracted from the metadata block. */
  amendments: Amendment[]
  /** Chapter structure. */
  chapters: Chapter[]
  /** All articles in document order. */
  articles: Article[]
  /** Optional subtitle (民法典按编拆分的文件名). */
  subtitle?: string | undefined
  /** Source file path. */
  sourceFile: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Chinese number → Arabic value base map for single-digit and unit characters. */
const CN_BASE: Record<string, number> = {
  '〇': 0, '零': 0,
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9,
  '十': 10, '百': 100, '千': 1000, '万': 10000,
}

/**
 * Convert a Chinese numeral string to its Arabic value.
 * Uses recursive decomposition over 万/千/百/十 units; handles values up to
 * 十万 and beyond without a lookup table.
 */
function cnToArabic(cn: string): number {
  // Single-character base case
  const cnValue = CN_BASE[cn]
  if (cnValue !== undefined && cnValue < 10) return cnValue

  // Decompose by the largest unit present (万 > 千 > 百 > 十)
  const units: Array<[string, number]> = [['万', 10000], ['千', 1000], ['百', 100], ['十', 10]]
  for (const [unitChar, unitValue] of units) {
    const idx = cn.indexOf(unitChar)
    if (idx !== -1) {
      const before = cn.slice(0, idx)
      const after = cn.slice(idx + 1)
      const multiplier = before ? cnToArabic(before) : 1
      const remainder = after ? cnToArabic(after) : 0
      return multiplier * unitValue + remainder
    }
  }

  return 0
}

/** Match `第N条` where N is Chinese numerals. */
const ARTICLE_RE = /^第([一二三四五六七八九十百千万零]+)条\s/

/** Match `第N章` heading. */
const CHAPTER_RE = /^##\s+第([一二三四五六七八九十百千万零]+)章\s+(.*)/

/** Match `第N节` sub-heading. */
const SECTION_RE = /^###\s+第([一二三四五六七八九十百千万零]+)节\s/

/** Match a date line: `YYYY年MM月DD日`. */
const DATE_CN_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/

/**
 * Normalise a Chinese-formatted date to `YYYY-MM-DD`.
 * Returns an empty string when no date is found.
 */
function normaliseDate(raw: string): string {
  const m = DATE_CN_RE.exec(raw)
  if (!m) return ''
  const year = m[1] ?? ''
  const month = m[2] ?? ''
  const day = m[3] ?? ''
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/**
 * Derive a short name from the full law title.
 *
 * Strips the `中华人民共和国` prefix and any trailing parenthesised date.
 * Examples:
 * - `中华人民共和国民法典` → `民法典`
 * - `中华人民共和国公司法` → `公司法`
 */
function deriveShortName(fullName: string): string {
  let short = fullName.replace(/^中华人民共和国/, '')
  // Strip trailing parenthesised date if present
  short = short.replace(/（[^）]*）$/, '').trim()
  return short
}

/**
 * Split the raw file content into the metadata block and the body block
 * separated by `<!-- INFO END -->`.
 */
function splitMetaAndBody(content: string): { meta: string; body: string } {
  const sentinel = '<!-- INFO END -->'
  const idx = content.indexOf(sentinel)
  if (idx === -1) {
    // No sentinel — treat the entire content as body with empty meta
    return { meta: '', body: content }
  }
  return {
    meta: content.slice(0, idx),
    body: content.slice(idx + sentinel.length),
  }
}

/**
 * Extract the law title from the first `# ` heading line.
 * For 民法典 split files there are two `# ` lines; the second becomes `subtitle`.
 */
function extractTitle(meta: string): { name: string; subtitle?: string | undefined } {
  const lines = meta.split('\n')
  const h1Lines: string[] = []
  for (const line of lines) {
    if (/^#\s+/.test(line) && !line.startsWith('# 副标题')) {
      // Strip inline comments like `<!-- ... -->`
      const cleaned = line.replace(/<!--.*?-->/g, '').replace(/^#\s+/, '').trim()
      if (cleaned) h1Lines.push(cleaned)
    }
  }
  return {
    name: h1Lines[0] ?? '',
    subtitle: h1Lines.length > 1 ? h1Lines[1] : undefined,
  }
}

/**
 * Parse the metadata block into adoption date, effective date, and amendments.
 *
 * Metadata lines (between the `# ` title and `<!-- INFO END -->`) follow the pattern:
 * ```
 * YYYY年MM月DD日  会议信息通过
 * YYYY年MM月DD日  施行
 * YYYY年MM月DD日  ...第N次修正
 * ```
 */
function parseMetadata(meta: string): { adoptDate: string; effectiveDate: string; amendments: Amendment[] } {
  const lines = meta.split('\n').map(l => l.trim()).filter(Boolean)
  const amendments: Amendment[] = []
  let adoptDate = ''
  let effectiveDate = ''

  for (const line of lines) {
    // Skip title lines and HTML comments
    if (line.startsWith('#') || line.startsWith('<!--')) continue

    const dateStr = normaliseDate(line)
    if (!dateStr) continue

    if (/施行/.test(line)) {
      effectiveDate = dateStr
    } else if (/通过/.test(line) && !/修正/.test(line) && !/修订/.test(line)) {
      adoptDate = dateStr
    }

    // Record amendments (修正 / 修订 / 通过 all count as revision events)
    if (/修正/.test(line) || /修订/.test(line)) {
      amendments.push({ date: dateStr, description: line.replace(DATE_CN_RE, '').trim() })
    }
  }

  return { adoptDate, effectiveDate, amendments }
}

/**
 * Parse the body text into chapters and articles.
 *
 * Articles are matched by `第N条 ` at the start of a line. Chapter headings
 * are matched by `## 第N章 `. Text between two article markers that is not
 * part of a new article is appended to the preceding article (multi-paragraph
 * articles).
 */
function parseBody(body: string): { chapters: Chapter[]; articles: Article[] } {
  const lines = body.split('\n')
  const chapters: Chapter[] = []
  const articles: Article[] = []
  let currentChapter: number | undefined
  let currentArticle: Article | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()

    // Chapter heading
    const chapterMatch = CHAPTER_RE.exec(line)
    if (chapterMatch) {
      const num = cnToArabic(chapterMatch[1] ?? '')
      if (num > 0) {
        currentChapter = num
        chapters.push({ number: num, title: (chapterMatch[2] ?? '').trim(), articles: [] })
      }
      continue
    }

    // Section heading (### 第N节) — tracked but not stored separately
    if (SECTION_RE.test(line)) continue

    // Skip HTML comment markers like <!-- FORCE BREAK -->
    if (/^<!--/.test(line.trim())) continue

    // Article start
    const articleMatch = ARTICLE_RE.exec(line)
    if (articleMatch) {
      const num = cnToArabic(articleMatch[1] ?? '')
      // Skip unrecognized Chinese numerals (num === 0)
      if (num === 0) continue

      // Flush previous article
      if (currentArticle) articles.push(currentArticle)
      // Article text starts after `第N条 `
      const textStart = line.indexOf(articleMatch[0])
      const articleText = line.slice(textStart + articleMatch[0].length).trim()
      currentArticle = {
        number: num,
        text: articleText,
        chapter: currentChapter,
      }

      // Register article under its chapter
      if (currentChapter !== undefined) {
        const ch = chapters.find(c => c.number === currentChapter)
        if (ch && !ch.articles.includes(num)) ch.articles.push(num)
      }
      continue
    }

    // Continuation line — append to current article
    if (currentArticle && line.trim() !== '') {
      currentArticle.text += (currentArticle.text ? '\n' : '') + line.trim()
    }
  }

  // Flush last article
  if (currentArticle) articles.push(currentArticle)

  return { chapters, articles }
}

/**
 * Parse a file name of the form `法律名称(YYYY-MM-DD).md` or `法律名称.md`.
 * @returns the stem (without extension) and the date string (empty when absent).
 */
export function parseFilename(filePath: string): { stem: string; date: string } {
  const name = basename(filePath, extname(filePath))
  const dateMatch = /\((\d{4}-\d{2}-\d{2})\)$/.exec(name)
  if (dateMatch) {
    return { stem: name.slice(0, dateMatch.index), date: dateMatch[1] ?? '' }
  }
  return { stem: name, date: '' }
}

/**
 * Parse a single legal Markdown file into a {@link ParsedLaw}.
 * @param content - the raw Markdown text.
 * @param filePath - the source file path, used for diagnostics and `sourceFile`.
 * @returns the structured parse result.
 */
export function parseLawMarkdown(content: string, filePath: string): ParsedLaw {
  const { meta, body } = splitMetaAndBody(content)

  // When there is no INFO END sentinel, meta is empty — extract title from body
  const titleSource = meta || body
  const { name, subtitle } = extractTitle(titleSource)
  const { adoptDate, effectiveDate, amendments } = parseMetadata(titleSource)
  const { chapters, articles } = parseBody(body)
  const fileDate = parseFilename(filePath).date

  // Fall back to file-name date when metadata has no adopt date
  const resolvedAdoptDate = adoptDate || fileDate

  return {
    name,
    shortName: deriveShortName(name),
    adoptDate: resolvedAdoptDate,
    effectiveDate,
    amendments,
    chapters,
    articles,
    subtitle,
    sourceFile: filePath,
  }
}

/**
 * Convenience: read and parse one file from disk.
 * @param filePath - absolute path to the Markdown file.
 * @returns the parsed law.
 */
export function parseLawFile(filePath: string): ParsedLaw {
  return parseLawMarkdown(readFileSync(filePath, 'utf8'), filePath)
}
