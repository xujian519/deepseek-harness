import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { interpreterRel, pathNames, resolveAssetRoot } from '@deepseek-ai/dsh-patent-filing'
import { PatentFilingError } from '@deepseek-ai/dsh-patent-filing'

describe('resolveAssetRoot', () => {
  it('picks the first candidate that carries the template identity record', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-filing-root-'))
    const empty = join(root, 'empty')
    const asset = join(root, 'assets')
    mkdirSync(join(asset, 'template'), { recursive: true })
    writeFileSync(join(asset, 'template', 'TEMPLATE-IDENTITY.md'), '# template identity')
    try {
      expect(resolveAssetRoot([empty, asset])).toBe(asset)
      expect(resolveAssetRoot([asset, empty])).toBe(asset)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails loud when no candidate carries the template identity record', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-filing-root-'))
    try {
      expect(() => resolveAssetRoot([root])).toThrow(PatentFilingError)
      expect(() => resolveAssetRoot([root])).toThrow(/未找到随包资产目录/)
      expect(() => resolveAssetRoot([])).toThrow(/无候选/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('python interpreter naming', () => {
  it('names the interpreter per platform', () => {
    expect(interpreterRel('darwin')).toBe(join('dependencies', 'python', 'bin', 'python3'))
    expect(interpreterRel('linux')).toBe(join('dependencies', 'python', 'bin', 'python3'))
    expect(interpreterRel('win32')).toBe(join('dependencies', 'python', 'python.exe'))
  })

  it('names the PATH candidates per platform', () => {
    expect(pathNames('darwin')).toEqual(['python3', 'python'])
    expect(pathNames('win32')).toEqual(['python.exe', 'python3.exe'])
  })
})
