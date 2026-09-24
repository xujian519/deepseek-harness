// 上游来源：Mady 项目 `domains/config/style_embed_test.go`：
// `TestLoadStylesFromPaths_MergeDistinctDomains`（不同域各自保留）、
// `TestLoadStylesFromPaths_UserOverridesBuiltin`（内置在前、用户在后，同名覆盖）。
// 上游的 `TestLoadStylesFromPaths_SkipMalformed` 与 `TestLoadStylesFromPaths_NonexistentDirSkipped`
// 断言的“静默跳过”在本包被有意改为 fail-loud，故对应断言在此反转。

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stylesDirectory } from '../src/asset-location.ts'
import { loadStyleFile, loadStyles, styleDirectories } from '../src/load.ts'
import { DocumentStyleError } from '../src/types.ts'

let roots: string[] = []

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

/** Create an empty temporary directory tracked for teardown. */
async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-style-'))
  roots.push(root)
  return root
}

/** Write one style asset into a directory. */
async function writeStyle(directory: string, fileName: string, content: string): Promise<void> {
  await writeFile(join(directory, fileName), content)
}

describe('loadStyles', () => {
  it('loads the packaged styles', () => {
    const styles = loadStyles([stylesDirectory()])
    expect(styles.map(style => style.name)).toEqual(['assistant-neutral', 'chat-friendly', 'legal-standard', 'patent-standard'])
  })

  it('keeps styles of distinct domains side by side', async () => {
    const root = await tempDir()
    await writeStyle(root, 'patent.yaml', 'name: patent-std\ndomain: patent\n')
    await writeStyle(root, 'legal.yaml', 'name: legal-std\ndomain: legal\n')
    const styles = loadStyles([root])
    expect(styles.map(style => style.name)).toEqual(['legal-std', 'patent-std'])
  })

  it('lets a later directory override a style of the same name in place', async () => {
    const builtin = await tempDir()
    const user = await tempDir()
    await writeStyle(builtin, 'a.yaml', 'name: patent-standard\ndomain: patent\nversion: "1"\n')
    await writeStyle(builtin, 'b.yaml', 'name: legal-standard\ndomain: legal\n')
    await writeStyle(user, 'patent-standard.yaml', 'name: patent-standard\ndomain: patent\nversion: user-v2\n')
    const styles = loadStyles([builtin, user])
    expect(styles).toHaveLength(2)
    expect(styles[0]?.version).toBe('user-v2')
    expect(styles[1]?.name).toBe('legal-standard')
  })

  it('ignores files that are not style assets', async () => {
    const root = await tempDir()
    await writeStyle(root, 'notes.txt', 'name: ignored\ndomain: patent\n')
    await writeStyle(root, 'only.yaml', 'name: kept\ndomain: patent\n')
    expect(loadStyles([root]).map(style => style.name)).toEqual(['kept'])
  })

  it('requires at least one directory', () => {
    expect(() => loadStyles([])).toThrow(/未提供样式目录/)
  })

  it('fails loud when a listed directory is missing or is not a directory', async () => {
    const root = await tempDir()
    await writeStyle(root, 'file.yaml', 'name: a\ndomain: patent\n')
    expect(() => loadStyles([join(root, 'no-such-dir')])).toThrow(DocumentStyleError)
    expect(() => loadStyles([join(root, 'no-such-dir')])).toThrow(/不可用/)
    expect(() => loadStyles([join(root, 'file.yaml')])).toThrow(/不是目录/)
  })

  it('fails loud when a directory holds no style asset', async () => {
    const root = await tempDir()
    expect(() => loadStyles([root])).toThrow(/没有 .yaml 样式资产/)
  })

  it('fails loud instead of skipping a malformed asset', async () => {
    const root = await tempDir()
    await writeStyle(root, 'good.yaml', 'name: good\ndomain: patent\n')
    await writeStyle(root, 'bad.yaml', 'domain: patent\n')
    expect(() => loadStyles([root])).toThrow(/bad.yaml: name 必须是字符串/)
  })
})

describe('loadStyleFile', () => {
  it('reads one asset by path', async () => {
    const root = await tempDir()
    await writeStyle(root, 'one.yaml', 'name: one\ndomain: chat\nversion: "2"\n')
    expect(loadStyleFile(join(root, 'one.yaml')).version).toBe('2')
  })

  it('fails loud when the file cannot be read', async () => {
    const root = await tempDir()
    expect(() => loadStyleFile(join(root, 'missing.yaml'))).toThrow(/无法读取/)
  })
})

describe('stylesDirectory', () => {
  it('resolves the packaged style directory', () => {
    expect(stylesDirectory()).toContain('packages/document/doc-style/assets/styles')
  })

  it('points at a directory that exists', () => {
    expect(() => loadStyles([stylesDirectory()])).not.toThrow()
  })
})

describe('packaged style assets', () => {
  it('parse into the documented sections', () => {
    const [patent] = loadStyles([stylesDirectory()]).filter(style => style.name === 'patent-standard')
    expect(patent?.domain).toBe('patent')
    expect(patent?.sections.tone).toEqual({ formality: 'professional', perspective: 'third', language: 'zh-CN' })
    expect(patent?.sections.antiPatterns).toHaveLength(10)
    expect(patent?.sections.disclaimers.get('patent_analysis')).toContain('不构成正式法律意见')
    expect(patent?.sections.citation).toEqual({ style: 'inline', format: '[{id}]' })
    expect(patent?.sections.outputConventions).toEqual({ confidenceLabel: true, weakVisual: true })
  })

  it('declare disclaimers for the categories the templates use', () => {
    const styles = loadStyles([stylesDirectory()])
    const chat = styles.find(style => style.name === 'chat-friendly')
    expect(chat?.sections.disclaimers.size).toBe(0)
    const neutral = styles.find(style => style.name === 'assistant-neutral')
    expect(neutral?.sections.disclaimers.get('generated_content')).toContain('仅供参考')
  })
})

describe('styleDirectories', () => {
  it('leads with the packaged root and resolves each configured override', () => {
    expect(styleDirectories()).toEqual([stylesDirectory()])
    // A relative override resolves here, so both consumers load the same
    // directory and a load failure names one absolute path.
    expect(styleDirectories(['skills/styles', 'skills/styles'])).toEqual([
      stylesDirectory(),
      resolve('skills/styles'),
      resolve('skills/styles'),
    ])
    expect(styleDirectories(['/abs/styles'])[1]).toBe('/abs/styles')
  })
})
