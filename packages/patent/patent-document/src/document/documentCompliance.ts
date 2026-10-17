/**
 * 对外文书的机械合规检查：章节编号唯一有序、无内部工作记录、证据编号与证据清单相互覆盖。
 *
 * 这些约束写在 `templates/patent/invalidation-opinion/references/conventions.md` 与
 * `checklist.md` 中，但只有文字约束时依赖逐项自觉执行。本模块把它们变成可执行检查，
 * 由渲染管线在注入后调用，并可由 `scripts/verify-patent-document-output.ts` 离线复用。
 *
 * 内部工作记录的两条来源不同，分别处理：标题命中标题词表（待办／核验记录／口径等），
 * 正文命中正文词表（成功概率分档、缺口汇总、内部文件路径等）。标题词表按裸词匹配，
 * 正文词表按语义表达式匹配（`成功率|胜诉率|成功概率`），目的是让正文检查只命中内部
 * 记录特有的表达，不命中对外文书中正常的同形词。
 * @module @deepseek-ai/dsh-patent-document/document/documentCompliance
 */

import { parseCnNumber } from '@deepseek-ai/dsh-patent-core'
import { findMatchingCloseTag } from './htmlScan.ts'

/** 合规问题类别。 */
export type ComplianceRule =
  | 'section-numbering'
  | 'internal-section'
  | 'internal-body'
  | 'evidence-cross-reference'

/**
 * 检查范围。对外文书不得含内部工作记录；内部记录模板（如内部无效分析意见）正是这些
 * 记录的存放处，只接受章节编号与证据编号核对。
 */
export type ComplianceScope = 'external-filing' | 'internal-record'

/** 一条合规问题。 */
export interface ComplianceIssue {
  /** 命中的规则。 */
  rule: ComplianceRule
  /** 问题的可读描述，含命中的标题或用语。 */
  message: string
}

/** 标题元素：开标签到配对闭标签的整体匹配。 */
const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi

/** 非正文元素：样式表、脚本与注释都不呈现给读者，不作为内部记录的证据。 */
const NON_VISIBLE_RE = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi

/**
 * 章节编号：标题文本以中文数码（一至九十九）开头并后接「、」。数码的写法受限，
 * 因为编号要两两比大小：`一二`、`二十三五` 这类无法确定数值的写法按非章节编号跳过，
 * 不猜。命中的数码交给 {@link parseCnNumber} 取值。
 */
const SECTION_NUMBER_RE =
  /^(十[一二三四五六七八九]?|[一二三四五六七八九]十[一二三四五六七八九]?|[一二三四五六七八九])、/

/** 内部工作章节的标题用语。命中即表示内部工作记录进入了对外件。 */
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
 * 正文中的内部工作记录用语。只收对外文书不可能出现的表达：成功概率分档是内部评估的
 * 结论形态，缺口汇总与待办是内部待办，`source_path` 是内部数据键。
 */
const INTERNAL_BODY_MARKERS: readonly { label: string; pattern: RegExp }[] = [
  { label: '待办/待填', pattern: /待办|待填|TODO|FIXME/ },
  { label: '核验记录', pattern: /核验记录|引用核验/ },
  { label: '修订记录', pattern: /修订记录|修订说明/ },
  { label: '最坏情形', pattern: /最坏情形/ },
  { label: '缺口汇总', pattern: /缺口汇总|缺口清单/ },
  { label: '成功概率分档', pattern: /成功率|胜诉率|成功概率|胜率/ },
  { label: '内部文件路径', pattern: /source_?path/i },
]

/**
 * 剥掉标签，返回元素或片段的可见文本。
 * @param html - 含标签的 HTML 片段。
 * @returns 去除标签并修剪空白后的文本。
 */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/**
 * 检查文书 HTML 的章节编号、内部工作记录与证据编号引用。
 *
 * 章节编号规则：章节级标题以中文数码开头（如 `一、总体立场`），其余层级不使用该编号形式。
 * 章节编号在同一文书内不得重复，且须按出现顺序递增。模板骨架编号与 section 内容自带的
 * 编号并存时，重复编号与层级冲突都会被检出。章节层级取文档中第一个带中文编号标题的层级，
 * 随包模板样例中带该编号的都用 h2（claims-spec 全篇不带该编号）；不写死 h2 是因为部署可
 * 自带编号层级不同的模板，写死会把合规文书整篇误报。
 *
 * 标题与正文两处检查都先剥掉不呈现给读者的内容（样式表、脚本、注释）：注释里的标题既不是
 * 章节编号，也不构成内部记录泄漏，与正文用语检查取自同一段可见文本。
 *
 * 证据编号核对（见 {@link evidenceIssues}）在两种范围内都做：内部记录件同样按一套编号
 * 记账，清单与正文对不上时先修草案再出件。
 * @param html - 渲染后的文书 HTML。
 * @param scope - 检查范围；`internal-record` 不做内部工作记录检查。
 * @returns 命中的合规问题；全部通过时为空数组。
 */
