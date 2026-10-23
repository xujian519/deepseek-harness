/**
 * Import legal regulations (法律法规) and judicial interpretations (司法解释)
 * into a SQLite database with FTS5 full-text search indexes.
 *
 * The database schema matches the query types in
 * `packages/legal/legal-knowledge/src/types.ts`.
 * @module legal-knowledge-import/import-to-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseLawMarkdown } from './parse-law-md.ts'
import { deduplicateVersions } from './version-resolver.ts'
import type { ParsedLaw } from './parse-law-md.ts'

/** Import result statistics. */
export interface ImportResult {
  /** Number of files scanned. */
  filesScanned: number
  /** Number of laws parsed (before dedup). */
  lawsParsed: number
  /** Number of laws after version deduplication. */
  lawsAfterDedup: number
  /** Number of articles inserted. */
  articlesInserted: number
  /** Number of files that failed to parse. */
  parseErrors: number
  /** Database file path. */
  dbPath: string
}

/** Folder-name → LegalLevel mapping. */
const FOLDER_LEVEL_MAP: Record<string, string> = {
  '宪法': '法律',
  '宪法相关法': '法律',
  '民法典': '法律',
  '民法商法': '法律',
  '刑法': '法律',
  '社会法': '法律',
  '经济法': '法律',
  '行政法': '法律',
  '诉讼与非诉讼程序法': '法律',
  '行政法规': '行政法规',
  '司法解释': '司法解释',
  '地方性法规': '地方性法规',
  '部门规章': '部门规章',
  '其他': '其他',
}

/**
 * Resolve the legal level from the top-level folder name.
 * @param topFolder - the immediate child directory of the data root.
 */
export function resolveLevel(topFolder: string): string {
  return FOLDER_LEVEL_MAP[topFolder] ?? '其他'
}

/**
 * Create the SQLite database schema (tables + FTS5 indexes).
 * @param db - an open DatabaseSync instance.
 */
