/**
 * src/claim-lint — 引用基础（antecedent basis）检查。
 *
 * 「所述 X」要求 X 在本项或所引用权项中先被引入。没有先引入的「所述 X」使该术语
 * 缺乏指代对象，属《专利法》第二十六条第四款的清楚性缺陷。
 *
 * 术语边界按虚词截断：`所述极靴的径向外表面` 的被指代术语是「极靴」，`所述气隙沿
 * 径向的尺寸` 是「气隙」。截断词表是启发式——中文没有形态学边界，组合词只能靠
 * 虚词与常见谓词切分；表外的组合词会整体参与匹配，宁可漏报也不误报。
 *
 * 复合术语（如 `所述转子铁芯外圆`，其中「转子铁芯」已单独引入）降为 warning：
 * 严格写法是「所述转子铁芯的外圆」，但整体术语在前文语境里是可理解的。
 */

/** 术语截断字符：虚词、介词、常见谓词的起始字与标点。 */
const TERM_STOP =
  /[的与及在为沿经上内之均分向由构形包设贴抵小大和或相，。、；：？！（）()【】[\]“”"'‘’\s]/

/** 「所述」之后最多取多少个字符作为术语。 */
const MAX_TERM_LENGTH = 8

/** 复合术语可被认可的最短已引入前缀。 */
const MIN_PREFIX_LENGTH = 2

/** 一处被指代的术语及其在权项文本中的起始下标。 */
export type ReferencedTerm = {
  /** 「所述」之后的术语。 */
  term: string
  /** 「所述」在权项文本中的起始下标。 */
  index: number
}

/** 一处引用基础缺口。 */
export type AntecedentGap = {
  /** 缺少在先引入的术语。 */
  term: string
  /** 命中处的原文片段。 */
  evidence: string
  /** error = 完全没有在先引入；warning = 整体是复合术语但组成部分已引入。 */
  severity: 'error' | 'warning'
  /** 面向模型与代理师的说明。 */
  message: string
}

/**
 * 取出权项文本中所有「所述 X」的被指代术语。
 * @param text - 一项权利要求的全文。
 * @returns 按出现顺序排列的术语与下标；术语短于两字的（如「所述的」）不返回。
 */
export function referencedTerms(text: string): ReferencedTerm[] {
  const marker = '所述'
  const terms: ReferencedTerm[] = []
  let from = 0
  for (;;) {
    const index = text.indexOf(marker, from)
    if (index < 0) break
    from = index + marker.length
    let end = from
    for (const char of text.slice(from, from + MAX_TERM_LENGTH)) {
      if (TERM_STOP.test(char)) break
      end += 1
    }
    const term = text.slice(from, end)
    if (term.length >= MIN_PREFIX_LENGTH) terms.push({ term, index })
  }
  return terms
}

/**
 * 在已引入文本中找该术语的最长已引入真前缀（用于识别复合术语）。
 * @param term - 待查术语。
 * @param introduced - 本项前文与所引用权项的全文。
 * @returns 最长已引入前缀；没有则返回 null。
 */
function introducedPrefix(term: string, introduced: string): string | null {
  for (let length = term.length - 1; length >= MIN_PREFIX_LENGTH; length -= 1) {
    const prefix = term.slice(0, length)
    if (introduced.includes(prefix)) return prefix
  }
  return null
}

/**
 * 检查一项权利要求的引用基础。
 * @param text - 本项权利要求全文。
 * @param priorText - 所引用权项（含交叉引用，传递闭包）的全文拼接。
 * @returns 引用基础缺口；同一术语只报一次。
 */
export function findAntecedentGaps(text: string, priorText: string): AntecedentGap[] {
  const gaps: AntecedentGap[] = []
  const reported = new Set<string>()
  for (const { term, index } of referencedTerms(text)) {
    if (reported.has(term)) continue
    const before = text.slice(0, index)
    const introduced = `${before}${priorText}`
    if (introduced.includes(term)) continue
    reported.add(term)
    const evidence = text.slice(index, Math.min(text.length, index + 20))
    const prefix = introducedPrefix(term, introduced)
    if (prefix === null) {
      gaps.push({
        term,
        evidence,
        severity: 'error',
        message: `「所述${term}」在本项及所引用的权利要求中没有在先引入，缺乏指代对象。`,
      })
      continue
    }
    gaps.push({
      term,
      evidence,
      severity: 'warning',
      message: `「所述${term}」的整体术语没有在先引入，其中「${prefix}」已引入；建议写成「所述${prefix}的…」以明确指代的整体。`,
    })
  }
  return gaps
}
