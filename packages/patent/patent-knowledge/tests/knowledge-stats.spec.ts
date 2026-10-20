import { describe, expect, it } from 'vitest'
import { KnowledgeRuntimeStats } from '@deepseek-ai/dsh-patent-knowledge'

describe('KnowledgeRuntimeStats', () => {
  it('starts with the degradation defaults', () => {
    const snap = new KnowledgeRuntimeStats().snapshot()
    expect(snap).toEqual({
      legalFtsDegraded: false,
      caseLawFtsDegraded: false,
      likeFallbacks: 0,
    })
  })

  it('tracks FTS degradation and LIKE fallbacks', () => {
    const stats = new KnowledgeRuntimeStats()
    stats.setLegalFtsDegraded(true)
    stats.setCaseLawFtsDegraded(true)
    stats.recordLikeFallback()
    stats.recordLikeFallback()
    stats.recordLikeFallback()
    expect(stats.snapshot()).toEqual({
      legalFtsDegraded: true,
      caseLawFtsDegraded: true,
      likeFallbacks: 3,
    })
  })

  it('returns a fresh snapshot object each call', () => {
    const stats = new KnowledgeRuntimeStats()
    const a = stats.snapshot()
    const b = stats.snapshot()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
