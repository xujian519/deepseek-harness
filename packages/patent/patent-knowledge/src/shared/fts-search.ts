/**
 * FTS5 检索降级阶梯（knowledge-law-search / case-law-search 共用）。
 *
 * 阶梯：整句 phrase FTS → 切词 OR FTS → LIKE 兜底；FTS 抛异常或短查询
 * /FTS 不可用时整体走 LIKE（粘性降级由调用方 degrade 回调完成）。
 */

import { FTS_MIN_RUNES } from './fts.ts'
import { extractLawKeywords } from './keywords.ts'
import { errorMessage } from '@deepseek-ai/dsh-value'

/** 检索阶梯的输入（引擎注入各路径的查询函数）。 */
export type FtsSearchLadder<T> = {
  /** 已 trim 的非空检索词。 */
  keyword: string
  /** FTS 表是否存在且运行时可用。 */
  hasFts: boolean
  /** 是否已粘性降级（异常后置 true，后续直接 LIKE）。 */
  ftsDegraded: boolean
  /** 整句 FTS 查询。 */
  searchFts: (keyword: string) => T[]
  /** 切词 OR FTS 查询。 */
  searchFtsKeywords: (keywords: string[]) => T[]
  /** LIKE 兜底查询。 */
  searchLike: (keyword: string) => T[]
  /** 降级回调（入参为异常消息）。 */
  degrade: (reason: string) => void
}

/**
 * 执行一次 FTS 优先、LIKE 兜底的检索（含切词降级阶梯）。
 * @param ladder 检索词、FTS 可用性、三条查询路径与降级回调。
 * @returns 检索结果列表（行或命中，由调用方映射）。
 */
export function runFtsSearch<T>(ladder: FtsSearchLadder<T>): T[] {
  const { keyword, hasFts, ftsDegraded, searchFts, searchFtsKeywords, searchLike, degrade } = ladder
  const runes = Array.from(keyword)
  if (!hasFts || ftsDegraded || runes.length < FTS_MIN_RUNES) {
    return searchLike(keyword)
  }
  let result: T[]
  try {
    // 1. 整句 phrase（短查询命中率高）
    result = searchFts(keyword)
    // 2. 整句无命中时切词 OR 查询（长句/自然语言查询）
    if (result.length === 0) {
      const keywords = extractLawKeywords(keyword)
      if (keywords.length > 0 && keywords[0] !== keyword) {
        result = searchFtsKeywords(keywords)
      }
    }
    // 3. FTS 仍无命中时降级 LIKE
    if (result.length === 0) {
      result = searchLike(keyword)
    }
  } catch (error) {
    degrade(errorMessage(error))
    result = searchLike(keyword)
  }
  return result
}
