import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchGenerate, generateYamlIndex } from '../generate-law-yaml.ts'
import { parseLawMarkdown } from '../parse-law-md.ts'

const LAW = `# 中华人民共和国测试法

2020年1月1日 通过

<\!-- INFO END -->

## 第一章 总则

第一条 第一条内容。

第二条 第二条内容。
`

const SPLIT = `# 中华人民共和国民法典

# 总则

2020年5月28日 通过

<\!-- INFO END -->

第一条 总则内容。
`

describe('generateYamlIndex', () => {
  it('leaves text null without transcription', () => {
    const parsed = parseLawMarkdown(LAW, '/tmp/测试法(2020-01-01).md')
    const yaml = generateYamlIndex(parsed)
    expect(yaml).toContain('text: null')
    expect(yaml).toContain('verifiedOn: null')
  })

  it('writes article text and provenance when transcribing', () => {
    const parsed = parseLawMarkdown(LAW, '/tmp/测试法(2020-01-01).md')
    const yaml = generateYamlIndex(parsed, { transcribe: true, verifiedOn: '2026-10-26' })
    expect(yaml).toContain('text: 第一条内容。')
    expect(yaml).toContain("verifiedOn: '2026-10-26'")
    expect(yaml).toContain("maxVerifiedOn: '2026-10-26'")
    expect(yaml).toContain('maxSource: 测试法(2020-01-01).md')
  })

  it('requires a verification date when transcribing', () => {
    const parsed = parseLawMarkdown(LAW, '/tmp/测试法(2020-01-01).md')
    expect(() => generateYamlIndex(parsed, { transcribe: true })).toThrow()
  })
})

describe('batchGenerate', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('writes only the laws named by --only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lawgen-'))
    roots.push(root)
    const input = join(root, 'in')
    const output = join(root, 'out')
    mkdirSync(input)
    mkdirSync(output)
    writeFileSync(join(input, '甲法(2020-01-01).md'), LAW.replaceAll('测试法', '甲法'))
    writeFileSync(join(input, '乙法(2020-01-01).md'), LAW.replaceAll('测试法', '乙法'))

    await batchGenerate(input, output, { only: ['甲法'] })

    expect(existsSync(join(output, '甲法.yaml'))).toBe(true)
    expect(existsSync(join(output, '乙法.yaml'))).toBe(false)
  })

  it('matches a split volume only by its compound key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lawgen-'))
    roots.push(root)
    const input = join(root, 'in')
    const output = join(root, 'out')
    mkdirSync(input)
    mkdirSync(output)
    writeFileSync(join(input, '民法典(2020-05-28).md'), LAW.replaceAll('测试法', '民法典'))
    writeFileSync(join(input, '总则.md'), SPLIT)

    await batchGenerate(input, output, { only: ['民法典'] })

    expect(existsSync(join(output, 'civil-code.yaml'))).toBe(true)
    expect(existsSync(join(output, 'civil-code-general-provisions.yaml'))).toBe(false)
  })
})