export function checkDocumentCompliance(html: string, scope: ComplianceScope = 'external-filing'): ComplianceIssue[] {
  const issues: ComplianceIssue[] = []
  const seen = new Map<number, string>()
  const isExternal = scope === 'external-filing'
  let sectionLevel: number | undefined
  let previous = 0
  for (const match of html.replace(NON_VISIBLE_RE, ' ').matchAll(HEADING_RE)) {
    const level = Number(match[1])
    /* v8 ignore next -- 捕获组 2 由 HEADING_RE 保证存在；空值分支只为满足 noUncheckedIndexedAccess。 */
    const text = visibleText(match[2] ?? '')
    if (text === '') continue
    const hitKeyword = INTERNAL_SECTION_KEYWORDS.find(keyword => text.includes(keyword))
    if (isExternal && hitKeyword !== undefined) {
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
  issues.push(...evidenceIssues(html))
  if (isExternal) issues.push(...bodyIssues(html))
  return issues
}

/**
 * 正文内部用语检查。标题及其用语已由标题检查覆盖，故先从正文里剥掉标题元素，避免同一处
 * 内容重复报告。
 * @param html - 渲染后的文书 HTML。
 * @returns 命中的正文问题。
 */
function bodyIssues(html: string): ComplianceIssue[] {
  const text = visibleText(html.replace(NON_VISIBLE_RE, ' ').replace(HEADING_RE, ' '))
  const issues: ComplianceIssue[] = []
  for (const marker of INTERNAL_BODY_MARKERS) {
    if (!marker.pattern.test(text)) continue
    issues.push({
      rule: 'internal-body',
      message: `正文含内部工作记录用语「${marker.label}」：内部评估与待办事项写入案卷内部文件`,
    })
  }
  return issues
}

/**
 * 证据清单表与清单节的定位标记。模板把清单节标成 `aria-label="证据清单"`，渲染管线另给
 * 表体挂 `id="evidence-table"` 注入锚点；随包样例保留 aria-label 而去掉注入锚点，故两者
 * 都认，先认节点后认锚点，任一命中即可核对。
 */
const EVIDENCE_SECTION_OPEN_RE = /<section[^>]*\saria-label=["']证据清单["'][^>]*>/i
const EVIDENCE_TABLE_BODY_RE = /<tbody[^>]*\sid=["']evidence-table["'][^>]*>/i

/** 证据编号的形态：前缀（`D`、`附件`…）+ 十进制序号。前缀取自清单编号列，不预设词表。 */
const EVIDENCE_ID_RE = /^(\D+?)\s*(\d+)$/

/** 未填写的编号列：空单元格，或模板占位的下划线。 */
const BLANK_ID_RE = /^_*$/

/** 编号区间的最大跨度：`D1–D4` 按四条展开，跨度更大的写法按普通文字处理。 */
const MAX_ID_RANGE_SPAN = 9

/** 正则元字符转义：编号前缀取自文档内容，直接拼进正则会被当成元字符。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 取捕获组文本。捕获组由本模块各正则的必选分组保证存在，空值分支不可达，只为满足
 * noUncheckedIndexedAccess（仓内禁用非空断言）。
 * @param match - 正则匹配结果。
 * @param index - 捕获组序号。
 * @returns 捕获组文本。
 */
function group(match: RegExpExecArray, index: number): string {
  /* v8 ignore next -- 捕获组由调用方正则的必选分组保证存在。 */
  return match[index] ?? ''
}

/** 编号的规范形态：前缀 + 十进制序号（去掉前导零），清单与正文两侧比对用同一形态。 */
function canonicalId(prefix: string, number: number): string {
  return `${prefix}${number}`
}

/**
 * 清单编号列取值 → 规范编号与前缀；取值不是「前缀 + 序号」形态时返回 undefined。
 * @param id - 编号列单元格的可见文本（已去掉中间空白）。
 * @returns 规范编号（`D01` → `D1`）与该编号的前缀；无法识别时为 undefined。
 */
function parseEvidenceId(id: string): { id: string; prefix: string } | undefined {
  const match = EVIDENCE_ID_RE.exec(id)
  if (match === null) return undefined
  const prefix = group(match, 1)
  return { id: canonicalId(prefix, Number(group(match, 2))), prefix }
}

/**
 * 取证据清单表在 HTML 中的区间（含 `<table>` 与 `</table>`）。
 * @param html - 渲染后的文书 HTML。
 * @returns 清单表的起止下标；文档没有带标记的清单表时 undefined。
 */
function evidenceTableRange(html: string): { start: number; end: number } | undefined {
  const section = EVIDENCE_SECTION_OPEN_RE.exec(html)
  let start: number
  if (section === null) {
    const body = EVIDENCE_TABLE_BODY_RE.exec(html)
    if (body === null) return undefined
    start = html.lastIndexOf('<table', body.index)
  } else {
    const bodyStart = section.index + section[0].length
    const sectionEnd = findMatchingCloseTag(html, bodyStart) ?? html.length
    const table = /<table[^>]*>/i.exec(html.slice(bodyStart, sectionEnd))
    if (table === null) return undefined
    start = bodyStart + table.index
  }
  // 定位失败时 start 为 -1 或落在非开标签处，下面的正则匹配不中，按没有清单表处理。
  const open = /^<table[^>]*>/i.exec(html.slice(start))
  if (open === null) return undefined
  const close = findMatchingCloseTag(html, start + open[0].length)
  if (close === undefined) return undefined
  return { start, end: close + '</table>'.length }
}

/**
 * 取清单表的编号列：每个数据行第一个单元格的可见文本。
 * @param table - 证据清单表 HTML（含表头与表体）。
 * @returns 按行序排列的编号；单元格未填写时为空串；没有表体时为空数组。
 */
function evidenceIds(table: string): string[] {
  const ids: string[] = []
  for (const tbody of table.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    for (const row of group(tbody, 1).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cell = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(group(row, 1))
      ids.push(cell === null ? '' : visibleText(group(cell, 1)).replace(/\s+/g, ''))
    }
  }
  return ids
}

/**
 * 取正文文本里的证据编号引用。只认清单编号列出现过的前缀，因此专利号与附图标记里的数字
 * 不会被当成证据编号，编号列写成纯数字的清单也不参与核对（无法与正文中的序号区分）。
 * 区间写法（`D1–D4`、`D1 至 D4`）按逐个编号展开，登记为一条范围证据时不会误报未引用。
 * @param text - 清单表之外的可见正文文本。
 * @param prefixes - 清单编号列出现过的前缀。
 * @returns 正文引用到的编号（规范形态）。
 */
function citedIds(text: string, prefixes: readonly string[]): Set<string> {
  const cited = new Set<string>()
  for (const prefix of prefixes) {
    const escaped = escapeRegExp(prefix)
    // 前缀左侧不是字母数字，避免把单词尾部的同形前缀当成编号（如 `END2`）。
    for (const match of text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escaped}\\s*(\\d+)`, 'g'))) {
      cited.add(canonicalId(prefix, Number(match[1])))
    }
    const range = new RegExp(`(?<![A-Za-z0-9])${escaped}\\s*(\\d+)\\s*[-–—~～至]\\s*(?:${escaped}\\s*)?(\\d+)`, 'g')
    for (const match of text.matchAll(range)) {
      const from = Number(match[1])
      const to = Number(match[2])
      if (to <= from || to - from > MAX_ID_RANGE_SPAN) continue
      for (let number = from + 1; number <= to; number += 1) cited.add(canonicalId(prefix, number))
    }
  }
  return cited
}

/**
 * 证据编号与清单的相互覆盖检查。
 *
 * 两侧的编号形态都取自清单编号列，不预设编号词表：正文引用的编号必须在清单里登记，清单
 * 登记的编号必须在正文（清单表之外）出现一次。清单表本身不计入引用位置——表里的编号只是
 * 登记，不是使用。编号列留空的行无法被正文引用，单独报出。
 * @param html - 渲染后的文书 HTML。
 * @returns 命中的合规问题；文档没有证据清单表时为空数组。
 */
function evidenceIssues(html: string): ComplianceIssue[] {
  const range = evidenceTableRange(html)
  if (range === undefined) return []
  const issues: ComplianceIssue[] = []
  const registered = new Map<string, string>()
  evidenceIds(html.slice(range.start, range.end)).forEach((id, index) => {
    if (BLANK_ID_RE.test(id)) {
      issues.push({
        rule: 'evidence-cross-reference',
        message: `证据清单第 ${index + 1} 行未填编号：正文无法引用该条证据，登记编号后正文与清单共用同一写法`,
      })
      return
    }
    const parsed = parseEvidenceId(id)
    if (parsed !== undefined) registered.set(parsed.id, parsed.prefix)
  })
  const prefixes = [...new Set(registered.values())]
  if (prefixes.length === 0) return issues
  const rest = html.slice(0, range.start) + html.slice(range.end)
  const cited = citedIds(visibleText(rest.replace(NON_VISIBLE_RE, ' ')), prefixes)
  for (const id of registered.keys()) {
    if (cited.has(id)) continue
    issues.push({
      rule: 'evidence-cross-reference',
      message: `证据清单登记的「${id}」在正文中未被引用：删除该条，或在支撑的理由、结论表中引用它`,
    })
  }
  for (const id of cited) {
    if (registered.has(id)) continue
    issues.push({
      rule: 'evidence-cross-reference',
      message: `正文引用的「${id}」未登记在证据清单：在清单中补登该条证据`,
    })
  }
  return issues
}
