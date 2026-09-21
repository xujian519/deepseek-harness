// 上游来源：Mady 项目 `domains/doctmpl/loader_test.go`（`TestLoadDocTemplates` 的目录遍历、
// 同名保留首个、`.md` 过滤）。上游对同目录内重名静默保留首个；本包把重名视为资产错误，
// 因为覆盖语义属于跨目录的 store 层。

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { templatesDirectory } from '../src/asset-location.ts'
import { loadTemplateDirectory, loadTemplateFile } from '../src/loader.ts'
import { DocTemplateError } from '../src/types.ts'

let roots: string[] = []

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

/** Create an empty temporary directory tracked for teardown. */
async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-template-'))
  roots.push(root)
  return root
}

/** Write one template asset, creating its directory. */
async function writeTemplate(root: string, relativePath: string, name: string): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `---\nname: ${name}\n---\n# ${name}\n`)
}

describe('loadTemplateDirectory', () => {
  it('loads the packaged templates in path order', () => {
    const templates = loadTemplateDirectory(templatesDirectory())
    expect(templates).toHaveLength(17)
    expect(templates.map(template => template.name)).toEqual([
      'apparatus-claim',
      'method-claim',
      'system-claim',
      'simplified-disclosure',
      'standard-9-section',
      'clarity-amendment',
      'inventiveness-defense',
      'novelty-defense',
      'claims-spec',
      'invalidation-opinion',
      'oa-response-sati',
      'patentability-opinion',
      'search-report',
      'chemical-spec',
      'electrical-spec',
      'mechanical-spec',
      'software-spec',
    ])
  })

  it('walks nested category directories and ignores everything that is not a template', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'claims.md'), { recursive: true })
    await mkdir(join(root, 'nested', 'deep'), { recursive: true })
    await writeTemplate(root, 'a.md', 'a')
    await writeTemplate(root, join('nested', 'b.md'), 'b')
    await writeTemplate(root, join('nested', 'deep', 'c.md'), 'c')
    await writeFile(join(root, 'notes.txt'), 'ignored')
    expect(loadTemplateDirectory(root).map(template => template.name)).toEqual(['a', 'b', 'c'])
  })

  it('fails loud on a duplicate name inside one root', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'same')
    await writeTemplate(root, 'b.md', 'same')
    expect(() => loadTemplateDirectory(root)).toThrow(/同名 "same"/)
  })

  it('fails loud when the root is missing or is not a directory', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'a.md', 'a')
    expect(() => loadTemplateDirectory(join(root, 'no-such-dir'))).toThrow(/不可用/)
    expect(() => loadTemplateDirectory(join(root, 'a.md'))).toThrow(/不是目录/)
  })
})

describe('loadTemplateFile', () => {
  it('reads one asset by path and reports its path', async () => {
    const root = await tempDir()
    await writeTemplate(root, 'one.md', 'one')
    const template = loadTemplateFile(join(root, 'one.md'))
    expect(template.name).toBe('one')
    expect(template.filePath).toBe(join(root, 'one.md'))
  })

  it('fails loud when the file cannot be read', async () => {
    const root = await tempDir()
    expect(() => loadTemplateFile(join(root, 'missing.md'))).toThrow(/无法读取/)
  })

  it('fails loud when the asset violates the template contract', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'bad.md'), 'name: bad\n')
    expect(() => loadTemplateFile(join(root, 'bad.md'))).toThrow(DocTemplateError)
  })
})

describe('templatesDirectory', () => {
  it('resolves the packaged template root', () => {
    expect(templatesDirectory()).toContain('packages/document/doc-template/assets/templates')
  })
})
