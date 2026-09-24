/**
 * Deterministic document checks behind the `document_deliver` gate.
 *
 * The model declares which quality checks it ran; these functions read the
 * delivered bytes themselves, so the gate reports machine-derived findings
 * beside that declaration instead of taking it as evidence. Every check is a
 * pure function over one document's text, so a caller can run it on a rendered
 * Markdown or HTML file and on the text projected out of a DOCX package alike.
 *
 * Finding levels. `block` refuses the registration and is reserved for the two
 * findings the shipped quality gate calls P0 with no legitimate reading: a
 * residual `{{placeholder}}` outside quoted text (a code fence or an inline code
 * span), and a word the selected style forbids outright. Everything else is `warn` — an empty section, a
 * fragment no declared anchor serves, a word the style only discourages, a
 * format with no text reader, and a declared character budget the document
 * misses. A `warn` finding is reported and the registration proceeds, because
 * each of them has a reading a reviewer may accept (a placeholder shown inside
 * a code sample or quoted in inline code while the document talks about that
 * placeholder, an anchor a renderer derives differently, an intentionally short
 * summary). A deployment that needs a forbidden word allowed overrides
 * the style asset instead of silencing the check.
 * @module @deepseek-ai/dsh-document-deliver/checks
 */

import type { AntiPattern, DocumentStyle } from '@deepseek-ai/dsh-doc-style'

/** Every check this module can report. */
export const DOCUMENT_CHECK_IDS = [
  'placeholder',
  'broken_anchor',
  'empty_section',
  'anti_pattern',
  'length_budget',
] as const

/** One check's identifier. */
export type DocumentCheckId = (typeof DOCUMENT_CHECK_IDS)[number]

/** Whether a finding refuses the registration (`block`) or only reports it (`warn`). */
export type DocumentCheckLevel = 'block' | 'warn'

/** One machine-derived finding about a delivered document. */
export interface DocumentCheckFinding {
  /** The check that produced the finding. */
  readonly check: DocumentCheckId
  /** `block` refuses the registration; `warn` reports it and registers anyway. */
  readonly level: DocumentCheckLevel
  /** One line naming what was found and where, phrased for the model to act on. */
  readonly detail: string
  /** 1-based line of the checked text; absent for a finding with no position. */
  readonly line?: number
}

/** Input of {@link checkDocumentText}: what a style and a declared budget add. */
export interface DocumentTextCheckOptions {
  /** The style whose forbidden words are enforced; absent when no style applies. */
  readonly style?: DocumentStyle
  /** Declared character budget, in non-whitespace characters; absent when none was declared. */
  readonly charBudget?: number
  /**
   * Fraction of the declared budget the document may fall short of or exceed.
   * Defaults to {@link DEFAULT_LENGTH_TOLERANCE}; `document_deliver` always
   * supplies its configured value.
   */
  readonly lengthTolerance?: number
}

/** One finding before {@link report} attributes it to a check. */
interface DraftFinding {
  /** One line naming what was found and where. */
  readonly detail: string
  /** The finding's own level, overriding the check's default. */
  readonly level?: DocumentCheckLevel
  /** 1-based line of the checked text, or 0 for a finding with no position. */
  readonly line: number
}

/** Findings kept per check before the rest are summarized into one line. */
const MAX_FINDINGS_PER_CHECK = 5

/** Tolerance the shipped quality gate applies to a declared character budget. */
export const DEFAULT_LENGTH_TOLERANCE = 0.2

/** Residual placeholder forms: the unfilled-variable braces plus the marker list the quality gate names. */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\{\{[^{}\n]{1,80}\}\}/gu,
  /\[(?:TBD|TODO|REPLACE|PLACEHOLDER|XXX)\]/giu,
  /lorem ipsum/giu,
  /(?:待补充|待填写|此处填写)/gu,
]

/** A Markdown ATX heading line. */
const MARKDOWN_HEADING = /^#{1,6}[ \t]+(\S.*?)[ \t]*$/gmu

/** An HTML heading element. */
const HTML_HEADING = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/giu

