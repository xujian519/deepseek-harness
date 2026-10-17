/**
 * 检索域原子：search（现有技术检索）+ keywords（检索关键词生成）。
 */

import { type Atom } from '../../atom.ts'
import {
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
  getStateArray,
  getStateString,
} from '../../handler.ts'
import { dataBlock } from '../../../prompt-hygiene.ts'
import type { StageSearchHit } from '../../../types.ts'
import { callLlm, degraded, parseLlmJson, requireLlm, resolveInputText } from './llm.ts'
import { isRecord } from './state-keys.ts'

// ---------------------------------------------------------------------------
// search —— 检索现有技术
// ---------------------------------------------------------------------------

/** 摘要中单条命中的摘要片段上限：完整条目仍在 `prior_art` 中。 */
const SEARCH_SNIPPET_LIMIT = 300

/**
 * 把一条检索结果渲染成摘要行。收口阶段只能读到主输出文本，命中详情必须进入
 * `search_summary`，否则它只看到“检索到 N 篇”而无法逐项对比。
 * @param doc - 检索命中或调用方提供的证据条目。
 * @param index - 条目在最终数组中的位次，用于 D 标号。
 * @returns 标题行加上可选的摘要片段行。
 */
function renderHit(doc: unknown, index: number): string[] {
  if (!isRecord(doc)) return [`- D${index + 1} ${String(doc).slice(0, SEARCH_SNIPPET_LIMIT)}`]
  const title = typeof doc.title === 'string' && doc.title.trim().length > 0 ? doc.title.trim() : `#${index + 1}`
  const rawLabel = typeof doc.dLabel === 'string' ? doc.dLabel.trim() : ''
  const label = /^D\d+$/.test(rawLabel) ? rawLabel : `D${index + 1}`
  const publicationDate = typeof doc.publicationDate === 'string' ? doc.publicationDate.trim() : ''
  const url = typeof doc.url === 'string' ? doc.url.trim() : ''
  const meta = [
    publicationDate.length > 0 ? `公开日 ${publicationDate}` : undefined,
    url.length > 0 ? url : undefined,
  ].filter((part): part is string => part !== undefined)
  const headline = `- ${label} ${title}${meta.length > 0 ? `｜${meta.join('｜')}` : ''}`
  const snippet = typeof doc.snippet === 'string' ? doc.snippet.trim() : ''
  if (snippet.length === 0) return [headline]
  const capped = snippet.length > SEARCH_SNIPPET_LIMIT ? `${snippet.slice(0, SEARCH_SNIPPET_LIMIT)}…` : snippet
  return [headline, `  ${capped}`]
}

/** 条目去重键：URL 优先，其次标题；两者都没有时无法去重。 */
function docKey(doc: unknown): string | undefined {
  if (!isRecord(doc)) return undefined
  for (const key of ['url', 'title'] as const) {
    const value = doc[key]
    if (typeof value === 'string' && value.trim().length > 0) return `${key}:${value.trim().toLowerCase()}`
  }
  return undefined
}

/**
 * 合并调用方提供的证据与本次检索命中。调用方传入的 `prior_art` 是已核实的
 * 现有技术，检索原子不能把它覆盖掉；同一文献按 URL/标题去重。
 * @param existing - 调用方提供的条目（非数组视为未提供）。
 * @param hits - 本次检索命中。
 * @returns 合并后的条目，调用方条目在前。
 */
function mergePriorArt(existing: unknown, hits: StageSearchHit[]): unknown[] {
  const base: unknown[] = []
  if (Array.isArray(existing)) {
    for (const item of existing) base.push(item)
  }
  const seen = new Set(base.map(docKey).filter((key): key is string => key !== undefined))
  for (const hit of hits) {
    const key = docKey(hit)
    if (key !== undefined) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    base.push(hit)
  }
  return base
}

/** search 原子：检索现有技术文献。 */
export const searchAtom: Atom = {
  name: 'search',
  description: '按查询条件检索现有技术文献，产出文档列表与摘要',
  category: 'search',
  inputSchema: ['query', 'keywords', 'max_results'],
  // 主输出键（outputSchema[0]）为可读文本 search_summary；prior_art 供后续阶段消费。
  outputSchema: ['search_summary', 'prior_art'],
}

/** search 执行器：检索现有技术并产出文档列表与摘要。 */
export class SearchHandler implements StageHandler {
  readonly name = 'search'
  readonly category = 'search' as const

