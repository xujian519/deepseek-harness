/**
 * src/patent/notice — 审查意见通知书（OA）的确定性解析。
 *
 * 输入通知书正文，输出结构化事实：驳回类型（按首次出现位置排序并去重）、引用文献
 * （文献号、通知书标注的相关性类别、同句内提到的权项）、涉及的权项编号（区间展开为
 * 逐个编号）、审查员论点句。全部由关键词表与正则完成，不调用模型。
 *
 * 与上游 Mady `domains/rules/oa_parser.go` 的差异：
 * - 相关性不再默认 `A`。上游以"文献号紧邻字母 X"判定相关性，其余一律落 `A` 兜底，
 *   等于把"仅一般背景技术"当成已认定的事实；本模块只在文献号之后紧邻的位置出现
 *   `X类`/`（X）` 一类标注时返回相关性，未标注即省略该字段。
 * - 引用文献的权项不再恒空。上游 `CitedReference.ClaimsAffected` 无写入点，故全链路
 *   恒为空；本模块按文献号所在语句内的权项编号填充，该字段是**同句共现**而非审查员的
 *   权威对应，见 `CitedReference.claimsAffected`。
 * - 审查员论点按码位截取。上游以字节下标切分中文正文，可切出半个字符。
 * - 权项区间带宽度与编号上限，异常区间不展开。
 */

/**
 * 通知书驳回类型。`other` 表示未识别到具体驳回条款。
 */
export type NoticeRejectionType =
  | 'inventiveness'
  | 'novelty'
  | 'clarity'
  | 'support'
  | 'disclosure'
  | 'scope'
  | 'formal'
  | 'other'

/** 具体驳回类型（不含 `other`）。 */
export type NoticeRejectionGround = Exclude<NoticeRejectionType, 'other'>

/**
 * 驳回类型的中文标签，直接进中文报告。
 */
export const REJECTION_LABELS: Record<NoticeRejectionType, string> = {
  inventiveness: '创造性（专利法第22条第3款）',
  novelty: '新颖性（专利法第22条第2款）',
  clarity: '不清楚（专利法第26条第4款）',
  support: '得不到说明书支持（专利法第26条第4款）',
  disclosure: '公开不充分（专利法第26条第3款）',
  scope: '修改超范围（专利法第33条）',
  formal: '形式缺陷',
  other: '未识别到具体驳回条款',
}

/**
 * 各驳回类型的关键词与条款写法（大小写不敏感）。同一类型内任一词命中即算命中，
 * 位置取该类型全部命中中的最早值。
 */
export const REJECTION_PATTERNS: Record<NoticeRejectionGround, readonly string[]> = {
  inventiveness: ['创造性', '显而易见', '22条第3款', '不具备创造性'],
  novelty: ['新颖性', '不具备新颖性', '22条第2款', '技术方案被公开'],
  clarity: ['不清楚', '26条第4款', '简明'],
  support: ['不支持', '得不到说明书支持'],
  disclosure: ['公开不充分', '26条第3款', '无法实现'],
  scope: ['33条', '修改超范围', '超出原说明书', '超出原始记载'],
  formal: ['形式', '格式', '书写', '明显错误'],
}

/**
 * 驳回类型的简称，用于表格与标题（`REJECTION_LABELS` 带法条，适合正文陈述）。
 */
export const REJECTION_SHORT_LABELS: Record<NoticeRejectionType, string> = {
  inventiveness: '创造性',
  novelty: '新颖性',
  clarity: '不清楚',
  support: '不支持',
  disclosure: '公开不充分',
  scope: '修改超范围',
  formal: '形式缺陷',
  other: '未识别条款',
}

/**
 * 驳回类型的遍历顺序，同时是"首次出现位置相同"时的稳定次序。
 *
 * 与 `REJECTION_PATTERNS`、`REJECTION_LABELS`、`REJECTION_SHORT_LABELS` 四者的键集由穷尽
 * `Record` 类型约束保持一致：新增一种驳回类型必须同时补齐四处。
 */
export const REJECTION_ORDER: readonly NoticeRejectionGround[] = [
  'inventiveness',
  'novelty',
  'clarity',
  'support',
  'disclosure',
  'scope',
  'formal',
]

/** 通知书标注的对比文件相关性类别：X（影响新颖性/创造性）、Y（与其它文件结合影响创造性）、A（一般背景技术）、E（抵触申请）、P（申请日介于对比文件公开日与申请日之间）。 */
export type CitationRelevancy = 'X' | 'Y' | 'A' | 'E' | 'P'

/** 相关性类别的闭集，未列出的标注字母不识别，视为未标注。 */
const CITATION_RELEVANCIES: readonly CitationRelevancy[] = ['X', 'Y', 'A', 'E', 'P']

