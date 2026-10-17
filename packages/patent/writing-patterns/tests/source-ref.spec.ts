import { describe, expect, it } from 'vitest'
import {
  extractLawReferences,
  findArticle,
  findSection,
  loadLawBaselines,
  type LawBaseline,
  type LawName,
} from '@deepseek-ai/dsh-patent-law'
import { loadPatternStore } from '../src/pattern-store.ts'

type Baselines = Map<LawName, LawBaseline>

/** Split an authored `source_ref` into its citation segments. */
function segments(sourceRef: string): string[] {
  return sourceRef
    .split(/[；;]/u)
    .map(segment => segment.trim())
    .filter(segment => segment !== '')
}

/**
 * Resolve one citation segment against the shipped law index.
 * @param segment - one semicolon-separated citation.
 * @param baselines - the law index.
 * @returns the resolved reference count.
 * @throws Error when the segment names no citation, an unindexed article, an
 * unindexed paragraph, or an unindexed guideline section.
 */
function checkSegment(segment: string, baselines: Baselines): number {
  const references = extractLawReferences(segment)
  if (references.length === 0) throw new Error(`不是可解析的法条引用：${segment}`)

  for (const reference of references) {
    if (reference.kind === 'guideline-section') {
      const baseline = baselines.get('专利审查指南')
      if (baseline === undefined) throw new Error('法条索引缺少专利审查指南')
      if (findSection(baseline, reference.path) === undefined) {
        throw new Error(`审查指南未收录该节：${reference.path}（原文：${segment}）`)
      }
      continue
    }

    const baseline = baselines.get(reference.law)
    if (baseline === undefined) throw new Error(`法条索引缺少${reference.law}`)
    const entry = findArticle(baseline, reference.article)
    if (entry === undefined) {
      throw new Error(`${reference.law}未收录第${String(reference.article)}条（原文：${segment}）`)
    }
    if (reference.paragraph !== undefined && entry.paragraphs !== undefined
      && !entry.paragraphs.includes(reference.paragraph)) {
      throw new Error(
        `${reference.law}第${String(reference.article)}条没有第${String(reference.paragraph)}款（原文：${segment}）`,
      )
    }
  }
  return references.length
}

/** Resolve every segment of one authored `source_ref`. */
function checkSourceRef(sourceRef: string, baselines: Baselines): number {
  let checked = 0
  for (const segment of segments(sourceRef)) checked += checkSegment(segment, baselines)
  if (checked === 0) throw new Error(`source_ref 没有可解析的法条引用：${sourceRef}`)
  return checked
}

describe('authored source_ref citations resolve against the law index', () => {
  const baselines = loadLawBaselines()

  it('resolves every citation of every shipped pattern', () => {
    const failures = loadPatternStore().all().flatMap((pattern) => {
      if (pattern.sourceRef === undefined) return [`${pattern.id} 未声明 source_ref`]
      try {
        checkSourceRef(pattern.sourceRef, baselines)
        return []
      } catch (error) {
        return [`${pattern.id}：${(error as Error).message}`]
      }
    })
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('rejects a segment that names no citation', () => {
    expect(() => checkSourceRef('实务方法', baselines)).toThrow(/不是可解析的法条引用/)
  })

  it('rejects an article the law index does not hold', () => {
    expect(() => checkSourceRef('专利法第999条', baselines)).toThrow(/专利法未收录第999条/)
  })

  it('rejects a paragraph the article does not have', () => {
    expect(() => checkSourceRef('专利法第22条第9款', baselines)).toThrow(/没有第9款/)
  })

  it('rejects a guideline section the index does not hold', () => {
    expect(() => checkSourceRef('审查指南第二部分第四章第9.9节', baselines))
      .toThrow(/审查指南未收录该节：第二部分第四章9\.9/)
    expect(() => checkSourceRef('审查指南第九部分第九章9.9', baselines))
      .toThrow(/审查指南未收录该节：第九部分第九章9\.9/)
  })

  it('rejects one bad segment among valid ones', () => {
    expect(() => checkSourceRef('专利法第22条第3款；专利法第999条', baselines))
      .toThrow(/专利法未收录第999条/)
  })
})
