/**
 * src/claim-lint — 权利要求书文本解析。
 *
 * 输入是工作区的 markdown 权利要求书（标题、说明、对照表都可能混在其中），输出按
 * 项切分的权利要求与权利要求正文之外的行。切分只认行首的「数字 + 句点/顿号」，
 * 因此项内的编号列表（「1）」「（1）」）不会被误当成新的一项。
 *
 * 折行按中文直接拼接：权利要求书是中文文书，行末断字不产生词间空格；英文词被
 * 折行切断的能力损失由此换来，起诉状需要时再按语言分支处理。
 */

import type { ParsedClaim } from './types.ts'

/** 权利要求行首：`1.` / `2、` / `3．`，编号后可有空白，且分隔符后必须还有正文。 */
const CLAIM_START = /^\d+\s*[.、．]\s*(?=\S)/

/** 非权利要求正文的行首：标题、引用块、表格、分隔线、图片。 */
const EXTRANEOUS_LINE = /^(?:#{1,6}(?:\s|$)|>|\||-{3,}|\*\*\*|!\[)/

/**
 * 引用部分：句首的「根据权利要求 N … 所述」。
 *
 * 编号后允许择一限定（「中任一项」「中任意一项」「中的任一项」「之一」「各」
 * 「中任一权利要求」）：这是多项从属权利要求的规范写法，认不出限定词就会把这类
 * 从属权项当成独立权利要求，引用链随之断开。
 *
 * 只锚定句首——独立权利要求正文里也会出现「权利要求 1 所述的转子」，那是交叉
 * 引用，不使本项成为从属权利要求。
 */
const REFERENCE_CLAUSE =
  /^根据权利要求\s*[0-9０-９][0-9０-９\s、，,或和及至\-—~～]*(?:(?:中\s*(?:的\s*)?)?(?:任(?:意)?一(?:项|权利要求)|之一))?各?\s*所述/

/** 引用部分里的择一限定词；区间判定前剥离，它们不参与编号。 */
const REFERENCE_QUALIFIER = /(?:中\s*(?:的\s*)?)?(?:任(?:意)?一(?:项|权利要求)|之一)|各/g

/** 区间展开上限：正常权项数远低于此，跨度更大的写法只保留端点，不按区间展开。 */
const MAX_REFERENCE_SPAN = 1000

/** 正文中的交叉引用：「权利要求 N 所述」。 */
const CROSS_REFERENCE = /权利要求\s*[0-9０-９]+\s*所述/g

/** 从属权利要求的主题名称：引用部分「所述（的）」之后至标点。 */
const DEPENDENT_SUBJECT = /所述(?:的)?([^，,；。]+)/

/** 独立权利要求的主题名称：「一种」之后至标点。 */
const INDEPENDENT_SUBJECT = /^一种([^，,；。]+)/

/** 一项权利要求引用另一项的区间写法：「1 至 3」「1-3」「1～3」。 */
const REFERENCE_RANGE = /^(\d+)\s*(?:-|—|~|～|至)\s*(\d+)$/

/** 解析结果：权利要求 + 正文之外的行。 */
export type ParsedClaimDocument = {
  /** 按原文顺序切分的权利要求。 */
  claims: ParsedClaim[]
  /** 权利要求正文之外的行（标题、说明、表格等），行号自 1 起。 */
  extraneous: Array<{ line: number; text: string }>
}

/**
 * 全角数字转半角。
 * @param value - 可能含全角数字的文本。
 * @returns 全角数字替换为半角后的文本。
 */
function toHalfWidth(value: string): string {
  return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
}

/**
 * 解析引用部分里的权项号，支持顿号、逗号、或/和/及分隔与区间写法。
 * @param clause - 引用部分原文。
 * @returns 升序去重后的权项号。
 */
function parseReferenceNumbers(clause: string): number[] {
  const body = clause.replace(/^根据权利要求/, '').replace(/所述$/, '')
  const numbers = new Set<number>()
  for (const part of toHalfWidth(body).replace(REFERENCE_QUALIFIER, '').split(/[、，,]|或|和|及/)) {
    const range = REFERENCE_RANGE.exec(part.trim())
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (Math.abs(to - from) > MAX_REFERENCE_SPAN) {
        // 写错的编号不展开：只留端点，引用方向规则会把不存在的权项报出来。
        numbers.add(from)
        numbers.add(to)
        continue
      }
      for (let n = Math.min(from, to); n <= Math.max(from, to); n += 1) numbers.add(n)
      continue
    }
    for (const token of part.matchAll(/\d+/g)) numbers.add(Number(token[0]))
  }
  return [...numbers].sort((a, b) => a - b)
}

/**
 * 取主题名称。
 * @param text - 权利要求全文。
 * @param dependent - 是否为从属权利要求。
 * @returns 主题名称；无法识别时为空串。
 */
function subjectOf(text: string, dependent: boolean): string {
  const match = (dependent ? DEPENDENT_SUBJECT : INDEPENDENT_SUBJECT).exec(text)
  const subject = match?.[1] ?? ''
  return subject.trim()
}

/**
 * 由序号与全文构造一项权利要求。
 * @param number - 原文所写的序号。
 * @param text - 拼接后的全文。
 * @returns 解析后的权利要求。
 */
function buildClaim(number: number, text: string): ParsedClaim {
  const clause = REFERENCE_CLAUSE.exec(text)
  const referenceClause = clause?.[0] ?? null
  const references = referenceClause === null ? [] : parseReferenceNumbers(referenceClause)
  const cross = new Set<number>()
  for (const match of text.matchAll(CROSS_REFERENCE)) {
    const target = Number(toHalfWidth(match[0].replace(/[^0-9０-９]/g, '')))
    if (target !== number && !references.includes(target)) cross.add(target)
  }
  return {
    number,
    text,
    independent: referenceClause === null,
    referenceClause,
    references,
    crossReferences: [...cross].sort((a, b) => a - b),
    subject: subjectOf(text, referenceClause !== null),
  }
}

/**
 * 把权利要求书文本切分为权利要求与正文之外的行。
 * @param source - 权利要求书全文（markdown 或纯文本）。
 * @returns 权利要求列表与正文之外的行。
 */
export function parseClaimDocument(source: string): ParsedClaimDocument {
  const claims: ParsedClaim[] = []
  const extraneous: ParsedClaimDocument['extraneous'] = []
  let current: { number: number; lines: string[] } | null = null
  const flush = (): void => {
    if (current === null) return
    claims.push(buildClaim(current.number, current.lines.join('')))
    current = null
  }
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line === '') continue
    const start = CLAIM_START.exec(line)
    if (start !== null) {
      flush()
      current = { number: Number.parseInt(line, 10), lines: [line.slice(start[0].length)] }
      continue
    }
    if (EXTRANEOUS_LINE.test(line)) {
      flush()
      extraneous.push({ line: index + 1, text: line })
      continue
    }
    if (current !== null) {
      current.lines.push(line)
      continue
    }
    extraneous.push({ line: index + 1, text: line })
  }
  flush()
  return { claims, extraneous }
}
