/**
 * 随包资产与源码引用的《专利法实施细则》条号必须落在随包法条索引里。
 *
 * 2023 年修订（2024-01-20 施行）重排了细则条号，旧条号留在资产里不会自己暴露：
 * 直到有人拿它去核对索引，才会发现引用的是一条不存在的条号。本组用例把这一类挡住，
 * 覆盖随包资产（`assets/`）与被装载的源码（`src/`，含 packages/bundle 的技能与预设），
 * 扫描范围见 `./asset-scan.ts`。
 *
 * 判定范围：条号是否存在于索引。条号存在但内容是别条的情形（把必要技术特征写成
 * 第 20 条第 2 款，而第 20 条是说明书撰写）要靠 `topics` 命题核验或人工核对，
 * 不在本组用例的范围内。
 */
import { describe, expect, it } from 'vitest'
import { findArticle, loadLawBaselines } from '../src/baseline.ts'
import { scannedFiles } from './asset-scan.ts'

/** 细则条号的引用形式。 */
const REGULATION_CITATION = /(?:专利法实施细则|实施细则|细则)第([0-9]{1,3})条/g

/** 一处引用：条号与所在文件。 */
type Citation = { article: number; file: string }

/**
 * 收集扫描范围内的全部细则条号引用。
 * @returns 按文件、条号去重后的引用列表。
 */
function collectCitations(): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const { file, text } of scannedFiles()) {
    for (const match of text.matchAll(REGULATION_CITATION)) {
      const key = `${file}#${match[1]}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push({ article: Number(match[1]), file })
    }
  }
  return citations
}

describe('细则条号引用的索引覆盖', () => {
  it('every cited implementing-regulation article is indexed', () => {
    const baseline = loadLawBaselines().get('专利法实施细则')
    expect(baseline).toBeDefined()
    const missing = collectCitations()
      .filter(citation => findArticle(baseline!, citation.article) === undefined)
      .map(citation => `${citation.file}: 细则第${citation.article}条`)
    expect(missing).toEqual([])
  })

  it('scans the shipped assets rather than an empty set', () => {
    // 扫描规则写错（目录名或路径片段）会让上一条用例空过，这里固定住它的下限。
    expect(collectCitations().length).toBeGreaterThan(20)
  })
})