/** A fenced code block's opening or closing line. */
const FENCE = /^[ \t]*(?:```|~~~).*$/gmu

/** A Markdown link or image whose target is a same-document fragment. */
const MARKDOWN_FRAGMENT = /\]\(#([^)\s]+)\)/gu

/** An HTML attribute whose value is a same-document fragment. */
const HTML_FRAGMENT = /(?:href|src)\s*=\s*"#([^"]*)"/giu

/** An explicit HTML anchor: an element id or a named anchor. */
const EXPLICIT_ANCHOR = /\s(?:id|name)\s*=\s*"([^"]+)"/giu

/** An HTML comment, which never counts as a section's content. */
const HTML_COMMENT = /<!--[\s\S]*?-->/gu

/** A character range of the checked text. */
interface TextRange {
  readonly start: number
  readonly end: number
}

/** One heading occurrence: where it sits and what it renders to. */
interface HeadingSpan extends TextRange {
  /** The heading text with its Markdown or HTML markup removed. */
  readonly text: string
}

/** One occurrence of a global expression: where it starts, what it matched, and its first group. */
interface TextMatch {
  readonly index: number
  readonly text: string
  readonly group: string
}

/**
 * Every occurrence of one global expression, in text order.
 *
 * `exec` is used instead of `matchAll` because its result types `index` as a
 * definite number, while `matchAll` types it optional and forces a fallback no
 * caller can reach. The expression's `lastIndex` is reset on entry, so a shared
 * constant expression stays safe to reuse after an interrupted scan.
 * @param text - the text to scan.
 * @param pattern - a global expression.
 * @returns one entry per occurrence.
 */
function matches(text: string, pattern: RegExp): TextMatch[] {
  pattern.lastIndex = 0
  const found: TextMatch[] = []
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    found.push({ index: match.index, text: match[0], group: match[1] ?? '' })
  }
  return found
}

/** A literal string as a case-insensitive global expression. */
function literal(pattern: string): RegExp {
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu')
}

/** Whether an index falls inside any of the given ranges. */
function within(ranges: readonly TextRange[], index: number): boolean {
  return ranges.some(range => index >= range.start && index < range.end)
}

/** Line-start offsets of one text, for naming a finding's line. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

/**
 * The 1-based line holding one text offset.
 * @param starts - the line-start offsets of the text.
 * @param offset - the offset to locate.
 * @returns the line number.
 */
function lineOf(starts: readonly number[], offset: number): number {
  let line = 1
  for (const [index, start] of starts.entries()) {
    if (start > offset) break
    line = index + 1
  }
  return line
}

/** Fenced code blocks of the text, paired by consecutive fence lines. */
function fenceRanges(text: string): TextRange[] {
  const ranges: TextRange[] = []
  let start: number | undefined
  for (const match of matches(text, FENCE)) {
    if (start === undefined) {
      start = match.index
      continue
    }
    ranges.push({ start, end: match.index + match.text.length })
    start = undefined
  }
  if (start !== undefined) ranges.push({ start, end: text.length })
  return ranges
}

/** Inline code spans: a backtick run closed by an equally long run on the same line. */
const INLINE_CODE = /(`+)([^`\n]*?)\1/gu

/**
 * Quoted spans the placeholder check treats as displayed text rather than residual
 * content: fenced blocks plus inline code spans.
 *
 * A document that quotes the checks — a delivery checklist naming `[TBD]` or
 * `{{variable}}` inside inline code — carries the very strings this check looks
 * for, and quoting them is the way such a document talks about them. Both are
 * reported at `warn` instead of blocking.
 * @param text - the checked text.
 * @returns the ranges, in no particular order.
 */
function quotedRanges(text: string): TextRange[] {
  const inline = matches(text, INLINE_CODE).map(match => ({ start: match.index, end: match.index + match.text.length }))
  return [...fenceRanges(text), ...inline]
}

/** Strip the markup a heading may carry, so its slug matches what a renderer shows. */
function renderedHeading(text: string): string {
  return text
    .replace(/<[^>]*>/gu, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[`*~]/gu, '')
    .trim()
}

/**
 * The anchor a renderer assigns to a heading: GitHub's rule of lowercasing and
 * dropping everything but letters, numbers, underscores, spaces, and hyphens,
 * with spaces becoming hyphens.
 * @param heading - the rendered heading text.
 * @returns the heading's slug.
 */
