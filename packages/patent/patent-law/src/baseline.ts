/**
 * Load and validate the shipped law index.
 *
 * The index carries what a citation can be decided against: which articles and
 * guideline sections exist, the topic keywords each covers, and the
 * transcription provenance (`text`, `sourceDoc`, `verifiedOn`). A missing or
 * malformed file fails the plugin load, because a gate that silently runs with
 * no index would report every citation as checked.
 * @module @deepseek-ai/dsh-patent-law/baseline
 */

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { lawBaselineDir, listLawFiles } from './asset-location.ts'
import type { ArticleEntry, LawBaseline, LawName, SectionEntry } from './types.ts'

/** Thrown when a law-index asset is missing, unreadable, or malformed. */
export class LawBaselineError extends Error {
  /** Absolute path of the file the error came from, when it came from one. */
  readonly origin: string | null

  /**
   * @param message - what is wrong with the asset.
   * @param origin - the file the error came from.
   */
  constructor(message: string, origin: string | null) {
    super(message)
    this.name = 'LawBaselineError'
    this.origin = origin
  }
}

/** Law documents an index file may declare. */
export const LAW_NAMES: readonly LawName[] = ['专利法', '专利法实施细则', '专利审查指南']

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/**
 * Load every law-index file in a directory, keyed by law name.
 * @param baselineDir - directory override; defaults to the packaged assets.
 * @returns the baselines by law name.
 * @throws LawBaselineError when the directory is unreadable, empty, or holds a malformed file.
 */
export function loadLawBaselines(baselineDir?: string): Map<LawName, LawBaseline> {
  const dir = lawBaselineDir(baselineDir)
  let files: string[]
  try {
    files = listLawFiles(dir)
  } catch (error) {
    throw new LawBaselineError(`法条索引目录不可读：${dir}（${(error as Error).message}）`, dir)
  }
  if (files.length === 0) throw new LawBaselineError(`法条索引目录下没有 .yaml 文件：${dir}`, dir)

  const baselines = new Map<LawName, LawBaseline>()
  for (const file of files) {
    const baseline = parseLawBaseline(readFileSync(file, 'utf8'), file)
    if (baselines.has(baseline.law)) {
      throw new LawBaselineError(`同一部法律被索引了两次：${baseline.law}`, file)
    }
    baselines.set(baseline.law, baseline)
  }
  return baselines
}

/**
 * Parse one law-index file.
 * @param source - the file's text.
 * @param origin - the file path, used in error messages and findings.
 * @returns the parsed baseline.
 * @throws LawBaselineError when a required field is missing or malformed.
 */
export function parseLawBaseline(source: string, origin: string): LawBaseline {
  const root = parsed(source, origin)
  const law = readString(root, 'law', origin)
  if (!isLawName(law)) throw new LawBaselineError(`未知的法律名称：${law}`, origin)
  const document = readString(root, 'document', origin)
  const revision = readOptionalString(root, 'revision', origin)
  const maxArticle = readOptionalCount(root, 'maxArticle', origin)
  const maxVerifiedOn = readOptionalDate(root, 'maxVerifiedOn', origin)
  const maxSource = readOptionalString(root, 'maxSource', origin)
  const articles = readArticles(root['articles'], origin)
  const sections = readSections(root['sections'], origin)

  if (law === '专利审查指南') {
    if (articles.length > 0) throw new LawBaselineError('审查指南的索引只能声明 sections，不能声明 articles', origin)
    if (sections.length === 0) throw new LawBaselineError('审查指南的索引必须声明至少一个 section', origin)
  } else {
    if (sections.length > 0) throw new LawBaselineError(`${law} 的索引只能声明 articles，不能声明 sections`, origin)
    if (articles.length === 0) throw new LawBaselineError(`${law} 的索引必须声明至少一个 article`, origin)
  }

  return {
    law,
    document,
    revision,
    maxArticle,
    maxVerifiedOn,
    maxSource,
    articles: [...articles].sort((a, b) => a.article - b.article),
    sections: [...sections].sort((a, b) => a.path.localeCompare(b.path)),
  }
}

/**
 * Find one article in a baseline.
 * @param baseline - the law's baseline.
 * @param article - the article number.
 * @returns the entry, or undefined when the article is not indexed.
 */
export function findArticle(baseline: LawBaseline, article: number): ArticleEntry | undefined {
  return baseline.articles.find(entry => entry.article === article)
}

