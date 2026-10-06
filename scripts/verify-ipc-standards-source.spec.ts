import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasExtractablePayload,
  verifyCardSources,
} from './verify-ipc-standards-source.ts'

/** spec 用临时目录承载源库树,每个用例结束后回收。 */
const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

/** 建一棵源库树:files 为相对路径到正文。 */
function makeSourceTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ipc-source-'))
  created.push(root)
  for (const [relative, body] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body, 'utf8')
  }
  return root
}

const VALID = '宝宸知识库/Wiki/复审无效/创造性/示例.md'
/** 有三级标题的要点段,提取器能拿到 keyPoints。 */
const PAYLOAD = '# 示例\n\n## 决定要点\n\n### 要点一：区别被公开且作用相同时不具备创造性\n\n正文。\n'
/** 只有核心标准段而无要点,提取器拿不到任何载荷——空壳的成因。 */
const CORE_ONLY = '# 示例\n\n## 核心审查标准\n\n本领域的创造性判断遵循三步法。\n'

describe('hasExtractablePayload', () => {
  it('接受决定要点的三级标题与解读段两种载荷形态', () => {
    expect(hasExtractablePayload(PAYLOAD)).toBe(true)
    expect(hasExtractablePayload('# 示例\n\n### 1. 某要点\n\n**解读**：正文。\n')).toBe(true)
  })

  it('拒绝只有核心标准段而无要点的主页面', () => {
    expect(hasExtractablePayload(CORE_ONLY)).toBe(false)
    expect(hasExtractablePayload('')).toBe(false)
    // 二级标题不足以产出要点。
    expect(hasExtractablePayload('# 示例\n\n## 决定要点\n\n正文。\n')).toBe(false)
  })
})

describe('verifyCardSources', () => {
  it('源文件带可提取载荷时通过', () => {
    const root = makeSourceTree({ [VALID]: PAYLOAD })
    const read = (source: string): string[] => {
      const path = join(root, source)
      return existsSync(path) ? [readFileSync(path, 'utf8')] : []
    }
    expect(verifyCardSources([{ id: 'A', source: VALID }], read)).toEqual([])
  })

  it('拒绝漏掉 Wiki/ 层的 source 路径', () => {
    const problems = verifyCardSources(
      [{ id: 'A', source: '宝宸知识库/复审无效/创造性/示例.md' }],
      () => [PAYLOAD],
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]!.kind).toBe('malformed-source')
  })

  it('拒绝空 source', () => {
    const problems = verifyCardSources([{ id: 'A', source: '' }], () => [PAYLOAD])
    expect(problems[0]!.kind).toBe('malformed-source')
  })

  it('拒绝主页面与拆分子页都不存在', () => {
    const problems = verifyCardSources([{ id: 'A', source: VALID }], () => [])
    expect(problems[0]!.kind).toBe('missing-source')
  })

  it('主页面只剩核心标准段时报告 empty-payload', () => {
    const problems = verifyCardSources([{ id: 'A', source: VALID }], () => [CORE_ONLY])
    expect(problems[0]!.kind).toBe('empty-payload')
    expect(problems[0]!.detail).toContain('无可提取的要点或解读段')
  })

  it('主页面被拆分但拆分子页承载载荷时通过', () => {
    // 这是 21 张空壳的成因形态:主页面清空、内容搬到子页。载荷被子页承载即通过。
    const problems = verifyCardSources([{ id: 'A', source: VALID }], () => [CORE_ONLY, PAYLOAD])
    expect(problems).toEqual([])
  })
})