/** 括号形式的相关性标注：`（X）`。 */
const PARENTHESIZED_RELEVANCY = /[（(]\s*([XYAEP])\s*[）)]/i

/** 后缀形式的相关性标注：`X类`。 */
const SUFFIXED_RELEVANCY = /([XYAEP])\s*类/i

/**
 * 相关性标注的检索窗口宽度（UTF-16 码元）。
 *
 * 只取文献号**之后**该宽度内的标注，对应中文通知书的"文献号（X类）"写法。标注写在
 * 文献号之前的体裁（如外文检索报告的 `(X) CN…`）不被识别，回落为未标注；跨文献号取
 * 标注会把一篇文献的类别安到另一篇上，故不按语句范围放宽。
 */
const RELEVANCY_WINDOW_CHARS = 8

/** 专利文献号：国家/组织代码 + 至少 6 位数字 + 可选种类代码。 */
const PATENT_NUMBER = /(?:CN|US|WO|EP|JP|KR)\d{6,}[A-Z]?/g

/** 权利要求编号写法。 */
const CLAIM_NUMBER = /权利要求\s*(\d+)/g

/** 权利要求区间写法：`第1-5项`、`权利要求1至3`、`第1到5项`。 */
const CLAIM_RANGE = /(?:第|权利要求)\s*(\d+)\s*[-至到]\s*(\d+)\s*项?/g

/** 单个权项编号上限：四位数编号在实务中不存在。 */
const MAX_CLAIM_NUMBER = 999

/** 区间宽度上限：更宽的区间按笔误忽略，避免异常正文把编号表撑成上万项。 */
const CLAIM_RANGE_SPAN_LIMIT = 200

/**
 * 审查员论点的起始标记。
 *
 * 每个标记是一个固定字面量的正则；在原文上直接匹配，避免先整体转小写再按下标切分——
 * 个别字符的小写形式长度不同会让下标与原文错位。
 */
const ARGUMENT_MARKERS: readonly RegExp[] = [
  /审查员认为/iu,
  /对比文件/iu,
  /本领域技术人员/iu,
  /因此/iu,
  /所以/iu,
  /综上/iu,
]

/** 审查员论点片段的最大长度（码位）。 */
const ARGUMENT_SNIPPET_LIMIT = 200

/** 审查员论点的最短长度（码位）：更短的片段是残句，不进报告。 */
const ARGUMENT_MIN_LENGTH = 10

/** 审查员论点条数上限。 */
const ARGUMENT_MAX_COUNT = 5

/** 句末标点，用于把论点截到一句。 */
const SENTENCE_ENDINGS: readonly string[] = ['。', '；']

/** 语句分隔符，用于界定引用文献所在语句。 */
const SEGMENT_DELIMITERS = '。；;\n'

/** 通知书引用的对比文件。 */
export type CitedReference = {
  /** 文献号，如 `CN101234567A`。 */
  documentNumber: string
  /** 通知书标注的相关性类别：取文献号之后紧邻位置的 `（X）` 或 `X类`；未标注时省略该字段，不以 `A` 兜底。 */
  relevancy?: CitationRelevancy
  /**
   * 该文献号所在语句内提到的权项编号（升序去重）。
   *
   * 这是同句共现，不是审查员对"哪篇文献评述哪些权项"的权威对应；需要权威对应时以
   * 通知书正文为准。
   */
  claimsAffected: number[]
}

/** 通知书的结构化解析结果。 */
export type ParsedOfficeAction = {
  /** 主驳回类型：`rejectionTypes` 的首项；未识别到具体条款时为 `other`。 */
  rejectionType: NoticeRejectionType
  /** 全部驳回类型，按在正文中首次出现的位置排序去重。 */
  rejectionTypes: NoticeRejectionGround[]
  citations: CitedReference[]
  /** 正文提到的权项编号，升序去重，区间已展开。 */
  affectedClaims: number[]
  /** 审查员论点句，最多 5 条；无标记命中时为空数组。 */
  examinerArguments: string[]
}

/**
 * 读取必需捕获组的文本。
 *
 * 本模块的正则把捕获组写在必需分支上，匹配成功即意味着该组已参与匹配。
 * @param match - 成功的正则匹配结果。
 * @param index - 捕获组序号，0 表示整个匹配。
 * @returns 捕获组文本。
 */
function capture(match: RegExpExecArray, index: number): string {
  return match[index] as string
}

/**
 * 逐个返回正则命中。
 * @param text - 待扫描文本。
 * @param pattern - 带 `g` 标志的模块级正则。
 * @returns 命中数组，按出现顺序；进入前重置 `lastIndex`，避免上一次调用的残留位置造成漏匹配。
 */
