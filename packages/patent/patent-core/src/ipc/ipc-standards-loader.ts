import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import type { IpcStandardCard } from './types.ts'

/**
 * IPC examination-standard loader (data source: ipc-standards.yaml).
 *
 * Lazily builds an in-memory index supporting query by IPC section, by
 * keyword, and by law article. The YAML asset ships at package-root assets/ so
 * both the source tree and the bundled lib resolve it.
 */

/** Resolve the YAML asset, accepting the source co-located location and the package-root assets location. */
function resolveStandardsPath(overridePath?: string): string {
  if (overridePath) return overridePath
  const candidates = [
    new URL('../../../assets/ipc-standards.yaml', import.meta.url),
    new URL('../assets/ipc-standards.yaml', import.meta.url),
    new URL('./ipc-standards.yaml', import.meta.url),
  ]
  for (const url of candidates) {
    const path = fileURLToPath(url)
    if (existsSync(path)) return path
  }
  throw new Error('ipc-standards.yaml not found in the shipped asset locations')
}

/** IPC 标准索引：全量卡片、按部与按法条的分组映射。 */
export type IpcStandardsIndex = {
  /** 全量卡片列表。 */
  all: IpcStandardCard[]
  /** 按 IPC 部（A-H）分组。 */
  bySection: Map<string, IpcStandardCard[]>
  /** 按 article（如 patent-law-a22.3）分组。 */
  byArticle: Map<string, IpcStandardCard[]>
}

let cachedIndex: IpcStandardsIndex | null = null

function parseStandards(yamlText: string): IpcStandardCard[] {
  const doc = parseDocument(yamlText)
  const root = doc.toJS() as { standards?: unknown[] }
  const standards = root?.standards ?? []
  return standards.map((raw, i) => {
    const card = (raw ?? {}) as Record<string, unknown>
    return {
      id: typeof card.id === 'string' ? card.id : `standards-${i}`,
      article: typeof card.article === 'string' ? card.article : '',
      ipcSection: typeof card.ipcSection === 'string' ? card.ipcSection : '',
      ipcDetail: typeof card.ipcDetail === 'string' ? card.ipcDetail : undefined,
      name: typeof card.name === 'string' ? card.name : '',
      keyPoints: Array.isArray(card.keyPoints) ? (card.keyPoints as unknown[]).map(String) : [],
      tips: Array.isArray(card.tips) ? (card.tips as unknown[]).map(String) : [],
      source: typeof card.source === 'string' ? card.source : '',
    }
  })
}

/**
 * 加载 IPC 标准索引（惰性，进程内单例）。
 * @param overridePath - 可选：覆盖默认 YAML 资产路径。
 * @returns 加载并缓存的 IPC 标准索引。
 */
export function loadIpcStandards(overridePath?: string): IpcStandardsIndex {
  if (cachedIndex) return cachedIndex
  const path = resolveStandardsPath(overridePath)
  const cards = parseStandards(readFileSync(path, 'utf8'))

  const bySection = new Map<string, IpcStandardCard[]>()
  const byArticle = new Map<string, IpcStandardCard[]>()
  for (const card of cards) {
    if (card.ipcSection) {
      const list = bySection.get(card.ipcSection) ?? []
      list.push(card)
      bySection.set(card.ipcSection, list)
    }
    if (card.article) {
      const list = byArticle.get(card.article) ?? []
      list.push(card)
      byArticle.set(card.article, list)
    }
  }

  cachedIndex = { all: cards, bySection, byArticle }
  return cachedIndex
}

/**
 * 按 IPC 部查询审查标准卡片（如 "G"）。
 * @param section - IPC 部号（A-H，大小写不敏感）。
 * @returns 该部的审查标准卡片列表。
 */
export function queryIpcStandards(section: string): IpcStandardCard[] {
  return loadIpcStandards().bySection.get(section.toUpperCase()) ?? []
}

/**
 * 按 IPC 明细查询（如 "G06"）。
 * @param detail - IPC 明细号（大小写不敏感）。
 * @returns 匹配明细号的审查标准卡片列表。
 */
export function queryIpcDetail(detail: string): IpcStandardCard[] {
  const target = detail.toUpperCase()
  return loadIpcStandards().all.filter(card => card.ipcDetail?.toUpperCase() === target)
}

/**
 * 按法条查询（如 "patent-law-a22.3"）。
 * @param article - 法条标识。
 * @returns 该法条对应的审查标准卡片列表。
 */
export function queryByArticle(article: string): IpcStandardCard[] {
  return loadIpcStandards().byArticle.get(article) ?? []
}

/**
 * 按名称/要点/提示关键词搜索卡片。
 * @param keyword - 搜索关键词。
 * @param limit - 最大返回条数（默认 10）。
 * @returns 匹配的审查标准卡片列表。
 */
export function searchStandards(keyword: string, limit = 10): IpcStandardCard[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  return loadIpcStandards()
    .all.filter((card) => {
      if (card.name.toLowerCase().includes(kw)) return true
      if (card.id.toLowerCase().includes(kw)) return true
      if (card.article.toLowerCase().includes(kw)) return true
      if (card.keyPoints.some(k => k.toLowerCase().includes(kw))) return true
      if (card.tips.some(t => t.toLowerCase().includes(kw))) return true
      return false
    })
    .slice(0, limit)
}

/**
 * 将卡片格式化为上下文文本（供 <memory-context> 注入）。
 * @param cards - 待格式化的审查标准卡片列表。
 * @returns 格式化的上下文文本。
 */
export function formatStandardsAsContext(cards: IpcStandardCard[]): string {
  if (cards.length === 0) return ''
  return cards
    .map((card) => {
      const points = card.keyPoints.length > 0 ? card.keyPoints.map(k => `  - ${k}`).join('\n') : ''
      const tips = card.tips.length > 0 ? card.tips.map(t => `  - ${t}`).join('\n') : ''
      return `- [${card.ipcSection}${card.ipcDetail ?? ''}] ${card.name} (${card.article})\n${points}${tips}`
    })
    .join('\n')
}
