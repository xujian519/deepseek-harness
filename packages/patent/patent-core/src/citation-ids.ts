/**
 * Citation identifiers shared by the citation check and the evidence ledger.
 *
 * The two must extract the same labels: a conclusion's `D<n>` must resolve to
 * the prior-art receipt the ledger assigns to that document. Keeping the
 * extraction in one module prevents the check and the stored receipts from
 * drifting apart.
 *
 * @module @deepseek-ai/dsh-patent-core/citation-ids
 */

/** 专利号正则（国家代码 2 位 + 1-14 位数字 + 可选类型后缀）。
 * 已知误匹配面（对齐 Sati 决策"仅提取专利号"）：ZL 前缀的中国实用新型
 * （"ZL201311234567.X" 会截掉 ".X" 后缀）、自由文本中的 "IP2022" 类 token；
 * 引用侧与文档侧共用同一提取器，接地判定仍自洽，仅可能产生个别误报"未接地"。 */
export const PATENT_NUMBER_RE = /[A-Z]{2}\d{1,14}[A-Z]?\d*/g

/** 文档标识正则（对比文件2 / 证据1 / D3；D 标识前后须为非字母数字字符，兼容 JSON 键内提取）。 */
const DOC_LABEL_RES = [/(?:对比文件|证据)\s*(\d+)/g, /(?:^|[^\p{L}\p{N}])D(\d+)(?=$|[^\p{L}\p{N}])/gu]

/**
 * 从文本提取引用标识：专利号优先；无专利号时归一文档标识（对比文件2 → D2）。
 * @param text - 要提取的引用文本（结论/检索命中拼接）。
 * @returns 去重后的引用标识列表。
 */
export function extractCitationIds(text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(PATENT_NUMBER_RE)) ids.push(m[0])
  if (ids.length > 0) return [...new Set(ids)]
  // 两个模式都恰好带一个必选捕获组，故 m[1] 必有值。
  for (const re of DOC_LABEL_RES) {
    for (const m of text.matchAll(re)) ids.push(`D${m[1]}`)
  }
  return [...new Set(ids)]
}

/**
 * 从单篇检索命中提取标识（title + url + 可选 patent 字段）。
 * @param doc - 检索命中条目（对象字段任意）。
 * @returns 从该命中提取的引用标识列表。
 */
export function extractDocIds(doc: unknown): string[] {
  if (doc === null || typeof doc !== 'object') return []
  const record = doc as Record<string, unknown>
  const parts = [record.title, record.url, record.patent].filter(v => typeof v === 'string').join(' ')
  return extractCitationIds(parts)
}
