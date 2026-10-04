/**
 * 对外文书的机械合规检查：章节编号唯一有序、无内部工作章节。
 *
 * 这两条约束写在 `templates/patent/invalidation-opinion/references/conventions.md` 与
 * `checklist.md` 中，但只有文字约束时依赖逐项自觉执行。本模块把它们变成可执行检查，
 * 由渲染管线在注入后调用，并可由 `scripts/verify-patent-document-output.ts` 离线复用。
 * @module @deepseek-ai/dsh-patent-document/document/documentCompliance
 */

import { parseCnNumber } from '@deepseek-ai/dsh-patent-core'

/** 合规问题类别。 */
export type ComplianceRule = 'section-numbering' | 'internal-section'

/** 一条合规问题。 */
export interface ComplianceIssue {
  /** 命中的规则。 */
  rule: ComplianceRule
  /** 问题的可读描述，含命中的标题文本。 */
  message: string
}

/** 标题元素：开标签到配对闭标签的整体匹配。 */
const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi

/**
 * 章节编号：标题文本以中文数码（一至九十九）开头并后接「、」。数码的写法受限，
 * 因为编号要两两比大小：`一二`、`二十三五` 这类无法确定数值的写法按非章节编号跳过，
 * 不猜。命中的数码交给 {@link parseCnNumber} 取值。
 */
const SECTION_NUMBER_RE =
  /^(十[一二三四五六七八九]?|[一二三四五六七八九]十[一二三四五六七八九]?|[一二三四五六七八九])、/

/** 内部工作章节的标题关键词。命中即表示内部工作记录进入了对外件。 */
const INTERNAL_SECTION_KEYWORDS = [
  '待办',
  '待填',
  '核验记录',
  '引用核验',
  '修订记录',
  '修订说明',
  '最坏情形',
  '缺口汇总',
  '口径',
] as const

/**
 * 剥掉标题内的标签，返回可见文本。
 * @param inner - 标题元素的内部 HTML。
 * @returns 去除标签并修剪空白后的文本。
 */
function headingText(inner: string): string {
  return inner.replace(/<[^>]*>/g, '').trim()
}

/**
 * 检查文书 HTML 的章节编号与内部工作章节。
 *
 * 章节编号规则：章节级标题以中文数码开头（如 `一、总体立场`），其余层级不使用该编号形式。
 * 章节编号在同一文书内不得重复，且须按出现顺序递增。模板骨架编号与 section 内容自带的
 * 编号并存时，重复编号与层级冲突都会被检出。章节层级取文档中第一个带中文编号标题的层级，
 * 随包模板样例中带该编号的都用 h2（claims-spec 全篇不带该编号）；不写死 h2 是因为部署可
 * 自带编号层级不同的模板，写死会把合规文书整篇误报。
 * @param html - 渲染后的文书 HTML。
 * @returns 命中的合规问题；全部通过时为空数组。
 */
export function checkDocumentCompliance(html: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const seen = new Map<number, string>()
  let sectionLevel: number | undefined
  let previous = 0
  for (const match of html.matchAll(HEADING_RE)) {
    const level = Number(match[1])
    /* v8 ignore next -- 捕获组 2 由 HEADING_RE 保证存在；空值分支只为满足 noUncheckedIndexedAccess。 */
    const text = headingText(match[2] ?? '')
    if (text === '') continue
    const hitKeyword = INTERNAL_SECTION_KEYWORDS.find(keyword => text.includes(keyword))
    if (hitKeyword !== undefined) {
      issues.push({
        rule: 'internal-section',
        message: `标题含内部工作记录用语「${hitKeyword}」：${text}`,
      })
    }
    const numbered = SECTION_NUMBER_RE.exec(text)
    if (numbered === null) continue
    /* v8 ignore next -- 捕获组 1 由 SECTION_NUMBER_RE 保证存在；空值分支只为满足 noUncheckedIndexedAccess。 */
    const numeral = numbered[1] ?? ''
    if (sectionLevel === undefined) {
      sectionLevel = level
    } else if (level !== sectionLevel) {
      issues.push({
        rule: 'section-numbering',
        message: `章节编号只用于章节级标题（h${sectionLevel}），「${numeral}、」出现在 h${level}：${text}`,
      })
      continue
    }
    const value = parseCnNumber(numeral)
    /* v8 ignore next -- 数码写法已由 SECTION_NUMBER_RE 限定为良构，parseCnNumber 不返回 null。 */
    if (value === null) continue
    const duplicate = seen.get(value)
    if (duplicate !== undefined) {
      issues.push({
        rule: 'section-numbering',
        message: `章节编号「${numeral}、」重复：${duplicate} / ${text}`,
      })
      continue
    }
    if (value < previous) {
      issues.push({
        rule: 'section-numbering',
        message: `章节编号乱序：「${numeral}、」出现在编号 ${previous} 之后（${text}）`,
      })
    }
    seen.set(value, text)
    previous = Math.max(previous, value)
  }
  return issues
}
