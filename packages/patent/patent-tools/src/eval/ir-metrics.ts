/**
 * 检索质量度量：把「引擎排序 + 相关性判读」折成可比数值。
 *
 * 主指标是首次命中的位次（rank of first relevant）——它直接回答"要看的那篇排在第
 * 几条"，比单一命中率更贴近检索实务；MRR 是它的跨查询聚合，nDCG 是它的分级版本。
 *
 * 本模块只做算术：不检索、不读盘。语料、查询集与 BM25 基线排序都是测试资产
 * （tests/fixtures/retrieval-corpus/），基线排序由 node:sqlite 的 FTS5 bm25 算出，
 * 与 `dsh-patent-knowledge` 的检索同栈（tokenize=trigram，多词条 OR 组合）。
 * @module @deepseek-ai/dsh-patent-tools/eval/ir-metrics
 */

/** 相关性判读：文档 id → 相关度等级；0 或缺省表示不相关。 */
export type RelevanceJudgments = Readonly<Record<string, number>>

/** 一个查询的评估输入：引擎的排序结果与该查询的相关性判读。 */
export type RankedQuery = {
  /** 引擎返回的文档 id，最相关在前。 */
  ranking: readonly string[]
  /** 该查询的相关性判读。 */
  relevance: RelevanceJudgments
}

/**
 * 首次命中的位次（1 起）：排序里第一条相关文档的位置。
 * @param query - 排序结果与相关性判读。
 * @returns 位次；排序里没有相关文档时为 null（该查询被漏检）。
 */
export function rankOfFirstRelevant(query: RankedQuery): number | null {
  const index = query.ranking.findIndex(id => (query.relevance[id] ?? 0) > 0)
  return index === -1 ? null : index + 1
}

/**
 * 平均倒数位次：逐查询取首次命中位次的倒数，漏检记 0，再对查询集取均值。
 * @param queries - 查询集（排序结果与判读成对给出）。
 * @returns 均值；空查询集为 0。
 */
export function meanReciprocalRank(queries: readonly RankedQuery[]): number {
  if (queries.length === 0) return 0
  const total = queries.reduce((sum, query) => {
    const rank = rankOfFirstRelevant(query)
    return sum + (rank === null ? 0 : 1 / rank)
  }, 0)
  return total / queries.length
}

/**
 * nDCG@k：截断到前 k 位的分级增益，按该查询的理想排序归一。判读里的相关文档不足
 * k 篇时理想排序就是判读本身，因此 nDCG = 1 只表示"排序与判读自洽"，不表示该查询
 * 只有这些命中。
 * @param query - 排序结果与相关性判读。
 * @param k - 截断位次（1 起）。
 * @returns 归一化增益；判读里没有相关文档时为 0。
 */
export function ndcgAtK(query: RankedQuery, k: number): number {
  const gains = query.ranking.slice(0, k).map(id => query.relevance[id] ?? 0)
  const ideal = Object.values(query.relevance).filter(gain => gain > 0).sort((a, b) => b - a).slice(0, k)
  const idealGain = discountedGain(ideal)
  return idealGain === 0 ? 0 : discountedGain(gains) / idealGain
}

/** 折损累计增益：位次 i（0 起）的折损因子为 log2(i + 2)。 */
function discountedGain(gains: readonly number[]): number {
  return gains.reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0)
}
