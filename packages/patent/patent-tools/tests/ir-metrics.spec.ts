// 检索质量度量门：把 FTS5 的 BM25 基线排序折成指标，并证明这把尺子能区分好坏。
// 语料、查询集与判读都是仓库自撰的测试资产（tests/fixtures/retrieval-corpus/），
// 无第三方数据、无网络依赖；基线排序由同栈的 FTS5（tokenize=trigram）产出。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { FTS_MIN_RUNES, joinFtsOrTerms, sqliteHasFts5 } from '@deepseek-ai/dsh-patent-knowledge'
import { meanReciprocalRank, ndcgAtK, rankOfFirstRelevant, type RankedQuery } from '@deepseek-ai/dsh-patent-tools'

const corpusDir = join(import.meta.dirname, 'fixtures', 'retrieval-corpus')
const readJson = (name: string): unknown => JSON.parse(readFileSync(join(corpusDir, name), 'utf8'))

type Document = { id: string; title: string; text: string }
type Query = { id: string; question: string; terms: string[]; relevant: Record<string, number> }
type RecordedQuery = { ranking: string[]; rankOfFirstRelevant: number | null; reciprocalRank: number; ndcgAtK: number }
const documents = (readJson('documents.json') as { documents: Document[] }).documents
const queries = (readJson('queries.json') as { queries: Query[] }).queries
const baseline = readJson('bm25-baseline.json') as {
  ndcgK: number
  queries: Record<string, RecordedQuery>
  aggregate: { meanReciprocalRank: number }
}

/** 判读里的相关文档一律排到末尾：这是最退化的排序，任何可用指标都必须判它更差。 */
function relevantLast(query: RankedQuery): RankedQuery {
  const relevant = (id: string): boolean => (query.relevance[id] ?? 0) > 0
  return {
    ranking: [...query.ranking.filter(id => !relevant(id)), ...query.ranking.filter(relevant)],
    relevance: query.relevance,
  }
}

/** 按记录下来的排序与判读组装评估输入。 */
function recordedQueries(): { id: string; query: RankedQuery }[] {
  return queries.map((q) => {
    const recorded = baseline.queries[q.id]
    if (recorded === undefined) throw new Error(`bm25-baseline.json 缺查询 ${q.id} 的记录`)
    return { id: q.id, query: { ranking: recorded.ranking, relevance: q.relevant } }
  })
}

describe('检索质量指标', () => {
  it('首次命中位次与 nDCG 与手算一致', () => {
    const query: RankedQuery = { ranking: ['a', 'b', 'c'], relevance: { c: 1 } }
    expect(rankOfFirstRelevant(query)).toBe(3)
    // 理想排序把 c 放首位：DCG = 1/log2(2) = 1；实际 DCG = 1/log2(4) = 0.5。
    expect(ndcgAtK(query, 3)).toBeCloseTo(0.5, 10)
    expect(ndcgAtK({ ...query, ranking: ['c', 'b', 'a'] }, 3)).toBeCloseTo(1, 10)
    expect(ndcgAtK(query, 2)).toBe(0)
  })

  it('分级相关度按增益加权：两条相关文档里第一条更相关', () => {
    const relevance = { a: 2, b: 1 }
    const good: RankedQuery = { ranking: ['a', 'b'], relevance }
    const swapped: RankedQuery = { ranking: ['b', 'a'], relevance }
    expect(rankOfFirstRelevant(good)).toBe(1)
    expect(rankOfFirstRelevant(swapped)).toBe(1)
    expect(ndcgAtK(good, 2)).toBeCloseTo(1, 10)
    // 交换后 DCG = 1/1 + 2/log2(3)；理想 DCG = 2/1 + 1/log2(3)。
    expect(ndcgAtK(swapped, 2)).toBeCloseTo((1 + 2 / Math.log2(3)) / (2 + 1 / Math.log2(3)), 10)
    expect(ndcgAtK(swapped, 2)).toBeLessThan(ndcgAtK(good, 2))
  })

  it('漏检记 null 与 0，空查询集为 0', () => {
    const missed: RankedQuery = { ranking: ['a', 'b'], relevance: { z: 2 } }
    expect(rankOfFirstRelevant(missed)).toBeNull()
    expect(rankOfFirstRelevant({ ranking: [], relevance: { a: 1 } })).toBeNull()
    expect(ndcgAtK(missed, 5)).toBe(0)
    // 判读里没有任何相关文档时理想增益为 0，nDCG 定义为 0。
    expect(ndcgAtK({ ranking: ['a'], relevance: {} }, 5)).toBe(0)
    expect(meanReciprocalRank([missed])).toBe(0)
    // 位次 1 与 4 的倒数均值，漏检按 0 计入分母。
    expect(meanReciprocalRank([
      { ranking: ['a'], relevance: { a: 1 } },
      { ranking: ['a', 'b', 'c', 'd'], relevance: { d: 1 } },
      missed,
    ])).toBeCloseTo((1 + 0.25) / 3, 10)
    expect(meanReciprocalRank([])).toBe(0)
  })
})

