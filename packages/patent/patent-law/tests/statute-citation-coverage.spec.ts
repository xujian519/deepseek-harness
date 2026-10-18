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
import { extractLawReferences } from '../src/reference.ts'
import { scannedFiles } from './asset-scan.ts'

/** 随包法条索引自身的正文会引用细则；那是被转录的引文，不是本包作出的引用。 */
const LAW_INDEX_PREFIX = 'packages/patent/patent-law/assets/law/'

/** 一处引用：条号、所在文件，以及是否以中文数字书写。 */
type Citation = { article: number; file: string; chinese: boolean }

/**
 * 收集扫描范围内的全部细则条号引用。
 *
 * 用 `reference.ts` 的解析器而不是另写一条正则：索引键与扫描口径必须同源，
 * 否则中文数字写法会被静默漏掉（本组用例最初就是这样漏掉细则第十三条的）。
 * @returns 按文件、条号去重后的引用列表。
 */
function collectCitations(): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const { file, text } of scannedFiles()) {
    if (file.startsWith(LAW_INDEX_PREFIX)) continue
    for (const reference of extractLawReferences(text)) {
      if (reference.kind !== 'law-article' || reference.law !== '专利法实施细则') continue
      const key = `${file}#${reference.article}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push({
        article: reference.article,
        file,
        chinese: /[〇零一二三四五六七八九十百]/.test(reference.raw),
      })
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

  it('reads Chinese-numeral citations, not only Arabic forms', () => {
    expect(collectCitations().some(citation => citation.chinese)).toBe(true)
  })
})
