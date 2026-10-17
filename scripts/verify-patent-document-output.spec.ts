/**
 * 文书输出门禁的行为测试：放行随包分发的模板样例，拒绝编号冲突、含内部工作章节的文书与
 * 证据编号两侧对不上的文书。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkDocumentCompliance } from '@deepseek-ai/dsh-patent-document'
import {
  collectTemplateExamples,
  documentOutputProblems,
  TEMPLATE_ROOT,
} from './verify-patent-document-output.ts'

const root = resolve(import.meta.dirname, '..')
const tempDirs: string[] = []

/** 建一个测试用临时目录，测试结束统一清理。 */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'verify-patent-document-output-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('collectTemplateExamples', () => {
  it('列出随包分发的各模板样例', () => {
    const examples = collectTemplateExamples(resolve(root, TEMPLATE_ROOT))
    expect(examples.some(file => file.endsWith(join('invalidation-opinion', 'example.html')))).toBe(true)
  })

  it('模板根不存在时返回空列表', () => {
    expect(collectTemplateExamples(join(makeTempDir(), 'missing'))).toEqual([])
  })
})

describe('documentOutputProblems', () => {
  it('放行随包分发的模板样例', () => {
    const examples = collectTemplateExamples(resolve(root, TEMPLATE_ROOT))
    expect(documentOutputProblems(examples)).toEqual([])
  })

  it('检出重复的章节编号', () => {
    const file = join(makeTempDir(), 'duplicate.html')
    writeFileSync(file, '<h2>一、总体立场</h2><h2>一、涉案专利权利要求分析</h2>')
    const problems = documentOutputProblems([file])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('重复')
  })

  it('检出非章节层级的中文编号标题', () => {
    const file = join(makeTempDir(), 'wrong-level.html')
    writeFileSync(file, '<h2>一、总体立场</h2><h3>一、当事人及专利著录事项</h3>')
    const problems = documentOutputProblems([file])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('章节级标题')
  })

  it('检出内部工作章节', () => {
    const file = join(makeTempDir(), 'internal.html')
    writeFileSync(file, '<h2>一、总体立场</h2><h2>十六、引用核验记录</h2>')
    const problems = documentOutputProblems([file])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('核验记录')
  })

  it('检出正文中的内部工作记录', () => {
    const file = join(makeTempDir(), 'internal-body.html')
    writeFileSync(file, '<h2>一、总体立场</h2><p>权利要求 1 的成功率约为 70%。</p>')
    const problems = documentOutputProblems([file])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('[internal-body]')
    expect(problems[0]).toContain('成功概率分档')
  })

  it('检出正文引用但证据清单未登记的编号', () => {
    const file = join(makeTempDir(), 'evidence-mismatch.html')
    writeFileSync(file, '<h2>一、总体立场</h2><p>D1 与 D2 的结合公开了全部特征。</p>'
      + '<section aria-label="证据清单"><table><tbody><tr><td>D1</td></tr></tbody></table></section>')
    const problems = documentOutputProblems([file])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('[evidence-cross-reference]')
    expect(problems[0]).toContain('「D2」未登记')
  })

  it('按模板目录名放行内部记录模板的样例，而非整体放宽正文检查', () => {
    const internalExample = join(resolve(root, TEMPLATE_ROOT), 'invalidation-analysis', 'example.html')
    // 该样例按对外文书检查会命中正文内部用语；放行来自模板目录的作用域判定
    const html = readFileSync(internalExample, 'utf8')
    expect(checkDocumentCompliance(html).map(issue => issue.rule)).toContain('internal-body')
    expect(documentOutputProblems([internalExample])).toEqual([])
  })

  it('报告不存在的文件', () => {
    const missing = join(makeTempDir(), 'missing.html')
    expect(documentOutputProblems([missing])).toEqual([`文件不存在: ${missing}`])
  })
})
