import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  formatStandardsAsContext,
  loadIpcStandards,
  queryByArticle,
  queryIpcDetail,
  queryIpcStandards,
  searchStandards,
} from '@deepseek-ai/dsh-patent-core'

const STANDARDS_PATH = fileURLToPath(new URL('../assets/ipc-standards.yaml', import.meta.url))

describe('ipc-standards-loader', () => {
  it('loads over 100 examination-standard cards', () => {
    const index = loadIpcStandards(STANDARDS_PATH)
    expect(index.all.length).toBeGreaterThan(100)
  })

  it('populates card fields', () => {
    const index = loadIpcStandards(STANDARDS_PATH)
    for (const card of index.all.slice(0, 10)) {
      expect(card.id.length).toBeGreaterThan(0)
      expect(card.article.length).toBeGreaterThan(0)
      expect(card.ipcSection.length).toBeGreaterThan(0)
      expect(card.name.length).toBeGreaterThan(0)
      expect(Array.isArray(card.keyPoints)).toBe(true)
      expect(Array.isArray(card.tips)).toBe(true)
    }
  })

  it('queries by IPC section (G has at least one card)', () => {
    const cards = queryIpcStandards('G')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.ipcSection).toBe('G')
    }
  })

  it('queries by IPC detail (A61)', () => {
    const cards = queryIpcDetail('A61')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.ipcDetail).toBe('A61')
    }
  })

  it('queries by law article (patent-law-a22.3)', () => {
    const cards = queryByArticle('patent-law-a22.3')
    expect(cards.length).toBeGreaterThan(0)
  })

  it('searches by keyword with a limit', () => {
    const cards = searchStandards('医药', 5)
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.length).toBeLessThanOrEqual(5)
  })

  it('formats cards as context text', () => {
    const cards = queryIpcStandards('G')
    const text = formatStandardsAsContext(cards)
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('[')
  })
})

describe('ipc-standards-loader 资产归属', () => {
  it('只随包 assets/ 一份，与 package.json 的 files 清单一致', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { files: string[] }
    expect(pkg.files).toContain('assets')
    expect(existsSync(new URL('../assets/ipc-standards.yaml', import.meta.url))).toBe(true)
    // 源树内不得再有第二份同名副本：两份都活在候选表里时，改一份不会让任何测试发现另一份变旧。
    expect(existsSync(new URL('../src/ipc/ipc-standards.yaml', import.meta.url))).toBe(false)
  })
})

describe('loadIpcStandards 与 overridePath', () => {
  /** 写一个只含一张卡片的临时资产，作为与随包资产可区分的覆盖源。 */
  function writeOverride(dir: string, name: string, cardId: string): string {
    const path = join(dir, name)
    writeFileSync(path, `standards:\n  - id: ${cardId}\n    article: patent-law-a22.3\n    ipcSection: G\n    name: 覆盖卡片\n`, 'utf8')
    return path
  }

  it('覆盖路径即时生效，且既不写入单例也不被后续默认调用读到', async () => {
    vi.resetModules()
    const { loadIpcStandards: freshLoad } = await import('@deepseek-ai/dsh-patent-core')
    const dir = mkdtempSync(join(tmpdir(), 'ipc-override-'))
    const first = writeOverride(dir, 'first.yaml', 'OVERRIDE-1')
    const second = writeOverride(dir, 'second.yaml', 'OVERRIDE-2')
    try {
      const shipped = freshLoad()
      expect(shipped.all.length).toBeGreaterThan(100)
      expect(freshLoad(first).all.map(card => card.id)).toEqual(['OVERRIDE-1'])
      // 覆盖不污染单例：默认调用仍是随包索引本身，而不是覆盖结果。
      expect(freshLoad()).toBe(shipped)
      // 覆盖结果不进缓存：换一个覆盖路径立刻读到新内容。
      expect(freshLoad(second).all.map(card => card.id)).toEqual(['OVERRIDE-2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('先覆盖后默认：默认调用仍读随包资产', async () => {
    vi.resetModules()
    const { loadIpcStandards: freshLoad } = await import('@deepseek-ai/dsh-patent-core')
    const dir = mkdtempSync(join(tmpdir(), 'ipc-override-'))
    try {
      expect(freshLoad(writeOverride(dir, 'first.yaml', 'OVERRIDE-1')).all.map(card => card.id)).toEqual(['OVERRIDE-1'])
      expect(freshLoad().all.length).toBeGreaterThan(100)
      // 默认调用两次仍共享同一实例（单例只覆盖默认路径）。
      expect(freshLoad()).toBe(freshLoad())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
