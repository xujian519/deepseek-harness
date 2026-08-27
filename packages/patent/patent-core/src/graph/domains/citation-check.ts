/**
 * src/patent/graph/domains/citation-check — 引用真实性校验子图（纯函数，无 LLM 依赖）。
 *
 * 校验创造性/新颖性结论中引用的对比文件（D1/D2 或专利号）是否真实出现在检索结果
 * prior_art 中，杜绝模型幻觉引用。提取规则（对齐 Sati citation-check 移植）：
 * - 优先用专利号正则（如 US11452699B2）从结论/检索命中提取；
 * - 结论为自由文本时仅提取专利号，不做标题/段落硬匹配；
 * - 无专利号时回退提取文档标识（对比文件N / 证据N / D<N>）做归一比对；
 * - prior_art 为空/检索降级时跳过硬校验（不双重惩罚）。
 *
 * 与 Sati 差异：refTexts 按 DSH typed same-process 契约类型化为 string[]（移除
 * 运行时 typeof 过滤）；其余提取/比对逻辑逐字移植。
 * @module @deepseek-ai/dsh-patent-core/graph/domains/citation-check
 */

import { GraphBuilder, type GraphNode } from '../index.ts'
import type { GraphState } from '../types.ts'
import { getStateArray, getStateString } from '../state.ts'

/** 专利号正则（国家代码 2 位 + 1-14 位数字 + 可选类型后缀）。
 * 已知误匹配面（对齐 Sati 决策"仅提取专利号"）：ZL 前缀的中国实用新型
 * （"ZL201311234567.X" 会截掉 ".X" 后缀）、自由文本中的 "IP2022" 类 token；
 * 引用侧与文档侧共用同一提取器，接地判定仍自洽，仅可能产生个别误报"未接地"。 */
export const PATENT_NUMBER_RE = /[A-Z]{2}\d{1,14}[A-Z]?\d*/g

/** 文档标识正则（对比文件2 / 证据1 / D3；D 标识前后须为非字母数字字符，兼容 JSON 键内提取）。 */
const DOC_LABEL_RES = [/(?:对比文件|证据)\s*(\d+)/g, /(?:^|[^\p{L}\p{N}])D(\d+)(?=$|[^\p{L}\p{N}])/gu]

/** 从文本提取引用标识：专利号优先；无专利号时归一文档标识（对比文件2 → D2）。
 * @param text - 要提取的引用文本（结论/检索命中拼接）。
 * @returns 去重后的引用标识列表。
 */
export function extractCitationIds(text: string): string[] {
  const ids: string[] = []
  for (const m of text.matchAll(PATENT_NUMBER_RE)) ids.push(m[0])
  if (ids.length > 0) return [...new Set(ids)]
  for (const re of DOC_LABEL_RES) {
    for (const m of text.matchAll(re)) {
      const n = m[1]
      /* v8 ignore next -- both DOC_LABEL_RES patterns carry exactly one mandatory group, so n is always defined. */
      if (n !== undefined) ids.push(`D${n}`)
    }
  }
  return [...new Set(ids)]
}

/** 从单篇检索命中提取标识（title + url + 可选 patent 字段）。
 * @param doc - 检索命中条目（对象字段任意）。
 * @returns 从该命中提取的引用标识列表。
 */
export function extractDocIds(doc: unknown): string[] {
  if (doc === null || typeof doc !== 'object') return []
  const record = doc as Record<string, unknown>
  const parts = [record.title, record.url, record.patent].filter(v => typeof v === 'string').join(' ')
  return extractCitationIds(parts)
}

/** 引用真实性校验结果。 */
export type CitationCheckResult = {
  /** 是否全部引用接地（无法校验时恒 true 放行）。 */
  grounded: boolean
  /** 未在检索命中中接地的引用标识。 */
  uncited: string[]
  /** 模型可见的校验报告（中文）。 */
  report: string
}

/** 引用是否接地：与某篇检索命中标识相等或互相包含（url 常带路径尾缀）。 */
function isGrounded(refId: string, docIds: string[]): boolean {
  return docIds.some(d => d === refId || d.includes(refId) || refId.includes(d))
}

