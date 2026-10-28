import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLawManifest, writeLawManifest } from '../generate-law-manifest.ts'
import { LEGAL_LAW_MANIFEST_FILE } from '../../../packages/legal/legal-law/src/asset-location.ts'

const tempDirs: string[] = []

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'law-manifest-'))
  tempDirs.push(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8')
  return dir
}

function lawFile(law: string, document: string): string {
  return `law: ${law}\ndocument: ${document}\nrevision: 2020\nmaxArticle: 1\narticles:\n  - article: 1\n    text: null\n`
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('buildLawManifest', () => {
  it('lists every YAML file sorted by law name', () => {
    const dir = fixtureDir({
      'civil-code.yaml': lawFile('民法典', '中华人民共和国民法典'),
      'accounting.yaml': lawFile('会计法', '中华人民共和国会计法'),
      'notes.txt': 'not an index file',
    })
    const rows = JSON.parse(buildLawManifest(dir)) as { laws: string[][] }
    expect(rows.laws).toEqual([
      ['会计法', '中华人民共和国会计法', 'accounting.yaml'],
      ['民法典', '中华人民共和国民法典', 'civil-code.yaml'],
    ])
  })

  it('ignores a manifest already in the directory', () => {
    const dir = fixtureDir({
      'civil-code.yaml': lawFile('民法典', '中华人民共和国民法典'),
      [LEGAL_LAW_MANIFEST_FILE]: '{"laws":[]}',
    })
    const rows = JSON.parse(buildLawManifest(dir)) as { laws: string[][] }
    expect(rows.laws).toHaveLength(1)
  })

  it('rejects a law indexed by two files', () => {
    const dir = fixtureDir({
      'civil-code.yaml': lawFile('民法典', '中华人民共和国民法典'),
      'civil-code-copy.yaml': lawFile('民法典', '中华人民共和国民法典'),
    })
    expect(() => buildLawManifest(dir)).toThrow('同一部法律被索引了两次')
  })

  it('rejects a file without a law or document', () => {
    const missingLaw = fixtureDir({ 'broken.yaml': 'document: 中华人民共和国某法\n' })
    expect(() => buildLawManifest(missingLaw)).toThrow('缺少 law')
    const missingDocument = fixtureDir({ 'broken.yaml': 'law: 某法\n' })
    expect(() => buildLawManifest(missingDocument)).toThrow('缺少 document')
  })
})

describe('writeLawManifest', () => {
  it('writes the manifest next to the index files', () => {
    const dir = fixtureDir({
      'civil-code.yaml': lawFile('民法典', '中华人民共和国民法典'),
    })
    expect(writeLawManifest(dir)).toBe(1)
    expect(readFileSync(join(dir, LEGAL_LAW_MANIFEST_FILE), 'utf8')).toBe(buildLawManifest(dir))
  })
})
