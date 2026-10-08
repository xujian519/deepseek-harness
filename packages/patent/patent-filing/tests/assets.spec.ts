import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  defaultSpecPath,
  defaultTemplatePath,
  getAssetRoot,
  getEngineDir,
} from '@deepseek-ai/dsh-patent-filing'

/** sha256 of a file, lowercase hex. */
function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('packaged assets', () => {
  it('resolves the asset root beside the engine, spec, and template', () => {
    const root = getAssetRoot()
    expect(getEngineDir()).toBe(join(root, 'engine'))
    expect(defaultSpecPath()).toBe(join(root, 'spec', '申请文件.json'))
    expect(defaultTemplatePath()).toBe(join(root, 'template', '申请文件模板.docx'))
  })

  it('ships exactly the three engine scripts the tools invoke', () => {
    for (const script of ['build.py', 'verify.py', 'render_figures.py']) {
      expect(() => readFileSync(join(getEngineDir(), script), 'utf8')).not.toThrow()
    }
  })

  it('pins the template to the sha256 the identity record states', () => {
    const identity = readFileSync(join(getAssetRoot(), 'template', 'TEMPLATE-IDENTITY.md'), 'utf8')
    const recorded = /本目录去标识化副本 \| `[0-9a-f]{32}` \| `([0-9a-f]{64})`/.exec(identity)?.[1]
    expect(recorded).toBeDefined()
    expect(sha256(defaultTemplatePath())).toBe(recorded)
  })

  it('keeps the de-identification fingerprints current', () => {
    const identity = readFileSync(join(getAssetRoot(), 'template', 'TEMPLATE-IDENTITY.md'), 'utf8')
    const md5 = createHash('md5').update(readFileSync(defaultTemplatePath())).digest('hex')
    expect(identity).toContain(md5)
  })

  it('declares five sections, the statutory headers, and the template-derived style', () => {
    const spec = JSON.parse(readFileSync(defaultSpecPath(), 'utf8')) as {
      sections: { key: string; header: string }[]
      assertions: { section_count: number; headers: string[]; continuity: boolean; numbering_pattern: string }
      style: Record<string, unknown>
    }
    expect(spec.sections.map(section => section.key)).toEqual([
      'abstract', 'abstract_figure', 'claims', 'specification', 'figures',
    ])
    expect(spec.assertions.section_count).toBe(spec.sections.length)
    expect(spec.assertions.headers).toEqual([
      '说明书摘要', '摘要附图', '权利要求书', '说明书', '说明书附图',
    ])
    // 段落编号连续性断言曾因 spec 缺 continuity 键而成为死代码；这里钉住它保持生效。
    expect(spec.assertions.continuity).toBe(true)
    expect(spec.assertions.numbering_pattern).toBe('^\\[(\\d{4})\\]')
    expect(spec.style).toMatchObject({ size_pt: 12, line_spacing: 1.5, first_line_indent: 0 })
  })
})
