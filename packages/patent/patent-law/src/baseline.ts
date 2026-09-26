/**
 * Load and validate the shipped law index.
 *
 * The index carries what a citation can be decided against: which articles and
 * guideline sections exist, the topic keywords each covers, and the transcription
 * record (`text`, `sourceDoc`, `verifiedOn`). A missing or malformed file fails
 * the plugin load, because a gate that silently runs with no index would report
 * every citation as checked.
 * @module @deepseek-ai/dsh-patent-law/baseline
 */

import { readFileSync } from 'node:fs'
import {
  IndexAssetError,
  parseYamlMapping,
  readMapping,
  readOptionalCount,
  readOptionalDate,
  readOptionalString,
  readRecordedSource,
  readString,
  type AssetFail,
} from '@deepseek-ai/dsh-patent-index-asset'
import { lawBaselineDir, listLawFiles } from './asset-location.ts'
import type { ArticleEntry, LawBaseline, LawName, SectionEntry } from './types.ts'

/** Thrown when a law-index asset is missing, unreadable, or malformed. */
export class LawBaselineError extends IndexAssetError {
  /**
   * @param message - what is wrong with the asset.
   * @param origin - the file the error came from.
   */
  constructor(message: string, origin: string | null) {
    super(message, origin)
    this.name = 'LawBaselineError'
  }
}

/** Law documents an index file may declare. */
export const LAW_NAMES: readonly LawName[] = ['专利法', '专利法实施细则', '专利审查指南']

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
  const fail: AssetFail = message => new LawBaselineError(message, origin)
  const root = parseYamlMapping(source, '法条索引', fail)
  const law = readString(root, 'law', fail)
  if (!isLawName(law)) throw fail(`未知的法律名称：${law}`)
  const document = readString(root, 'document', fail)
  const revision = readOptionalString(root, 'revision', fail)
  const maxArticle = readOptionalCount(root, 'maxArticle', fail)
  const maxVerifiedOn = readOptionalDate(root, 'maxVerifiedOn', fail)
  const maxSource = readOptionalString(root, 'maxSource', fail)
  const articles = readArticles(root['articles'], fail)
  const sections = readSections(root['sections'], fail)

  if (law === '专利审查指南') {
    if (articles.length > 0) throw fail('审查指南的索引只能声明 sections，不能声明 articles')
    if (sections.length === 0) throw fail('审查指南的索引必须声明至少一个 section')
  } else {
    if (sections.length > 0) throw fail(`${law} 的索引只能声明 articles，不能声明 sections`)
    if (articles.length === 0) throw fail(`${law} 的索引必须声明至少一个 article`)
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

/** Read the topics of one indexed entry. */
function readTopics(value: unknown, fail: AssetFail, where: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw fail(`${where} 的 topics 必须是非空数组`)
  }
  return value.map((topic) => {
    if (typeof topic !== 'string' || topic.trim() === '') {
      throw fail(`${where} 的 topics 只能包含非空字符串`)
    }
    return topic
  })
}

/** Read the article list, rejecting duplicate numbers. */
function readArticles(value: unknown, fail: AssetFail): ArticleEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('字段 articles 必须是数组')
  const seen = new Set<number>()
  return value.map((item) => {
    const entry = readMapping(item, 'articles 的每一项', fail)
    const article = readOptionalCount(entry, 'article', fail)
    if (article === null) throw fail('article 必须是正整数')
    if (seen.has(article)) throw fail(`article 重复：${article}`)
    seen.add(article)
    return {
      article,
      ...readParagraphs(entry['paragraphs'], fail, article),
      topics: readTopics(entry['topics'], fail, `第${article}条`),
      text: readOptionalString(entry, 'text', fail),
      ...readRecordedSource(entry, fail),
    }
  })
}

/** Read the optional paragraph list of one article. */
function readParagraphs(value: unknown, fail: AssetFail, article: number): { paragraphs?: number[] } {
  if (value === undefined || value === null) return {}
  if (!Array.isArray(value) || value.length === 0) {
    throw fail(`第${article}条的 paragraphs 必须是 null 或非空数组`)
  }
  const paragraphs = value.map((item) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) {
      throw fail(`第${article}条的 paragraphs 只能是正整数`)
    }
    return item
  })
  return { paragraphs }
}

/** Read the guideline section list, rejecting duplicate paths. */
function readSections(value: unknown, fail: AssetFail): SectionEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('字段 sections 必须是数组')
  const seen = new Set<string>()
  return value.map((item) => {
    const entry = readMapping(item, 'sections 的每一项', fail)
    const path = readString(entry, 'path', fail)
    if (seen.has(path)) throw fail(`section path 重复：${path}`)
    seen.add(path)
    return {
      path,
      topics: readTopics(entry['topics'], fail, path),
      text: readOptionalString(entry, 'text', fail),
      ...readRecordedSource(entry, fail),
    }
  })
}
