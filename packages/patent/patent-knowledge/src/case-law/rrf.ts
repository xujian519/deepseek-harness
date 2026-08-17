/**
 * Reciprocal Rank Fusion over two case-law recall lists (FTS + future semantic).
 *
 * P1 serves only the FTS/LIKE path; the semantic list is reserved for a later
 * vector-infrastructure phase. The fusion function is kept so the deferred
 * semantic recall reuses one deterministic merge instead of re-deriving it in
 * the consumer.
 * @module @deepseek-ai/dsh-patent-knowledge/case-law/rrf
 */

import type { CaseLawHit } from './types.ts'

/** One ranked item contribution to reciprocal rank fusion. */
export type RrfRankedItem<T> = { id: T; score?: number }

/**
 * Fuse two ranked id lists by reciprocal rank (1/(k + rank)), summing shared ids
 * and returning them in descending score order. k defaults to 60.
 * @param rankings - the ranked id lists to fuse.
 * @param k - the rank-smoothing constant.
 * @returns fused ids with accumulated scores, descending.
 */
export function reciprocalRankFusion<T>(
  rankings: Array<Array<RrfRankedItem<T>>>,
  k = 60,
): Array<{ id: T; score: number }> {
  const scores = new Map<T, number>()
  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      const contribution = 1 / (k + index + 1)
      scores.set(item.id, (scores.get(item.id) ?? 0) + contribution)
    })
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Fuse case-law FTS hits with semantic hits by document id, keeping the FTS hit
 * for shared documents (its via/ftsRank are preserved) and truncating to the
 * request limit. An empty semantic list passes the FTS list through unchanged.
 * @param ftsHits - keyword-path hits in rank order.
 * @param semanticHits - semantic-path hits in rank order (empty in P1).
 * @param limit - result cap.
 * @returns fused, de-duplicated hits.
 */
export function fuseCaseLawHits(ftsHits: CaseLawHit[], semanticHits: CaseLawHit[], limit: number): CaseLawHit[] {
  if (semanticHits.length === 0) return ftsHits.slice(0, limit)
  const byId = new Map<string, CaseLawHit>()
  for (const hit of ftsHits) byId.set(hit.documentId, hit)
  for (const hit of semanticHits) {
    if (!byId.has(hit.documentId)) byId.set(hit.documentId, hit)
  }
  const fused = reciprocalRankFusion<string>([
    ftsHits.map(hit => ({ id: hit.documentId })),
    semanticHits.map(hit => ({ id: hit.documentId })),
  ])
  return fused
    .map(item => byId.get(item.id))
    .filter((hit): hit is CaseLawHit => hit !== undefined)
    .slice(0, limit)
}
