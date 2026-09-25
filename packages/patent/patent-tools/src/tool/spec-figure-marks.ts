/**
 * Figure-mark consistency: the drawing description, the figure analysis, the
 * specification body, and the claims must agree on the same reference marks.
 */

import type { FigureAnalysisResult, SpecViolation } from './spec-types.ts'

/**
 * Figure-mark consistency: drawing-description marks vs. figure-analysis marks.
 * Unusable figures are skipped per-figure (no all-or-nothing); a mark present in
 * the figure but absent from the drawing description is a warning (漏标), and a
 * mark listed in the description but absent from the figure is an error (悬空).
 * @param text - the specification text (drawing-description section).
 * @param figureAnalysis - the figure-analysis results.
 * @param claims - the claims text (optional); bracketed marks there must exist in a figure.
 * @returns the consistency violations found.
 */
export function checkFigureMarkConsistency(
  text: string,
  figureAnalysis: FigureAnalysisResult[],
  claims?: string,
): SpecViolation[] {
  if (figureAnalysis.length === 0) return []
  const violations: SpecViolation[] = []

  const unusable = figureAnalysis.filter(f => !f.usable)
  if (unusable.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      message: `附图分析结果不可用（${unusable.length} 张），请人工核对图面标号与附图说明`,
    })
  }

  const figureMarks = new Set<string>()
  for (const f of figureAnalysis) {
    if (!f.usable) continue
    for (const c of f.components) {
      if (/^\d+$/.test(c.refNumber)) figureMarks.add(c.refNumber)
    }
  }
  if (figureMarks.size === 0) return violations

  const drawingSection = getDrawingSection(text)
  if (!drawingSection) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      message: '说明书缺少附图说明章节，无法核验附图标记与图面一致性',
      suggestion: '补充附图说明章节，逐图列出标号对应的部件',
    })
    return violations
  }

  const listedMarks = new Set<string>()
  const markPattern = /(?:^|[；;\n，,：:])\s*(\d+)\s*[-–—]/g
  let match: RegExpExecArray | null
  while ((match = markPattern.exec(drawingSection)) !== null) {
    const mark = match[1]
    /* v8 ignore next -- the mark pattern always captures the mark group. */
    if (mark !== undefined) listedMarks.add(mark)
  }

  const missing = [...figureMarks].filter(n => !listedMarks.has(n))
  if (missing.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      section: '附图说明',
      message: `附图标记 ${missing.join('、')} 未在附图说明中列出`,
      suggestion: '在附图说明中补充对应标号的部件说明',
    })
  }

  const dangling = [...listedMarks].filter(n => !figureMarks.has(n))
  if (dangling.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'error',
      section: '附图说明',
      message: `附图说明中的标记 ${dangling.join('、')} 在附图中不存在`,
      suggestion: '核对图面标号，删除或更正附图说明中不存在的标号',
    })
  }

  // 细则第二十一条第二款要求文字部分与附图双向对应：图面上出现的标号必须在
  // 具体实施方式等正文中提及，权利要求中带括号引用的标号也必须出现在图面上。
  const outsideDrawingDescription = text.replace(DRAWING_SECTION_RE, '')
  const unmentioned = [...figureMarks].filter(n => !mentionedAsToken(outsideDrawingDescription, n) && !mentionedAsToken(claims ?? '', n))
  if (unmentioned.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      section: '具体实施方式',
      message: `附图标记 ${unmentioned.join('、')} 未在说明书正文（具体实施方式）或权利要求中提及`,
      suggestion: '在具体实施方式中对照附图标记说明对应部件，保持图文一致',
    })
  }
  const claimedMarks = extractClaimMarks(claims)
  const claimedMissing = claimedMarks.filter(n => !figureMarks.has(n))
  if (claimedMissing.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      section: '权利要求书',
      message: `权利要求引用的附图标记 ${claimedMissing.join('、')} 在附图中不存在`,
      suggestion: '核对权利要求中的括号标号与图面标号，删除或更正不存在的标号',
    })
  }

  return violations
}

/**
 * 提取摘要中指定的摘要附图号（「摘要附图为图3」等形式）。
 * @param abstract - 摘要文本。
 * @returns 图号；未指定或无法解析时 undefined。
 */
export function extractAbstractDrawingNumber(abstract: string): number | undefined {
  const match = /摘要附图[^0-9]{0,8}?(\d+)/.exec(abstract)
  if (match === null) return undefined
  const value = Number(match[1])
  /* v8 ignore next -- the pattern only captures digits, so the guard covers exotic numeric forms */
  return Number.isInteger(value) ? value : undefined
}

/**
 * 本申请已有的图号集合：优先取附图分析结果中的图号，其次从附图说明章节的「图N」提取。
 * @param text - 说明书全文。
 * @param figureAnalysis - 附图分析结果（可选）。
 * @returns 升序去重的图号列表。
 */
export function knownFigureNumbers(text: string, figureAnalysis?: FigureAnalysisResult[]): number[] {
  const numbers = new Set<number>()
  for (const figure of figureAnalysis ?? []) {
    if (figure.figureNumber !== undefined) numbers.add(figure.figureNumber)
  }
  const section = getDrawingSection(text)
  if (numbers.size === 0 && section !== '') {
    const pattern = /图\s*(\d+)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(section)) !== null) {
      const value = Number(match[1])
      if (Number.isInteger(value)) numbers.add(value)
    }
  }
  return [...numbers].sort((a, b) => a - b)
}

/** 标号是否以独立数字 token 出现在给定文本中（避免把 2100 里的 100 当作标号）。 */function mentionedAsToken(text: string, numeral: string): boolean {
  if (text === '') return false
  return new RegExp(`(^|[^\\d])${numeral}([^\\d]|$)`).test(text)
}

/**
 * 提取权利要求中带括号引用的附图标记（细则第二十二条第四款规定的引用形式）。
 * @param claims - 权利要求书全文；缺省时返回空数组。
 * @returns 去重后的标号列表（保持首次出现顺序）。
 */
export function extractClaimMarks(claims: string | undefined): string[] {
  if (claims === undefined || claims === '') return []
  const marks: string[] = []
  const pattern = /[（(]\s*(\d{1,4})\s*[）)]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(claims)) !== null) {
    const mark = match[1]
    /* v8 ignore next -- the mark pattern always captures the mark group. */
    if (mark !== undefined && !marks.includes(mark)) marks.push(mark)
  }
  return marks
}

const DRAWING_SECTION_RE = /^#{1,3}\s*附图说明\s*\n([\s\S]*?)(?=^#{1,3}\s|\s*$)/m

/**
 * Extract the drawing-description section body.
 * @param text - the specification text.
 * @returns the section body, or an empty string when the section is absent.
 */
export function getDrawingSection(text: string): string {
  return text.match(DRAWING_SECTION_RE)?.[1] ?? ''
}

/**
 * Count "图N" references inside the drawing-description section.
 * @param text - the specification text.
 * @returns the number of references inside that section.
 */
export function countInDrawingSection(text: string): number {
  return (getDrawingSection(text).match(/图\s*[一二三四五六七八九十\d]+/g) ?? []).length
}
