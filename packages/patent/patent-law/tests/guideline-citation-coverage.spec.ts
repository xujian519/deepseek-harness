/**
 * 随包资产与源码引用的《专利审查指南》节号必须落在随包指南索引里。
 *
 * 指南按「部分—章—节」编号，不是条号，所以节号写错的唯一暴露方式是拿它去核对索引。
 * 反过来，索引漏登记一条正确的引用时，`law_verify` 也会报「不在索引中」——读起来像
 * 引用错了。本组用例同时挡住这两头：索引必须覆盖随包资产（`assets/`）与被装载的源码
 * （`src/`，含 packages/bundle 的技能与预设）里出现的每一条指南引用，扫描范围见
 * `./asset-scan.ts`。
 *
 * 扫描用 `reference.ts` 的解析器而不是另写一条正则：索引键就是该解析器归一化的结果，
 * 两边用同一段代码，扫描口径才不会与索引口径分叉。
 *
 * 判定范围：节号是否存在于索引。节号的数字段是否符合 2023 年修订版、主题词是否描述该节，
 * 以及节文本与引用命题是否相符，都不在本组用例的范围内。
 */
import { describe, expect, it } from 'vitest'
import { findSection, loadLawBaselines } from '../src/baseline.ts'
import { extractLawReferences } from '../src/reference.ts'
import { scannedFiles } from './asset-scan.ts'

/** 一处引用：归一化后的节路径与所在文件。 */
type Citation = { path: string; file: string }

/**
 * 收集扫描范围内的全部指南节引用。
 * @returns 按文件、节路径去重后的引用列表。
 */
function collectCitations(): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []
  for (const { file, text } of scannedFiles()) {
    for (const reference of extractLawReferences(text)) {
      if (reference.kind !== 'guideline-section') continue
      const key = `${file}#${reference.path}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push({ path: reference.path, file })
    }
  }
  return citations
}

describe('指南节号引用的索引覆盖', () => {
  it('every cited guideline section is indexed', () => {
    const baseline = loadLawBaselines().get('专利审查指南')
    expect(baseline).toBeDefined()
    const missing = collectCitations()
      .filter(citation => findSection(baseline!, citation.path) === undefined)
      .map(citation => `${citation.file}: 审查指南${citation.path}`)
    expect(missing).toEqual([])
  })

  it('scans the shipped assets rather than an empty set', () => {
    // 扫描规则写错（目录名或路径片段）会让上一条用例空过，这里固定住它的下限，
    // 并钉住两条本仓库依赖的引用：无效程序指定的答复期限与指定期限的延长。
    const paths = new Set(collectCitations().map(citation => citation.path))
    expect(paths.size).toBeGreaterThan(40)
    expect(paths.has('第四部分第三章4.4')).toBe(true)
    expect(paths.has('第五部分第七章4.2')).toBe(true)
  })
})
