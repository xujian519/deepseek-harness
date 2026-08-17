import { describe, expect, it } from 'vitest'
import { CircuitBreaker, KnowledgeRuntimeStats } from '@deepseek-ai/dsh-patent-knowledge'

describe('KnowledgeRuntimeStats', () => {
  it('starts with zero counters and defaults', () => {
    const snap = new KnowledgeRuntimeStats().snapshot()
    expect(snap.cacheHits).toBe(0)
    expect(snap.cacheMisses).toBe(0)
    expect(snap.semanticCalls).toBe(0)
    expect(snap.semanticFailures).toBe(0)
    expect(snap.rerankCalls).toBe(0)
    expect(snap.rerankFailures).toBe(0)
    expect(snap.breakers).toEqual([])
    expect(snap.kgFtsMode).toBe('unknown')
    expect(snap.wikiSemanticIndex).toBe('disabled')
  })

  it('accumulates counters', () => {
    const stats = new KnowledgeRuntimeStats()
    stats.recordCacheHit()
    stats.recordCacheHit()
    stats.recordCacheMiss()
    stats.recordSemanticCall()
    stats.recordSemanticFailure()
    stats.recordRerankCall()
    stats.recordRerankCall()
    stats.recordRerankFailure()
    const snap = stats.snapshot()
    expect(snap.cacheHits).toBe(2)
    expect(snap.cacheMisses).toBe(1)
    expect(snap.semanticCalls).toBe(1)
    expect(snap.semanticFailures).toBe(1)
    expect(snap.rerankCalls).toBe(2)
    expect(snap.rerankFailures).toBe(1)
  })

  it('surfaces registered breakers (same-name overwrites)', () => {
    const stats = new KnowledgeRuntimeStats()
    stats.registerBreaker('patent:semantic', new CircuitBreaker({}))
    let snap = stats.snapshot()
    expect(snap.breakers).toHaveLength(1)
    expect(snap.breakers[0]).toMatchObject({ name: 'patent:semantic', state: 'closed' })

    stats.registerBreaker('patent:semantic', new CircuitBreaker({}))
    snap = stats.snapshot()
    expect(snap.breakers).toHaveLength(1)
  })

  it('surfaces kg/wiki state setters', () => {
    const stats = new KnowledgeRuntimeStats()
    stats.setKgFtsMode('trigram')
    stats.setWikiSemanticIndexState('ready')
    const snap = stats.snapshot()
    expect(snap.kgFtsMode).toBe('trigram')
    expect(snap.wikiSemanticIndex).toBe('ready')
  })

  it('tracks FTS degradation and LIKE fallbacks', () => {
    const stats = new KnowledgeRuntimeStats()
    expect(stats.snapshot().legalFtsDegraded).toBe(false)
    expect(stats.snapshot().caseLawFtsDegraded).toBe(false)
    expect(stats.snapshot().likeFallbacks).toBe(0)
    stats.setLegalFtsDegraded(true)
    stats.setCaseLawFtsDegraded(true)
    stats.recordLikeFallback()
    stats.recordLikeFallback()
    stats.recordLikeFallback()
    const snap = stats.snapshot()
    expect(snap.legalFtsDegraded).toBe(true)
    expect(snap.caseLawFtsDegraded).toBe(true)
    expect(snap.likeFallbacks).toBe(3)
  })

  it('returns a fresh snapshot object each call', () => {
    const stats = new KnowledgeRuntimeStats()
    const a = stats.snapshot()
    const b = stats.snapshot()
    expect(a).not.toBe(b)
    expect(a.breakers).not.toBe(b.breakers)
  })
})
