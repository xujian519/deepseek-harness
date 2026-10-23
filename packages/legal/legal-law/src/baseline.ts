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
  readArticleEntries,
  readOptionalCount,
  readOptionalDate,
  readOptionalString,
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
 * List the index files a load would parse.
 * @param baselineDir - directory override; defaults to the packaged assets.
 * @returns the resolved directory and its `.yaml` files.
 * @throws LegalLawBaselineError when the directory is unreadable or empty.
 */
function legalLawIndexFiles(baselineDir?: string): string[] {
  const dir = legalLawBaselineDir(baselineDir)
  let files: string[]
  try {
    files = listLegalLawFiles(dir)
  } catch (error) {
    throw new LegalLawBaselineError(`法条索引目录不可读：${dir}（${(error as Error).message}）`, dir)
  }
  if (files.length === 0) throw new LegalLawBaselineError(`法条索引目录下没有 .yaml 文件：${dir}`, dir)
  return files
}

/**
 * Check that the index directory exists and holds at least one file, without
 * parsing any of them. Plugin registration uses this so a missing asset fails
 * the deployment while the 72 MB index is parsed only when the tool runs.
 * @param baselineDir - directory override; defaults to the packaged assets.
 * @throws LegalLawBaselineError when the directory is unreadable or empty.
 */
export function assertLegalLawIndexReadable(baselineDir?: string): void {
  legalLawIndexFiles(baselineDir)
}

/**
 * Load every legal-law index file in a directory, keyed by law name.
 * @param baselineDir - directory override; defaults to the packaged assets.
 * @returns the baselines by law name.
 * @throws LegalLawBaselineError when the directory is unreadable, empty, or holds a malformed file.
 */
export function loadLegalLawBaselines(baselineDir?: string): Map<LegalLawName, LegalLawBaseline> {
  const files = legalLawIndexFiles(baselineDir)

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
  const articles = readArticleEntries(root['articles'], fail)

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
