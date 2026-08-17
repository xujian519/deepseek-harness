/**
 * 输出级质量门禁（移植自 Mady guardrails/：disclaimer.go + deferred_persist.go + citation_gate.go）。
 *
 * 在 Agent 输出写入会话存储前调用：
 *   - 风险词命中 → 追加免责声明
 *   - 审批词命中 → 标记挂起（SuppressPersist 语义）
 *   - 法条引用核验（CitationGate）：R1 存在性 + R2 语境相关性，误报防线：Unknown/Unverifiable 一律放行
 */

import { hasNegationContext, parseCnNumber } from '@deepseek-ai/dsh-patent-core'

export const PATENT_DISCLAIMER =
  '本分析由 AI 辅助生成，不构成正式法律意见。专利申请和专利性判断应由具备资质的专利代理人或专利律师确认。'

/** 专利域风险词：命中即追加免责声明。 */
export const PATENT_RISK_KEYWORDS = [
  '侵权',
  '无效',
  '驳回',
  '不授权',
  '专利性',
  '自由实施',
  '新颖性结论',
  '创造性结论',
]

/** 专利域审批词：命中即挂起，需人工审批后才入库。 */
export const PATENT_APPROVAL_KEYWORDS = ['专利结论', '侵权判断', '有效性结论', '最终建议']

/** 绝对化表述（P-A07 条款：回避绝对化表述）。 */
export const ABSOLUTE_PHRASES = ['绝对', '一定', '百分百', '毫无疑问', '必然']

/** 按 Unicode 码点截断（对齐 Go runeSlice）；ellipsis 为 true 时超长追加省略号。 */
function runeSlice(s: string, n: number, ellipsis = false): string {
  const runes = [...s]
  if (runes.length <= n) return s
  return `${runes.slice(0, n).join('')}${ellipsis ? '…' : ''}`
}

/** 过滤否定语境中的命中：关键词至少一处非否定命中才报告。 */
function filterNegatedHits(keywords: string[], text: string): string[] {
  return keywords.filter((k) => {
    let searchFrom = 0
    while (true) {
      const index = text.indexOf(k, searchFrom)
      if (index < 0) return false
      if (!hasNegationContext(text, index)) return true
      searchFrom = index + k.length
    }
  })
}

export type QualityGateResult = {
  /** 处理后的文本（可能已追加免责声明 / 存疑提示） */
  text: string
  /** 命中风险词（已注入免责声明） */
  riskKeywordsHit: string[]
  /** 命中审批词（需人工审批） */
  approvalKeywordsHit: string[]
  /** 命中绝对化表述 */
  absolutePhrasesHit: string[]
  /** 是否应挂起持久化（审批通过前不入库） */
  needsApproval: boolean
  /** 免责声明是否已注入 */
  disclaimerInjected: boolean
  /** 法条引用核验报告 */
  citationReport: CitationReport
}

/** 暂存队列：审批通过 Commit / 拒绝 Discard（未人工复核不入库）。 */
export class DeferredPersistQueue<T> {
  private readonly messages = new Map<number, T>()
  private nextIndex = 0

  store(message: T): number {
    const index = this.nextIndex
    this.nextIndex += 1
    this.messages.set(index, message)
    return index
  }

  commit(index: number): T | undefined {
    const msg = this.messages.get(index)
    if (msg !== undefined) this.messages.delete(index)
    return msg
  }

  discard(index: number): void {
    this.messages.delete(index)
  }

  pending(): number[] {
    return [...this.messages.keys()]
  }

  has(index: number): boolean {
    return this.messages.has(index)
  }

  get size(): number {
    return this.messages.size
  }
}

// ---------------------------------------------------------------------------
// CitationGate（法条引用核验）
// ---------------------------------------------------------------------------

export type CitationVerdict = 'valid' | 'unknown' | 'unverifiable' | 'suspect' | 'invalid'

export type FlaggedCitation = {
  raw: string
  statute: string
  article: number
  verdict: Exclude<CitationVerdict, 'valid' | 'unknown' | 'unverifiable'>
  reason: string
}

export type CitationReport = {
  total: number
  valid: number
  unknown: number
  unverifiable: number
  suspect: number
  invalid: number
  flagged: FlaggedCitation[]
}

/**
 * 静态法条主题表（S1 静态表；移植 Mady guardrails/citation_table.go 校准版）。
 */