describe('仓库自撰的检索语料', () => {
  it('语料、查询集与基线三者互相闭合', () => {
    expect(documents).toHaveLength(12)
    expect(new Set(documents.map(d => d.id)).size).toBe(12)
    expect(queries.length).toBeGreaterThanOrEqual(8)
    const ids = new Set(documents.map(d => d.id))
    for (const q of queries) {
      // trigram 索引要求 3 字符以上才能 MATCH：词条短于此就不走 FTS，本门不覆盖该路径。
      for (const term of q.terms) expect(Array.from(term).length).toBeGreaterThanOrEqual(FTS_MIN_RUNES)
      const relevant = Object.entries(q.relevant).filter(([, gain]) => gain > 0)
      expect(relevant.length).toBeGreaterThan(0)
      for (const [id] of relevant) expect(ids.has(id)).toBe(true)
      expect(baseline.queries[q.id]).toBeDefined()
    }
  })
})

describe('BM25 基线复现（needs node:sqlite with FTS5）', () => {
  const probe = new DatabaseSync(':memory:')
  const hasFts5 = sqliteHasFts5(probe)
  probe.close()

  it.skipIf(!hasFts5)('记录的排序与同栈 FTS5 的当前排序一致', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, text, tokenize=trigram)')
      const insert = db.prepare('INSERT INTO docs (id, text) VALUES (?, ?)')
      for (const doc of documents) insert.run(doc.id, `${doc.title}\n${doc.text}`)
      const search = db.prepare('SELECT id FROM docs WHERE docs MATCH ? ORDER BY bm25(docs), id')
      for (const q of queries) {
        const ranking = (search.all(joinFtsOrTerms(q.terms)) as { id: string }[]).map(row => row.id)
        expect(ranking, `查询 ${q.id}`).toEqual(baseline.queries[q.id]?.ranking)
      }
    } finally {
      db.close()
    }
  })
})

describe('基线与指标', () => {
  it('指标可从记录的排序复算，且与记录值一致', () => {
    for (const { id, query } of recordedQueries()) {
      const recorded = baseline.queries[id]!
      expect(rankOfFirstRelevant(query), `查询 ${id}`).toBe(recorded.rankOfFirstRelevant)
      expect(ndcgAtK(query, baseline.ndcgK), `查询 ${id}`).toBeCloseTo(recorded.ndcgAtK, 6)
    }
    expect(meanReciprocalRank(recordedQueries().map(entry => entry.query)))
      .toBeCloseTo(baseline.aggregate.meanReciprocalRank, 6)
  })

  it('基线有真实缺口：10 个查询里有 2 个漏检、2 个把不相关文献排到了相关文献前面', () => {
    const ranks = recordedQueries().map(({ query }) => rankOfFirstRelevant(query))
    expect(ranks.filter(rank => rank === null)).toHaveLength(2)
    expect(ranks.filter(rank => rank !== null && rank > 1)).toHaveLength(2)
    expect(meanReciprocalRank(recordedQueries().map(entry => entry.query))).toBeLessThan(1)
  })

  it('把相关文档全部排到末尾后，每个有命中的查询都更差，聚合值明显下降', () => {
    const recorded = recordedQueries()
    const degenerate = recorded.map(({ query }) => relevantLast(query))

    for (const [index, { query }] of recorded.entries()) {
      const worse = degenerate[index]!
      const before = rankOfFirstRelevant(query)
      if (before === null) {
        // 本来就漏检的查询：退化排序不改变结果。
        expect(rankOfFirstRelevant(worse)).toBeNull()
        continue
      }
      const after = rankOfFirstRelevant(worse)
      expect(after).not.toBeNull()
      expect(after!).toBeGreaterThanOrEqual(before)
      expect(ndcgAtK(worse, baseline.ndcgK)).toBeLessThanOrEqual(ndcgAtK(query, baseline.ndcgK))
    }

    // q09 的 5 条命中里前 3 条不相关，两条相关文献被推到末尾：首位命中落到第 4 条。
    const q09 = degenerate[recorded.findIndex(entry => entry.id === 'q09')]!
    expect(rankOfFirstRelevant(q09)).toBe(4)

    const before = meanReciprocalRank(recorded.map(entry => entry.query))
    const after = meanReciprocalRank(degenerate)
    expect(after).toBeLessThan(before * 0.85)
  })
})