function headingSlug(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replaceAll(' ', '-')
}

/** Every heading of the text, in order; a `#` line inside a fence is not a heading. */
function headingSpans(text: string, fences: readonly TextRange[]): HeadingSpan[] {
  const spans: HeadingSpan[] = []
  for (const match of matches(text, MARKDOWN_HEADING)) {
    if (within(fences, match.index)) continue
    spans.push({ start: match.index, end: match.index + match.text.length, text: renderedHeading(match.group) })
  }
  for (const match of matches(text, HTML_HEADING)) {
    if (within(fences, match.index)) continue
    spans.push({ start: match.index, end: match.index + match.text.length, text: renderedHeading(match.group) })
  }
  return spans.sort((left, right) => left.start - right.start)
}

/**
 * Every fragment the text declares: each heading's slug with GitHub's
 * collision suffixes, plus every explicit id or named anchor outside a fence.
 */
function declaredAnchors(text: string, fences: readonly TextRange[], headings: readonly HeadingSpan[]): Set<string> {
  const anchors = new Set<string>()
  const bumps = new Map<string, number>()
  for (const heading of headings) {
    const base = headingSlug(heading.text)
    let candidate = base
    let bump = bumps.get(base) ?? 0
    while (anchors.has(candidate)) {
      bump += 1
      candidate = `${base}-${bump}`
    }
    bumps.set(base, bump)
    anchors.add(candidate)
  }
  for (const match of matches(text, EXPLICIT_ANCHOR)) {
    if (within(fences, match.index)) continue
    anchors.add(match.group)
  }
  return anchors
}

/**
 * Append one check's findings, capped so a badly broken document does not flood
 * the result: the cap is reported as its own line rather than silently dropping
 * the remainder.
 *
 * The summary line carries the level of the worst dropped draft, not the check's
 * default: a blocking style word ranked after the cap must still block, and a run
 * of merely-reported drafts (a fenced placeholder) must not start blocking just
 * because it is long.
 * @param into - the finding list to append to.
 * @param check - the check the drafts belong to.
 * @param level - the level a draft without its own carries.
 * @param drafts - the drafts, in text order.
 */
function report(
  into: DocumentCheckFinding[], check: DocumentCheckId, level: DocumentCheckLevel, drafts: readonly DraftFinding[],
): void {
  for (const draft of drafts.slice(0, MAX_FINDINGS_PER_CHECK)) {
    into.push({
      check,
      level: draft.level ?? level,
      detail: draft.detail,
      ...draft.line === 0 ? {} : { line: draft.line },
    })
  }
  if (drafts.length > MAX_FINDINGS_PER_CHECK) {
    const dropped = drafts.slice(MAX_FINDINGS_PER_CHECK)
    into.push({
      check,
      level: dropped.some(draft => (draft.level ?? level) === 'block') ? 'block' : 'warn',
      detail: `另有 ${String(dropped.length)} 处同类问题未逐条列出`,
    })
  }
}

/**
 * Residual placeholders; one shown as quoted text (fenced block or inline code) is
 * only reported, everything else blocks.
 */
function placeholderDrafts(text: string, starts: readonly number[], quoted: readonly TextRange[]): DraftFinding[] {
  const outside: DraftFinding[] = []
  const inside: DraftFinding[] = []
  for (const pattern of PLACEHOLDER_PATTERNS) {
    for (const match of matches(text, pattern)) {
      const line = lineOf(starts, match.index)
      const draft = { detail: `第 ${String(line)} 行仍有残余占位符 ${JSON.stringify(match.text)}`, line }
      if (within(quoted, match.index)) inside.push({ ...draft, level: 'warn' })
      else outside.push(draft)
    }
  }
  return [...outside, ...inside]
}