const PATENT_LAW_TOPICS: Record<string, { max?: number; topics: Record<number, string[]> }> = {
  专利法: {
    max: 82,
    topics: {
      2: ['发明创造', '实用新型', '外观设计', '定义'],
      5: ['违反法律', '社会公德', '公共利益', '遗传资源', '不授予专利权'],
      9: ['同样的发明创造', '一项专利权', '先申请', '重复授权'],
      10: ['转让', '专利申请权'],
      11: ['实施', '制造', '使用', '许诺销售', '销售', '进口', '许可'],
      13: ['临时保护', '适当的费用', '公布后'],
      22: ['新颖性', '创造性', '实用性', '现有技术'],
      24: ['宽限期', '不丧失新颖性', '首次发表', '展览会'],
      25: ['科学发现', '智力活动', '疾病的诊断和治疗方法', '疾病治疗', '动物和植物品种', '原子核', '不授予专利权'],
      26: ['清楚', '完整', '支持', '摘要', '充分公开'],
      27: ['外观设计', '图片', '照片', '简要说明'],
      29: ['优先权', '外国优先权', '本国优先权', '十二个月', '六个月'],
      30: ['优先权', '书面声明', '副本'],
      31: ['单一性', '总的发明构思', '合案申请', '限于一项'],
      32: ['撤回'],
      33: ['修改', '超出', '原说明书和权利要求书记载的范围', '原图片或者照片'],
      34: ['初步审查', '公布', '十八个月'],
      35: ['实质审查', '请求', '三年', '视为撤回'],
      36: ['参考资料', '检索'],
      37: ['陈述意见', '视为撤回'],
      38: ['驳回'],
      39: ['实质审查', '授予', '发明专利权', '公告'],
      40: ['初步审查', '实用新型', '外观设计', '授予', '公告'],
      41: ['驳回', '复审', '起诉'],
      42: ['期限', '二十年', '十年', '十五年', '补偿'],
      43: ['年费'],
      44: ['终止', '年费', '放弃'],
      45: ['无效宣告', '请求'],
      46: ['无效宣告', '审查', '决定', '起诉'],
      47: ['无效宣告', '视为自始不存在', '效力', '追溯'],
      62: ['现有技术抗辩', '公知技术抗辩', '不构成侵权'],
      69: ['不视为侵权', '权利用尽', '先用权', '临时过境', '科研实验'],
      70: ['合法来源', '善意使用销售', '不承担赔偿责任'],
    },
  },
  专利法实施细则: {
    topics: {
      42: ['分案申请', '原申请', '两项以上发明'],
    },
  },
}

/**
 * invalidationGrounds：可作为无效宣告理由的实体条款（2008→2020 条号稳定）。
 */
const INVALIDATION_GROUNDS = new Set([2, 5, 9, 20, 22, 23, 25, 26, 27, 33])

/** 引用核验主题知识源（S1 静态表 / S2 知识库索引复合）。 */
export type CitationSource = {
  /** 该法条的存在性上限（undefined = 不做 R1 存在性核验）。 */
  maxArticle(statute: string): number | undefined
  /** 条号 → 注册主题词（undefined = 静态表未覆盖，放行）。 */
  topics(statute: string, article: number): string[] | undefined
}

/** 默认 S1 静态表知识源（内嵌 PATENT_LAW_TOPICS）。 */
const defaultCitationSource: CitationSource = {
  maxArticle: statute => PATENT_LAW_TOPICS[statute]?.max,
  topics: (statute, article) => PATENT_LAW_TOPICS[statute]?.topics[article],
}

const CITATION_PATTERN =
  /(?:专利法|实施细则)?第([零一二三四五六七八九十百d]+)条(?:第([零一二三四五六七八九十百d]+)款)?/g

const PURPOSE_CONNECTORS = [
  '专利法实施细则',
  '实施细则',
  '专利法',
  '审查指南',
  '根据',
  '依据',
  '按照',
  '依照',
  '参照',
  '符合',
  '违反',
  '详见',
  '参见',
  '的相关规定',
  '的规定',
  '规定',
  '所述',
  '要求',
]

/** 交叉匹配噪声词：过度泛化词不参与张冠李戴判定（误报防线）。 */
const CROSS_MATCH_NOISE = new Set([
  '实施',
  '使用',
  '许可',
  '公告',
  '决定',
  '审查',
  '放弃',
  '请求',
  '转让',
  '撤回',
  '检索',
  '制造',
  '销售',
  '进口',
  '支持',
  '定义',
  '补偿',
  '年费',
  '公布',
  '副本',
])

/**
 * 核验文本中的法条引用（R1 存在性 + R2 语境相关性）。
 * Unknown（表未覆盖）与 Unverifiable（无用途声明）一律放行。
 */