/**
 * Find one guideline section in a baseline.
 * @param baseline - the guideline baseline.
 * @param path - the normalized section path.
 * @returns the entry, or undefined when the section is not indexed.
 */
export function findSection(baseline: LawBaseline, path: string): SectionEntry | undefined {
  return baseline.sections.find(entry => entry.path === path)
}

/** True when a string names a law this package indexes. */
function isLawName(value: string): value is LawName {
  return (LAW_NAMES as readonly string[]).includes(value)
}

/** Parse the YAML document, requiring a mapping at the root. */
function parsed(source: string, origin: string): Record<string, unknown> {
  let value: unknown
  try {
    value = parseYaml(source)
  } catch (error) {
    throw new LawBaselineError(`YAML 解析失败：${(error as Error).message}`, origin)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LawBaselineError('法条索引的根节点必须是映射', origin)
  }
  return value as Record<string, unknown>
}

/** Read a required non-empty string field. */
function readString(root: Record<string, unknown>, field: string, origin: string): string {
  const value = root[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LawBaselineError(`字段 ${field} 必须是非空字符串`, origin)
  }
  return value
}

/** Read a field that is either absent/null or a non-empty string. */
function readOptionalString(root: Record<string, unknown>, field: string, origin: string): string | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LawBaselineError(`字段 ${field} 必须是 null 或非空字符串`, origin)
  }
  return value
}

/** Read a field that is either absent/null or a positive integer. */
function readOptionalCount(root: Record<string, unknown>, field: string, origin: string): number | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new LawBaselineError(`字段 ${field} 必须是 null 或正整数`, origin)
  }
  return value
}

/** Read a field that is either absent/null or an ISO date. */
function readOptionalDate(root: Record<string, unknown>, field: string, origin: string): string | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new LawBaselineError(`字段 ${field} 必须是 null 或 YYYY-MM-DD`, origin)
  }
  return value
}

/** Read the topics of one indexed entry. */
function readTopics(value: unknown, origin: string, where: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LawBaselineError(`${where} 的 topics 必须是非空数组`, origin)
  }
  return value.map((topic) => {
    if (typeof topic !== 'string' || topic.trim() === '') {
      throw new LawBaselineError(`${where} 的 topics 只能包含非空字符串`, origin)
    }
    return topic
  })
}

/** Read the article list, rejecting duplicate numbers. */
function readArticles(value: unknown, origin: string): ArticleEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new LawBaselineError('字段 articles 必须是数组', origin)
  const seen = new Set<number>()
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new LawBaselineError('articles 的每一项必须是映射', origin)
    }
    const entry = item as Record<string, unknown>
    const article = readOptionalCount(entry, 'article', origin)
    if (article === null) throw new LawBaselineError('article 必须是正整数', origin)
    if (seen.has(article)) throw new LawBaselineError(`article 重复：${article}`, origin)
    seen.add(article)
    return {
      article,
      ...readParagraphs(entry['paragraphs'], origin, article),
      topics: readTopics(entry['topics'], origin, `第${article}条`),
      text: readOptionalString(entry, 'text', origin),
      sourceDoc: readOptionalString(entry, 'sourceDoc', origin),
      verifiedOn: readOptionalDate(entry, 'verifiedOn', origin),
    }
  })
}

/** Read the optional paragraph list of one article. */
function readParagraphs(value: unknown, origin: string, article: number): { paragraphs?: number[] } {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value) || value.length === 0) {
    throw new LawBaselineError(`第${article}条的 paragraphs 必须是 null 或非空数组`, origin)
  }
  const paragraphs = value.map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) {
      throw new LawBaselineError(`第${article}条的 paragraphs 只能是正整数`, origin)
    }
    return item
  })
  return { paragraphs }
}

/** Read the guideline section list, rejecting duplicate paths. */
function readSections(value: unknown, origin: string): SectionEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new LawBaselineError('字段 sections 必须是数组', origin)
  const seen = new Set<string>()
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new LawBaselineError('sections 的每一项必须是映射', origin)
    }
    const entry = item as Record<string, unknown>
    const path = readString(entry, 'path', origin)
    if (seen.has(path)) throw new LawBaselineError(`section path 重复：${path}`, origin)
    seen.add(path)
    return {
      path,
      topics: readTopics(entry['topics'], origin, path),
      text: readOptionalString(entry, 'text', origin),
      sourceDoc: readOptionalString(entry, 'sourceDoc', origin),
      verifiedOn: readOptionalDate(entry, 'verifiedOn', origin),
    }
  })
}
