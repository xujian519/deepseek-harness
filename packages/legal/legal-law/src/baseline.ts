/**
 * Load and validate the shipped legal-law index.
 *
 * The index carries what a citation can be decided against: which articles
 * exist, the topic keywords each covers, and the transcription record (`text`,
 * `sourceDoc`, `verifiedOn`). A missing or malformed file fails the plugin
 * load, because a gate that silently runs with no index would report every
 * citation as checked.
 * @module @deepseek-ai/dsh-legal-law/baseline
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
import { legalLawBaselineDir, listLegalLawFiles } from './asset-location.ts'
import { rebuildStatutePattern } from './reference.ts'
import type {
  LegalArticleEntry,
  LegalLawBaseline,
  LegalLawName,
} from './types.ts'

/** Thrown when a legal-law index asset is missing, unreadable, or malformed. */
export class LegalLawBaselineError extends IndexAssetError {
  /**
   * @param message - what is wrong with the asset.
   * @param origin - the file the error came from.
   */
  constructor(message: string, origin: string | null) {
    super(message, origin)
    this.name = 'LegalLawBaselineError'
  }
}

/**
 * Known law names from the shipped asset files. Populated at load time by
 * {@link loadLegalLawBaselines}; the initial list covers the four laws that
 * were hand-indexed before the batch import script was written.
 *
 * Uses a `Set` internally to avoid mutable array pushes; the getter returns
 * a frozen snapshot.
 */
const _knownNames = new Set<LegalLawName>(['民法典', '民事诉讼法', '劳动合同法', '公司法'])

/** Snapshot of all known law names (initial four + any discovered at load time). */
export const LEGAL_LAW_NAMES: readonly LegalLawName[] = Object.freeze([..._knownNames])

/** @internal Re-export for mutation by loadLegalLawBaselines. */
export const _LEGAL_LAW_NAMES_SET: Set<LegalLawName> = _knownNames

/**
 * Load every legal-law index file in a directory, keyed by law name.
 * @param baselineDir - directory override; defaults to the packaged assets.
 * @returns the baselines by law name.
 * @throws LegalLawBaselineError when the directory is unreadable, empty, or holds a malformed file.
 */
export function loadLegalLawBaselines(baselineDir?: string): Map<LegalLawName, LegalLawBaseline> {
  const dir = legalLawBaselineDir(baselineDir)
  let files: string[]
  try {
    files = listLegalLawFiles(dir)
  } catch (error) {
    throw new LegalLawBaselineError(`法条索引目录不可读：${dir}（${(error as Error).message}）`, dir)
  }
  if (files.length === 0) throw new LegalLawBaselineError(`法条索引目录下没有 .yaml 文件：${dir}`, dir)

  const baselines = new Map<LegalLawName, LegalLawBaseline>()
  for (const file of files) {
    const baseline = parseLegalLawBaseline(readFileSync(file, 'utf8'), file)
    if (baselines.has(baseline.law)) {
      throw new LegalLawBaselineError(`同一部法律被索引了两次：${baseline.law}`, file)
    }
    baselines.set(baseline.law, baseline)
    // Track known law names for discoverability
    _knownNames.add(baseline.law)
  }
  // Rebuild the statute-matching regex now that new names may have been added.
  rebuildStatutePattern([..._knownNames])
  return baselines
}

/**
 * Parse one legal-law index file.
 * @param source - the file's text.
 * @param origin - the file path, used in error messages and findings.
 * @returns the parsed baseline.
 * @throws LegalLawBaselineError when a required field is missing or malformed.
 */
export function parseLegalLawBaseline(source: string, origin: string): LegalLawBaseline {
  const fail: AssetFail = message => new LegalLawBaselineError(message, origin)
  const root = parseYamlMapping(source, '法条索引', fail)
  const law = readString(root, 'law', fail)
  const document = readString(root, 'document', fail)
  const revision = readOptionalString(root, 'revision', fail)
  const maxArticle = readOptionalCount(root, 'maxArticle', fail)
  const maxVerifiedOn = readOptionalDate(root, 'maxVerifiedOn', fail)
  const maxSource = readOptionalString(root, 'maxSource', fail)
  const articles = readArticles(root['articles'], fail)

  if (articles.length === 0) throw fail(`${law} 的索引必须声明至少一个 article`)

  return {
    law,
    document,
    revision,
    maxArticle,
    maxVerifiedOn,
    maxSource,
    articles: [...articles].sort((a, b) => a.article - b.article),
  }
}

/**
 * Find one article in a baseline.
 * @param baseline - the law's baseline.
 * @param article - the article number.
 * @returns the entry, or undefined when the article is not indexed.
 */
export function findLegalArticle(baseline: LegalLawBaseline, article: number): LegalArticleEntry | undefined {
  return baseline.articles.find(entry => entry.article === article)
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

/**
 * Enforce that an entry's transcription record is all-or-nothing.
 *
 * A text without a source or a date would be reported as verified while the
 * copy has no recorded source, and a source without a text claims a copy
 * that does not exist. Both are load errors, so a hand-edited index cannot
 * create the fail-open state the verifier is designed to avoid.
 * @param text - the entry's transcribed text, or null.
 * @param source - the recorded source and verification date.
 * @param fail - the caller's error factory.
 * @param where - the entry's label, used in the error message.
 */
function checkRecordedSource(
  text: string | null,
  source: { sourceDoc: string | null; verifiedOn: string | null },
  fail: AssetFail,
  where: string,
): void {
  if (text !== null && (source.sourceDoc === null || source.verifiedOn === null)) {
    throw fail(`${where} 的 text 已转录，但 sourceDoc 与 verifiedOn 必须同时记录`)
  }
  if (text === null && (source.sourceDoc !== null || source.verifiedOn !== null)) {
    throw fail(`${where} 尚未转录 text，不能单独记录 sourceDoc 或 verifiedOn`)
  }
}

/** Read the article list, rejecting duplicate numbers. */
function readArticles(value: unknown, fail: AssetFail): LegalArticleEntry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('字段 articles 必须是数组')
  const seen = new Set<number>()
  return value.map((item) => {
    const entry = readMapping(item, 'articles 的每一项', fail)
    const article = readOptionalCount(entry, 'article', fail)
    if (article === null) throw fail('article 必须是正整数')
    if (seen.has(article)) throw fail(`article 重复：${article}`)
    seen.add(article)
    const text = readOptionalString(entry, 'text', fail)
    const source = readRecordedSource(entry, fail)
    checkRecordedSource(text, source, fail, `第${article}条`)
    return {
      article,
      ...readParagraphs(entry['paragraphs'], fail, article),
      topics: readTopics(entry['topics'], fail, `第${article}条`),
      text,
      ...source,
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