function eachMatch(text: string, pattern: RegExp): RegExpExecArray[] {
  pattern.lastIndex = 0
  const matches: RegExpExecArray[] = []
  let match = pattern.exec(text)
  while (match !== null) {
    matches.push(match)
    match = pattern.exec(text)
  }
  return matches
}

/**
 * 返回文本中首个命中的模式下标。
 * @param loweredText - 已转小写的正文。
 * @param patterns - 待检查的模式，逐个小写后比较。
 * @returns 最早命中的下标；都未命中时为 -1。
 */
function earliestPatternIndex(loweredText: string, patterns: readonly string[]): number {
  let earliest = -1
  for (const pattern of patterns) {
    const index = loweredText.indexOf(pattern.toLowerCase())
    if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index
  }
  return earliest
}

/**
 * 识别正文中的全部驳回类型。
 * @param text - 通知书正文。
 * @returns 驳回类型，按首次出现位置排序去重；位置相同时按 `REJECTION_ORDER` 取序。
 */
export function detectRejectionTypes(text: string): NoticeRejectionGround[] {
  const loweredText = text.toLowerCase()
  const hits: { position: number; ground: NoticeRejectionGround }[] = []
  for (const ground of REJECTION_ORDER) {
    const position = earliestPatternIndex(loweredText, REJECTION_PATTERNS[ground])
    if (position >= 0) hits.push({ position, ground })
  }
  // 位置相同时保持表序：hits 按 REJECTION_ORDER 构造，而 Array.prototype.sort
  // 自 ES2019 起要求稳定，故无需显式次序键。
  hits.sort((left, right) => left.position - right.position)
  return hits.map(hit => hit.ground)
}

/**
 * 识别主驳回类型。通知书常同时引用多个条款，需要逐条答复时改用 `detectRejectionTypes`。
 * @param text - 通知书正文。
 * @returns 正文中最先出现的驳回类型；未识别到具体条款时为 `other`。
 */
export function detectRejectionType(text: string): NoticeRejectionType {
  return detectRejectionTypes(text)[0] ?? 'other'
}

/**
 * 取下标所在的语句。语句以句号、分号、换行为界。
 * @param text - 全文。
 * @param index - 语句内任一位置的下标。
 * @returns 不含分隔符的语句文本。
 */
function enclosingSegment(text: string, index: number): string {
  let start = 0
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (SEGMENT_DELIMITERS.includes(text.charAt(cursor))) {
      start = cursor + 1
      break
    }
  }
  let end = text.length
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (SEGMENT_DELIMITERS.includes(text.charAt(cursor))) {
      end = cursor
      break
    }
  }
  return text.slice(start, end)
}

/**
 * 读取文献号之后标注的相关性类别。
 * @param text - 通知书全文。
 * @param end - 文献号的结束下标。
 * @returns 标注的类别；窗口内未标注或标注字母不在闭集内时为 `undefined`。
 */
function citationRelevancy(text: string, end: number): CitationRelevancy | undefined {
  const window = text.slice(end, end + RELEVANCY_WINDOW_CHARS)
  const marker = PARENTHESIZED_RELEVANCY.exec(window)?.[1] ?? SUFFIXED_RELEVANCY.exec(window)?.[1]
  if (marker === undefined) return undefined
  const upper = marker.toUpperCase()
  return CITATION_RELEVANCIES.find(relevancy => relevancy === upper)
}

/**
 * 提取正文提到的权项编号，展开 `第1-5项`、`权利要求1至3`、`第1到5项` 一类区间。
 * @param text - 通知书正文或其中一段。
 * @returns 升序去重的权项编号；未提到权项时为空数组。
 */
export function extractAffectedClaims(text: string): number[] {
  const claims = new Set<number>()
  for (const match of eachMatch(text, CLAIM_NUMBER)) {
    const number = Number.parseInt(capture(match, 1), 10)
    if (number > 0 && number <= MAX_CLAIM_NUMBER) claims.add(number)
  }
  for (const match of eachMatch(text, CLAIM_RANGE)) {
    const start = Number.parseInt(capture(match, 1), 10)
    const end = Number.parseInt(capture(match, 2), 10)
    const withinRange = end - start <= CLAIM_RANGE_SPAN_LIMIT && end <= MAX_CLAIM_NUMBER
    if (start > 0 && start <= end && withinRange) {
      for (let number = start; number <= end; number += 1) claims.add(number)
    }
  }
  return [...claims].sort((left, right) => left - right)
}