/** 校验引用真实性：refTexts 中提取的引用标识须全部在 docs 中接地。
 * 无法校验（无引用标识 / 无检索命中标识）时放行并写说明，不误报。
 * @param opts - 引用文本与检索命中。
 * @returns 接地判定与报告。
 */
export function checkCitations(opts: { refTexts: readonly string[]; docs: readonly unknown[] }): CitationCheckResult {
  const { refTexts, docs } = opts
  if (docs.length === 0) {
    return { grounded: true, uncited: [], report: '引用真实性校验：检索结果为空，跳过硬校验' }
  }
  const refIds = extractCitationIds(refTexts.filter(t => t.trim().length > 0).join('\n'))
  if (refIds.length === 0) {
    return {
      grounded: true,
      uncited: [],
      report: '引用真实性校验：未提取到可校验的引用标识（专利号或文档标识），跳过硬校验',
    }
  }
  const docIds = docs.flatMap(extractDocIds)
  if (docIds.length === 0) {
    return {
      grounded: true,
      uncited: [],
      report: '引用真实性校验：检索结果无法提取标识（无专利号/文档标识），跳过硬校验',
    }
  }
  const uncited = refIds.filter(refId => !isGrounded(refId, docIds))
  if (uncited.length === 0) {
    return { grounded: true, uncited: [], report: `引用真实性校验：引用全部接地（${refIds.join('、')}）` }
  }
  return {
    grounded: false,
    uncited,
    report: `引用真实性校验：以下引用未在检索结果中找到对应对比文件: ${uncited.join('、')}（需核实引用或补充检索）`,
  }
}

/** 默认引用文本来源键（覆盖 inventiveness/novelty 结论与原始输入，多键回退）。 */
const DEFAULT_REF_TEXT_KEYS = [
  'inventiveness_conclusion',
  'inventiveness_closest',
  'inventiveness_hint',
  'novelty_report',
  'text',
] as const

/** 构建引用真实性校验子图的选项。 */
export type BuildCitationCheckGraphOptions = {
  /** 引用文本来源键（缺省覆盖 inventiveness/novelty 结论与原始输入，多键回退）。 */
  refTextKeys?: readonly string[]
}

/** 确定性校验节点：比对结论引用与 prior_art，写接地结果到 state。
 * @param refTextKeys - 引用文本来源键（多键回退）。
 * @returns 引用校验图节点。
 */
function citationCheckNode(refTextKeys: readonly string[]): GraphNode {
  // oxlint-disable-next-line typescript/require-await -- GraphNode contract requires Promise<StateDelta>
  return async ({ state }) => {
    const refTexts = refTextKeys.map(key => getStateString(state, key)).filter(text => text.trim().length > 0)
    const docs = getStateArray(state, 'prior_art')
    const result = checkCitations({ refTexts, docs })
    return {
      citation_check_grounded: result.grounded,
      citation_check_failures: result.uncited,
      citation_check_report: result.report,
    }
  }
}

/** 构建引用真实性校验子图（纯函数确定性校验，无 LLM/审批门）。
 * @param options - 子图构建选项。
 * @returns 未编译的图构建器。
 */
export function buildCitationCheckGraph(options: BuildCitationCheckGraphOptions = {}): GraphBuilder {
  const builder = new GraphBuilder()
  builder.addNode('check', citationCheckNode(options.refTextKeys ?? DEFAULT_REF_TEXT_KEYS))
  builder.addEdge('check', '__end__')
  return builder
}

/** 从图运行结果提取引用校验结论（供调用方/评测读取）。
 * @param state - 图运行结果状态。
 * @returns 解析出的引用校验字段（缺键时省略）。
 */
export function extractCitationCheckResult(state: GraphState): {
  grounded?: boolean
  uncited?: string[]
  report?: string
} {
  const grounded = state['citation_check_grounded']
  const uncited = state['citation_check_failures']
  const report = state['citation_check_report']
  return {
    ...(typeof grounded === 'boolean' ? { grounded } : {}),
    ...(Array.isArray(uncited) ? { uncited: uncited.map(String) } : {}),
    ...(typeof report === 'string' ? { report } : {}),
  }
}
