import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
