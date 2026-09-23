import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'yaml'
import type { IpcStandardCard } from './types.ts'

/**
 * IPC examination-standard loader (data source: assets/ipc-standards.yaml).
 *
 * Lazily builds an in-memory index supporting query by IPC section, by
 * keyword, and by law article. The YAML asset ships at package-root assets/ so
 * both the source tree and the bundled lib resolve it.
 */

/**
 * 随包资产的两个候选深度：打包单文件（`lib/index.js`）与源树（`src/ipc/`）到包根
 * 的相对深度不同，各一个候选，两者互斥且都指向 `assets/ipc-standards.yaml`。
 */
const STANDARDS_CANDIDATES = [
  new URL('../assets/ipc-standards.yaml', import.meta.url),
  new URL('../../assets/ipc-standards.yaml', import.meta.url),
]

/** Resolve the YAML asset at the shipped package-root assets location. */
function resolveStandardsPath(): string {
  for (const url of STANDARDS_CANDIDATES) {
    const path = fileURLToPath(url)
    if (existsSync(path)) return path
  }
  /* v8 ignore next -- 资产随包签入：源码与打包布局各命中一个候选 */
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
  const root = doc.toJS() as { standards?: unknown[] } | null
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

/** 解析资产文本为卡片列表并按 IPC 部/法条分组。 */
function buildIndex(path: string): IpcStandardsIndex {
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

  return { all: cards, bySection, byArticle }
}

/**
 * 加载 IPC 标准索引（惰性，进程内单例）。
 * @param overridePath - 可选：覆盖默认 YAML 资产路径；覆盖结果不写入单例，故每次调用都按该路径重新解析。
 * @returns 默认路径的索引进程内缓存；覆盖路径的索引即时构建。
 */
export function loadIpcStandards(overridePath?: string): IpcStandardsIndex {
  // 覆盖路径不进单例：否则一次覆盖会让后续默认调用读到覆盖数据。
  if (overridePath !== undefined) return buildIndex(overridePath)
  if (cachedIndex !== null) return cachedIndex
  cachedIndex = buildIndex(resolveStandardsPath())
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
    .all.filter(card => [card.name, card.id, card.article, ...card.keyPoints, ...card.tips]
      .some(field => field.toLowerCase().includes(kw)))
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