export function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS regulations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      publish_date TEXT,
      effective_date TEXT,
      expiry_date TEXT,
      expired INTEGER DEFAULT 0,
      article_number INTEGER NOT NULL,
      article_text TEXT NOT NULL,
      chapter_title TEXT DEFAULT '',
      source_file TEXT
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS regulations_fts USING fts5(
      name, article_text, chapter_title,
      content='regulations',
      content_rowid='rowid'
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      case_name TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'judgment',
      court TEXT DEFAULT '',
      decision_date TEXT DEFAULT '',
      case_number TEXT DEFAULT '',
      case_type TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      key_points TEXT DEFAULT '',
      basic_facts TEXT DEFAULT '',
      judgment_result TEXT DEFAULT '',
      full_text TEXT NOT NULL,
      source_file TEXT
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(
      case_name, keywords, key_points, basic_facts, full_text,
      content='cases',
      content_rowid='rowid'
    )
  `)

  // Index on regulations for level-filter queries.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_regulations_level ON regulations(level)
  `)

  // Index on regulations for name lookups.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_regulations_name ON regulations(name)
  `)
}

/**
 * Scan a directory recursively for `.md` files, skipping `_index.md`.
 * @returns array of absolute file paths.
 */
function scanMdFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'scripts' || entry === '__pycache__') continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...scanMdFiles(fullPath))
    } else if (stat.isFile() && entry.endsWith('.md') && entry !== '_index.md') {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Generate a unique regulation ID from name + article number.
 */
function regulationId(name: string, articleNumber: number, level: string): string {
  const slug = name.replace(/\s+/g, '_').slice(0, 60)
  return `${level}_${slug}_art${articleNumber}`
}

/**
 * Resolve the chapter title for a given article's chapter number.
 */
function resolveChapterTitle(law: ParsedLaw, chapterNum: number | undefined): string {
  if (chapterNum === undefined) return ''
  const ch = law.chapters.find(c => c.number === chapterNum)
  return ch ? `第${chapterNum}章 ${ch.title}` : ''
}

/**
 * Import regulations from the data source directory into SQLite.
 *
 * @param inputDir - root data directory (e.g. `/path/to/Laws-1.0.0`).
 * @param dbPath - output SQLite database path.
 * @param options - import options.
 * @returns import result statistics.
 */
export function importRegulations(
  inputDir: string,
  dbPath: string,
  options: {
    /** Skip case directories (only import regulations). */
    skipCases?: boolean
    /** Progress callback. */
    onProgress?: (msg: string) => void
  } = {},
): ImportResult {
  const log = options.onProgress ?? (() => {})
  const skipCases = options.skipCases ?? false

  // Directories to scan (exclude 案例 if requested).
  const excludeDirs = new Set(['scripts', '.git', '__pycache__', '.claude', '.github'])
  if (skipCases) excludeDirs.add('案例')

  const topDirs = readdirSync(inputDir).filter((d) => {
    if (excludeDirs.has(d)) return false
    return statSync(join(inputDir, d)).isDirectory()
  })

  // Collect all law files (non-case directories).
  const allLaws: ParsedLaw[] = []
  let filesScanned = 0
  let parseErrors = 0

  for (const topDir of topDirs) {
    if (topDir === '案例') continue // cases handled separately
    const topPath = join(inputDir, topDir)
    const mdFiles = scanMdFiles(topPath)
    log(`扫描 ${topDir}/：${mdFiles.length} 个文件`)

    for (const filePath of mdFiles) {
      filesScanned++
      try {
        const content = readFileSync(filePath, 'utf8')
        const parsed = parseLawMarkdown(content, filePath)
        if (parsed.articles.length === 0) {
          // Skip files with no articles (e.g. index or empty files).
          continue
        }
        // Attach level info by enriching the parsed object.
        // The level is determined by the top-level folder.
        ;(parsed as ParsedLaw & { level: string }).level = resolveLevel(topDir)
        allLaws.push(parsed)
      } catch (err) {
        parseErrors++
        log(`  解析失败: ${relative(inputDir, filePath)}: ${String(err)}`)
      }
    }
  }

  log(`\n解析完成: ${allLaws.length} 个法律文件, ${parseErrors} 个失败`)

  // Deduplicate versions.
  const deduped = deduplicateVersions(allLaws)
  log(`去重后: ${deduped.length} 个法律（原始 ${allLaws.length} 个版本）`)

  // Open database and insert records.
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=NORMAL')
  createSchema(db)

  // Use a transaction for bulk insert.
  let articlesInserted = 0
  const insertReg = db.prepare(`
    INSERT OR REPLACE INTO regulations
      (id, name, level, publish_date, effective_date, expiry_date, expired, article_number, article_text, chapter_title, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFts = db.prepare(`
    INSERT INTO regulations_fts (rowid, name, article_text, chapter_title)
    VALUES ((SELECT rowid FROM regulations WHERE id = ?), ?, ?, ?)
  `)

  db.exec('BEGIN')
  try {
    for (const law of deduped) {
      const level = (law as ParsedLaw & { level: string }).level
      for (const article of law.articles) {
        const id = regulationId(law.name, article.number, level)
        const chapterTitle = resolveChapterTitle(law, article.chapter)
        insertReg.run(
          id,
          law.name,
          level,
          law.adoptDate || null,
          law.effectiveDate || null,
          (law as ParsedLaw & { expiryDate?: string }).expiryDate || null,
          (law as ParsedLaw & { expired?: boolean }).expired ? 1 : 0,
          article.number,
          article.text,
          chapterTitle,
          law.sourceFile,
        )
        insertFts.run(id, law.name, article.text, chapterTitle)
        articlesInserted++
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    db.close()
    throw err
  }

  log(`插入条文: ${articlesInserted} 条`)
  db.close()

  return {
    filesScanned,
    lawsParsed: allLaws.length,
    lawsAfterDedup: deduped.length,
    articlesInserted,
    parseErrors,
    dbPath,
  }
}

/**
 * Run an FTS5 search against the regulations database.
 *
 * @param dbPath - path to the SQLite database.
 * @param query - search text.
 * @param limit - maximum results.
 * @returns matching rows with BM25 relevance scores.
 */
export function searchRegulations(
  dbPath: string,
  query: string,
  limit = 10,
): Array<{ id: string; name: string; level: string; articleNumber: number; articleText: string; score: number }> {
  const db = new DatabaseSync(dbPath)
  try {
    const rows = db.prepare(`
      SELECT r.id, r.name, r.level, r.article_number, r.article_text,
             bm25(regulations_fts) AS score
      FROM regulations_fts f
      JOIN regulations r ON r.rowid = f.rowid
      WHERE regulations_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(query, limit) as Array<{
      id: string
      name: string
      level: string
      article_number: number
      article_text: string
      score: number
    }>
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      level: r.level,
      articleNumber: r.article_number,
      articleText: r.article_text,
      score: r.score,
    }))
  } finally {
    db.close()
  }
}
