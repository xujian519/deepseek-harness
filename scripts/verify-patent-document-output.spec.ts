/**
 * 文书输出门禁的行为测试：放行随包分发的模板样例，拒绝编号冲突与含内部工作章节的文书。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('报告不存在的文件', () => {
    const missing = join(makeTempDir(), 'missing.html')
    expect(documentOutputProblems([missing])).toEqual([`文件不存在: ${missing}`])
  })
})