export function verifyCitations(text: string, source?: CitationSource): CitationReport {
  const citations = extractCitations(text)
  const report: CitationReport = {
    total: citations.length,
    valid: 0,
    unknown: 0,
    unverifiable: 0,
    suspect: 0,
    invalid: 0,
    flagged: [],
  }

  for (const c of citations) {
    const { verdict, reason } = verifyOne(c, text, source ?? defaultCitationSource)
    report[verdict] += 1
    if (verdict === 'suspect' || verdict === 'invalid') {
      report.flagged.push({ raw: c.raw, statute: c.statute, article: c.article, verdict, reason })
    }
  }
  return report
}

type ExtractedCitation = { statute: string; article: number; raw: string }

function extractCitations(text: string): ExtractedCitation[] {
  const result: ExtractedCitation[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(CITATION_PATTERN)) {
    const raw = m[0]
    let statute: string
    if (raw.includes('实施细则')) {
      statute = '专利法实施细则'
    } else if (raw.includes('专利法')) {
      statute = '专利法'
    } else {
      const start = Math.max(0, (m.index ?? 0) - 100)
      const beforeWindow = text.slice(start, m.index ?? 0)
      const lastBoundary = Math.max(
        beforeWindow.lastIndexOf('。'),
        beforeWindow.lastIndexOf('；'),
        beforeWindow.lastIndexOf('\n'),
      )
      const before = beforeWindow.slice(lastBoundary + 1)
      if (before.includes('实施细则')) statute = '专利法实施细则'
      else if (before.includes('专利法')) statute = '专利法'
      else continue
    }
    const article = parseCnNumber(m[1] ?? '')
    if (article === null) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    result.push({ statute, article, raw })
  }
  return result
}

function verifyOne(
  c: ExtractedCitation,
  fullText: string,
  source: CitationSource,
): { verdict: CitationVerdict; reason: string } {
  const max = source.maxArticle(c.statute) ?? PATENT_LAW_TOPICS[c.statute]?.max
  if (max !== undefined && c.article > max) {
    return { verdict: 'invalid', reason: `编号超出《${c.statute}》有效范围（共 ${max} 条）` }
  }

  const topics = source.topics(c.statute, c.article) ?? PATENT_LAW_TOPICS[c.statute]?.topics[c.article]
  if (topics === undefined) return { verdict: 'unknown', reason: '静态表未覆盖该条主题，放行' }

  const purposes = extractPurposes(c.raw, fullText)
  let firstCheckable: { match: string; display: string } | undefined
  for (const p of purposes) {
    if (purposeEmpty(p.match) || isEnumeration(p.trailing)) continue
    firstCheckable ??= p
    if (topics.some(kw => p.match.includes(kw))) return { verdict: 'valid', reason: '' }
  }

  if (firstCheckable === undefined) {
    return { verdict: 'unverifiable', reason: '无用途声明可核对，放行' }
  }
  const cross = crossMatch(c.statute, c.article, firstCheckable.match)
  if (cross !== null) {
    return {
      verdict: 'suspect',
      reason: `用途描述（${truncateRunes(firstCheckable.display, 20)}）与《${c.statute}》第${c.article}条主题（${topics.join('、')}）不一致，更接近《${cross.statute}》第${cross.article}条（${cross.keyword}）`,
    }
  }
  return { verdict: 'unverifiable', reason: '宽松转述，R2 无法判定，放行' }
}

/** 在 S1 静态表中查找命中 purpose 的另一条注册主题（含无效宣告同位命名特例）。 */
function crossMatch(
  selfStatute: string,
  selfArticle: number,
  purpose: string,
): { statute: string; article: number; keyword: string } | null {
  for (const [statute, table] of Object.entries(PATENT_LAW_TOPICS)) {
    for (const [article, keywords] of Object.entries(table.topics)) {
      const a = Number(article)
      if (statute === selfStatute && a === selfArticle) continue
      for (const kw of keywords) {
        if (CROSS_MATCH_NOISE.has(kw)) continue
        if (kw === '无效宣告' && selfStatute === '专利法' && INVALIDATION_GROUNDS.has(selfArticle)) continue
        if (purpose.includes(kw)) {
          return { statute, article: a, keyword: kw }
        }
      }
    }
  }
  return null
}