  /**
   * 执行 search 阶段（在先技术检索），返回下一管线状态。
   * @param execInput - 阶段执行输入（state 与 LLM provider）。
   * @returns 下一管线状态（可能带降级标记）。
   */
  async execute(execInput: StageExecuteInput): Promise<PipelineState> {
    const { state, provider } = execInput
    // 查询词：显式 query/search_query 优先；其次 keywords 键——KeywordsHandler
    // 产出的是字符串数组，需 join 为查询串（此前 getStateString 对数组返回空，
    // 导致 disclosure 管线的 search 阶段在原子执行下恒降级）。
    const explicit = resolveInputText(state, ['query', 'search_query'], '')
    const query =
      explicit ||
      getStateArray(state, 'keywords').map(String).filter(Boolean).join(' ') ||
      getStateString(state, 'keywords')
    if (!provider?.search) {
      return degraded('search', '未配置检索器（provider.search 缺失）')
    }
    if (query.trim().length === 0) {
      return degraded('search', '查询条件为空')
    }
    try {
      const maxResults = Number(getStateString(state, 'max_results')) || 5
      const hits = await provider.search(query, { maxResults })
      const existing = Array.isArray(state['prior_art']) ? state['prior_art'] : []
      const docs = mergePriorArt(state['prior_art'], hits)
      const supplied = existing.length > 0 ? `；连同调用方提供的 ${existing.length} 篇，共 ${docs.length} 篇` : ''
      const header =
        hits.length > 0
          ? `检索到 ${hits.length} 篇相关文献（查询: ${query.slice(0, 80)}${query.length > 80 ? '…' : ''}）${supplied}`
          : `未检索到相关文献（查询: ${query.slice(0, 80)}${query.length > 80 ? '…' : ''}）${supplied}`
      const summary = [header, ...docs.flatMap((doc, index) => renderHit(doc, index))].join('\n')
      return { prior_art: docs, search_summary: summary }
    } catch (err) {
      return degraded('search', `检索失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// keywords —— 检索关键词生成（移植 Mady disclosure/keywords.go）
// ---------------------------------------------------------------------------

/** keywords 原子：生成专利检索关键词。 */
export const keywordsAtom: Atom = {
  name: 'keywords',
  description: '基于技术交底书分析摘要生成专利检索关键词（5-15 个，含上下位与同义词）',
  category: 'search',
  inputSchema: ['extraction_result', 'source_text', 'text', 'input'],
  outputSchema: ['keywords'],
  usesModel: true,
}

const KEYWORDS_SCHEMA = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: '检索关键词列表' },
  },
  required: ['keywords'],
} as const

/** keywords 执行器：生成检索关键词列表。 */
export class KeywordsHandler implements StageHandler {
  readonly name = 'keywords'
  readonly category = 'search' as const

  /**
   * 执行 keywords 阶段（关键词抽取），返回下一管线状态。
   * @param execInput - 阶段执行输入（state 与 LLM provider）。
   * @returns 下一管线状态（可能带降级标记）。
   */
  async execute(execInput: StageExecuteInput): Promise<PipelineState> {
    const { state, provider, signal } = execInput
    const missing = requireLlm(provider, 'keywords')
    if (missing) return missing
    const input =
      getStateString(state, 'extraction_result') ||
      getStateString(state, 'source_text') ||
      getStateString(state, 'text') ||
      getStateString(state, 'input')
    if (input.trim().length === 0) {
      return degraded('keywords', '输入为空（state.extraction_result / source_text / text / input）')
    }
    const prompt = [
      '你是一个专利检索关键词生成助手。根据技术交底书分析摘要，生成检索关键词。',
      '要求：',
      '- 生成 5-15 个关键词，覆盖技术问题、技术特征、技术效果的核心概念',
      '- 关键词应包含上位概念和下位概念',
      '- 适当包含同义词和近义词以扩大检索覆盖面',
      '- 每个关键词应当简洁（2-8 个字）',
      '- 避免过于宽泛的常规词汇',
      '',
      '【分析摘要】',
      dataBlock(input.slice(0, 8000)),
      '',
      '请严格输出 JSON：{ "keywords": ["关键词1", "关键词2", ...] }',
    ].join('\n')
    const res = await callLlm(provider, 'keywords', prompt, { schema: KEYWORDS_SCHEMA, temperature: 0 }, signal)
    if (!res.ok) return res.error
    return parseLlmJson(
      res.raw,
      (parsed) => {
        if (!Array.isArray(parsed.keywords)) return null
        return { keywords: parsed.keywords.map(String) }
      },
      () => degraded('keywords', '关键词 JSON 解析失败'),
    )
  }
}