/** Same-document fragments the text links to but does not declare. */
function anchorDrafts(
  text: string, starts: readonly number[], fences: readonly TextRange[], headings: readonly HeadingSpan[],
): DraftFinding[] {
  const anchors = declaredAnchors(text, fences, headings)
  const drafts: DraftFinding[] = []
  const seen = new Set<string>()
  for (const pattern of [MARKDOWN_FRAGMENT, HTML_FRAGMENT]) {
    for (const match of matches(text, pattern)) {
      if (within(fences, match.index)) continue
      let fragment = match.group
      try {
        fragment = decodeURIComponent(match.group)
      } catch {
        // A malformed escape names no anchor the document could declare, so the
        // raw text is what the lookup reports missing.
        fragment = match.group
      }
      if (fragment === '' || anchors.has(fragment) || seen.has(fragment)) continue
      seen.add(fragment)
      const line = lineOf(starts, match.index)
      drafts.push({ detail: `第 ${String(line)} 行链接到本文档未声明的锚点 "#${fragment}"`, line })
    }
  }
  return drafts.sort((left, right) => left.line - right.line)
}

/** Headings whose section holds no content before the next heading. */
function emptySectionDrafts(text: string, starts: readonly number[], headings: readonly HeadingSpan[]): DraftFinding[] {
  const drafts: DraftFinding[] = []
  for (const [index, heading] of headings.entries()) {
    const next = headings[index + 1]
    const body = text.slice(heading.end, next?.start ?? text.length)
    if (body.replace(HTML_COMMENT, '').replace(/<[^>]*>/gu, '').trim() !== '') continue
    const line = lineOf(starts, heading.start)
    drafts.push({ detail: `第 ${String(line)} 行的标题 ${JSON.stringify(heading.text)} 下没有任何内容`, line })
  }
  return drafts
}

/** Occurrences of the style's forbidden words, at the severity the style declares. */
function antiPatternDrafts(text: string, starts: readonly number[], patterns: readonly AntiPattern[]): DraftFinding[] {
  const drafts: DraftFinding[] = []
  for (const pattern of patterns) {
    for (const match of matches(text, literal(pattern.word))) {
      const line = lineOf(starts, match.index)
      drafts.push({
        level: pattern.severity === 'block' ? 'block' : 'warn',
        detail: `第 ${String(line)} 行出现样式禁用词 ${JSON.stringify(pattern.word)}，建议改用 ${JSON.stringify(pattern.replace)}`,
        line,
      })
    }
  }
  return drafts.sort((left, right) => left.line - right.line)
}

/** The declared character budget against the document's non-whitespace character count. */
function budgetDrafts(text: string, charBudget: number, tolerance: number): DraftFinding[] {
  const actual = text.replace(/\s/gu, '').length
  const minimum = Math.floor(charBudget * (1 - tolerance))
  const maximum = Math.ceil(charBudget * (1 + tolerance))
  if (actual >= minimum && actual <= maximum) return []
  return [{
    detail: `全文 ${String(actual)} 字，${actual < minimum ? '低于' : '超出'}声明的 ${String(charBudget)} 字预算（允许 ${String(minimum)}–${String(maximum)} 字）`,
    line: 0,
  }]
}

/**
 * Run every deterministic check over one document's text.
 * @param text - the document text: a rendered Markdown or HTML file, or the text projected out of a DOCX package.
 * @param options - the style whose forbidden words are enforced, and the declared character budget.
 * @returns the findings in check order, empty for a document that passes every check.
 */
export function checkDocumentText(text: string, options: DocumentTextCheckOptions = {}): DocumentCheckFinding[] {
  const starts = lineStarts(text)
  const fences = fenceRanges(text)
  const headings = headingSpans(text, fences)
  const findings: DocumentCheckFinding[] = []
  report(findings, 'placeholder', 'block', placeholderDrafts(text, starts, quotedRanges(text)))
  report(findings, 'broken_anchor', 'warn', anchorDrafts(text, starts, fences, headings))
  report(findings, 'empty_section', 'warn', emptySectionDrafts(text, starts, headings))
  report(findings, 'anti_pattern', 'warn', antiPatternDrafts(text, starts, options.style?.sections.antiPatterns ?? []))
  if (options.charBudget !== undefined) {
    report(findings, 'length_budget', 'warn', budgetDrafts(text, options.charBudget, options.lengthTolerance ?? DEFAULT_LENGTH_TOLERANCE))
  }
  return findings
}