/** 提取引用的用途声明文本（遍历全部出现位置）。 */
function extractPurposes(raw: string, fullText: string): Array<{ match: string; display: string; trailing: string }> {
  const results: Array<{ match: string; display: string; trailing: string }> = []
  let from = 0
  while (true) {
    const idx = fullText.indexOf(raw, from)
    if (idx < 0) break
    from = idx + raw.length
    const leading = fullText.slice(0, idx)
    const trailing = fullText.slice(idx + raw.length)

    const leadingCut = Math.max(leading.lastIndexOf('。'), leading.lastIndexOf('；'), leading.lastIndexOf('\n'))
    let leadingClause = leadingCut >= 0 ? leading.slice(leadingCut + 1) : leading
    if (/第[零一二三四五六七八九十百\d]+条/.test(leadingClause)) leadingClause = ''

    let rawTrailing = trailing
    const trailingCut = trailing.search(/[。\n；;]/)
    if (trailingCut >= 0) rawTrailing = trailing.slice(0, trailingCut)

    leadingClause = leadingClause.trim()
    rawTrailing = rawTrailing.trim()
    const display = rawTrailing !== '' ? rawTrailing : leadingClause
    results.push({ match: `${leadingClause} ${rawTrailing}`.trim(), display, trailing })
  }
  return results
}

/** 枚举接续符：引用紧随其后出现另一个引用时，用途声明属于整个引用列表而非本条。 */
const ENUM_STARTERS = ['、', '或', '及', '和']

/** 判断引用后置文本是否以枚举接续符开头（trim 空白与括号前缀后）。 */
function isEnumeration(trailing: string): boolean {
  const t = trailing.trim().replace(/^[\s（）()*]+/, '')
  return ENUM_STARTERS.some(s => t.startsWith(s))
}

/** 按码点截断，超长追加省略号（复用 runeSlice，勿重复实现）。 */
function truncateRunes(s: string, n: number): string {
  return runeSlice(s, n, true)
}

function purposeEmpty(purpose: string): boolean {
  let s = purpose
  for (const conn of PURPOSE_CONNECTORS) s = s.split(conn).join('')
  return !/[\u4e00-\u9fff]/.test(s)
}

export function formatCitationWarnings(report: CitationReport): string {
  if (report.flagged.length === 0) return ''
  const lines = report.flagged.map(f => `- 「${f.raw}」：${f.reason}`)
  return `\n\n---\n⚠️ 引用核验提示（以下法条引用请人工核对）：\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// PatentQualityGate（输出门禁主入口）
// ---------------------------------------------------------------------------

export type PatentQualityGateOptions = {
  riskKeywords?: string[] | undefined
  approvalKeywords?: string[] | undefined
  absolutePhrases?: string[] | undefined
  disclaimer?: string | undefined
  /** 是否启用法条引用核验（默认 true） */
  enableCitationGate?: boolean | undefined
}

/**
 * 处理 Agent 输出：注入免责声明 / 标记审批挂起 / 法条核验。
 * 纯函数，不触碰存储——挂起消息由调用方存入 DeferredPersistQueue。
 */
export function processPatentOutput(text: string, options?: PatentQualityGateOptions): QualityGateResult {
  const riskKeywords = options?.riskKeywords ?? PATENT_RISK_KEYWORDS
  const approvalKeywords = options?.approvalKeywords ?? PATENT_APPROVAL_KEYWORDS
  const absolutePhrases = options?.absolutePhrases ?? ABSOLUTE_PHRASES
  const disclaimer = options?.disclaimer ?? PATENT_DISCLAIMER

  const riskHit = filterNegatedHits(riskKeywords, text)
  const approvalHit = approvalKeywords.filter(k => text.includes(k))
  const absoluteHit = filterNegatedHits(absolutePhrases, text)

  let output = text
  let disclaimerInjected = false
  if (riskHit.length > 0 && !text.includes('不构成正式法律意见')) {
    output = `${text}\n\n---\n${disclaimer}`
    disclaimerInjected = true
  }
  if (absoluteHit.length > 0 && !output.includes('绝对化表述')) {
    output = `${output}\n\n---\n⚠️ 提示：输出包含绝对化表述（${absoluteHit.join('、')}），请改为限定性表述。`
  }

  const citationReport = options?.enableCitationGate === false ? emptyReport() : verifyCitations(text)
  if (citationReport.flagged.length > 0 && !output.includes('引用核验提示')) {
    output += formatCitationWarnings(citationReport)
  }

  return {
    text: output,
    riskKeywordsHit: riskHit,
    approvalKeywordsHit: approvalHit,
    absolutePhrasesHit: absoluteHit,
    needsApproval: approvalHit.length > 0,
    disclaimerInjected,
    citationReport,
  }
}

function emptyReport(): CitationReport {
  return { total: 0, valid: 0, unknown: 0, unverifiable: 0, suspect: 0, invalid: 0, flagged: [] }
}