/**
 * 提取正文引用的对比文件，按首次出现顺序去重。
 * @param text - 通知书正文。
 * @returns 引用文献；每项的相关性取文献号之后的标注，权项取同句共现，见 `CitedReference`。
 */
export function extractCitations(text: string): CitedReference[] {
  const seen = new Set<string>()
  const citations: CitedReference[] = []
  for (const match of eachMatch(text, PATENT_NUMBER)) {
    const documentNumber = capture(match, 0)
    if (seen.has(documentNumber)) continue
    seen.add(documentNumber)
    const reference: CitedReference = {
      documentNumber,
      claimsAffected: extractAffectedClaims(enclosingSegment(text, match.index)),
    }
    const relevancy = citationRelevancy(text, match.index + documentNumber.length)
    if (relevancy !== undefined) reference.relevancy = relevancy
    citations.push(reference)
  }
  return citations
}

/**
 * 取字符串开头的至多 `limit` 个码位。
 * @param text - 原文。
 * @param limit - 码位上限。
 * @returns 不切断代理对的字符串前缀。
 */
function leadingCodePoints(text: string, limit: number): string {
  let units = 0
  let points = 0
  while (units < text.length && points < limit) {
    const code = text.charCodeAt(units)
    units += code >= 0xd800 && code <= 0xdbff ? 2 : 1
    points += 1
  }
  return text.slice(0, units)
}

/**
 * 自 `position` 起截取一句论点。
 * @param text - 全文。
 * @param position - 论点起始下标。
 * @returns 至首个句末标点（含标点）的片段；句末标点超窗时取至窗尾。
 */
function argumentSnippet(text: string, position: number): string {
  const window = leadingCodePoints(text.slice(position), ARGUMENT_SNIPPET_LIMIT)
  const points = Array.from(window)
  const end = points.findIndex((point, offset) => offset > 0 && SENTENCE_ENDINGS.includes(point))
  return (end > 0 ? points.slice(0, end + 1).join('') : window).trim()
}

/**
 * 提取审查员论点句。
 * @param text - 通知书正文。
 * @returns 论点片段，按 `ARGUMENT_MARKERS` 的表序取，最多 5 条。
 */
export function extractExaminerArguments(text: string): string[] {
  const arguments_: string[] = []
  for (const marker of ARGUMENT_MARKERS) {
    if (arguments_.length >= ARGUMENT_MAX_COUNT) break
    const match = marker.exec(text)
    if (match === null) continue
    const snippet = argumentSnippet(text, match.index)
    if (Array.from(snippet).length > ARGUMENT_MIN_LENGTH) arguments_.push(snippet)
  }
  return arguments_
}

/**
 * 解析审查意见通知书，组合上述各步。
 * @param text - 通知书正文。
 * @returns 驳回类型、引用文献、涉及权项与审查员论点。
 */
export function parseOfficeAction(text: string): ParsedOfficeAction {
  const rejectionTypes = detectRejectionTypes(text)
  return {
    rejectionType: rejectionTypes[0] ?? 'other',
    rejectionTypes,
    citations: extractCitations(text),
    affectedClaims: extractAffectedClaims(text),
    examinerArguments: extractExaminerArguments(text),
  }
}

/**
 * 单篇引用文献的简短描述。
 * @param reference - 引用文献。
 * @returns `文献号（X 类）`；未标注相关性时只有文献号。
 */
function describeCitation(reference: CitedReference): string {
  return reference.relevancy === undefined
    ? reference.documentNumber
    : `${reference.documentNumber}（${reference.relevancy} 类）`
}

/**
 * 把解析结果渲染为中文摘要，供答复报告直接引用。
 *
 * 类型按中文标签呈现（上游输出英文枚举值，直接进中文报告不可读）；未识别到条款时
 * 明示"未识别"，不以某一类型兜底。
 * @param parsed - `parseOfficeAction` 的结果。
 * @returns 逐行摘要文本。
 */
export function formatOfficeActionSummary(parsed: ParsedOfficeAction): string {
  const grounds =
    parsed.rejectionTypes.length > 0
      ? parsed.rejectionTypes.map(ground => REJECTION_LABELS[ground]).join('、')
      : REJECTION_LABELS.other
  const claims = parsed.affectedClaims.length > 0 ? parsed.affectedClaims.join(', ') : '无'
  const citations =
    parsed.citations.length > 0 ? parsed.citations.map(describeCitation).join('、') : '无'
  const lines = [`驳回类型: ${grounds}`, `影响权利要求: ${claims}`, `引用文献: ${citations}`]
  if (parsed.examinerArguments.length > 0) {
    lines.push(`审查员论点: ${parsed.examinerArguments.join(' ')}`)
  }
  return lines.join('\n')
}
