/**
 * Import case-law documents (案例) into the SQLite database.
 *
 * Case file format (observed from 52 files in Laws-1.0.0/案例/):
 *
 * ```markdown
 * # 案例标题（裁判要旨）
 *
 * <!-- INFO END -->
 *
 * ## 基本案情
 * ...
 * ## 裁判结果
 * ...
 * ## 案例分析
 * ...
 * ## 典型意义
 * ...
 * ```
 *
 * Some cases have `## 关键词`, `## 裁判要点` sections. Metadata (court, date,
 * case number) is sparse and must be regex-extracted from text when present.
 * @module legal-knowledge-import/import-cases
 */

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

/** Parsed case record. */
export interface ParsedCase {
  /** Case title (from `# heading`). */
  caseName: string
  /** Keywords (关键词 section). */
  keywords: string
  /** Key points (裁判要点 section). */
  keyPoints: string
  /** Basic facts (基本案情 section). */
  basicFacts: string
  /** Judgment result (裁判结果 section). */
  judgmentResult: string
  /** Case analysis (案例分析 section). */
  analysis: string
  /** Typical significance (典型意义 section). */
  typicalSignificance: string
  /** Full text (all sections joined). */
  fullText: string
  /** Extracted court name, if any. */
  court: string
  /** Extracted case number, if any. */
  caseNumber: string
  /** Extracted decision date (YYYY-MM-DD), if any. */
  decisionDate: string
  /** Case type (案件类型), if detected. */
  caseType: string
  /** Source file path. */
  sourceFile: string
}

/** Case import result statistics. */
export interface CaseImportResult {
  /** Number of case files scanned. */
  filesScanned: number
  /** Number of cases successfully imported. */
  casesImported: number
  /** Number of files that failed to parse. */
  parseErrors: number
  /** Database file path. */
  dbPath: string
}

/**
 * Parse one case Markdown file.
 * @param filePath - absolute path to the `.md` file.
 */
export function parseCaseMd(filePath: string): ParsedCase {
  const content = readFileSync(filePath, 'utf-8')

  // Extract case name from first `# heading`.
  const nameMatch = content.match(/^#\s+(.+)$/m)
  const caseName = nameMatch ? (nameMatch[1] ?? '').trim() : basename(filePath, '.md')

  // Split at <!-- INFO END --> marker.
  const infoEndIdx = content.indexOf('<!-- INFO END -->')
  const header = infoEndIdx >= 0 ? content.slice(0, infoEndIdx) : ''
  const body = infoEndIdx >= 0 ? content.slice(infoEndIdx + '<!-- INFO END -->'.length) : content

  // Simpler approach: split by `## ` headings.
  const parts = body.split(/^## /m)
  const sectionMap = new Map<string, string>()
  for (const part of parts) {
    const lineEnd = part.indexOf('\n')
    if (lineEnd < 0) continue
    const heading = part.slice(0, lineEnd).trim()
    const text = part.slice(lineEnd + 1).trim()
    sectionMap.set(heading, text)
  }

  const keywords = sectionMap.get('关键词') ?? ''
  const keyPoints = sectionMap.get('裁判要点') ?? ''
  const basicFacts = sectionMap.get('基本案情') ?? ''
  const judgmentResult = sectionMap.get('裁判结果') ?? ''
  const analysis = sectionMap.get('案例分析') ?? sectionMap.get('裁判理由') ?? ''
  const typicalSignificance = sectionMap.get('典型意义') ?? ''

  // Extract metadata from text — search judgment section first for court/date,
  // then fall back to full text.
  const fullText = body.trim()
  const judgmentSection = sectionMap.get('裁判结果') ?? ''
  const analysisSection = sectionMap.get('案例分析') ?? sectionMap.get('裁判理由') ?? ''
  const caseNameSection = sectionMap.get('案例名称') ?? ''

  // Court: prefer analysis/basic-facts (where case history is usually described),
  // then judgment section, then header (e.g. "最高人民法院发布"), then full text.
  const court = extractCourt(analysisSection)
    || extractCourt(basicFacts)
    || extractCourt(judgmentSection)
    || extractCourt(caseNameSection)
    || extractCourt(header)
    || extractCourt(fullText)
    || extractCourt(caseName)

  // Case number: search full text (case numbers can appear anywhere).
  const caseNumber = extractCaseNumber(fullText) || extractCaseNumber(caseName)

  // Decision date: prefer judgment section, then analysis, then full text.
  const decisionDate = extractDecisionDate(judgmentSection)
    || extractDecisionDate(analysisSection)
    || extractDecisionDate(fullText)

  const caseType = detectCaseType(fullText) || detectCaseType(caseName)

  return {
    caseName,
    keywords,
    keyPoints,
    basicFacts,
    judgmentResult,
    analysis,
    typicalSignificance,
    fullText,
    court,
    caseNumber,
    decisionDate,
    caseType,
    sourceFile: filePath,
  }
}

/**
 * Extract court name from text.
 *
 * Priority order:
 * 1. Court in judgment context (XX人民法院一审/二审/终审) — most reliable
 * 2. Court in byline (文/XX人民法院)
 * 3. Generic court mention
 */
function extractCourt(text: string): string {
  // Pattern 1: Court in judgment context — strongest signal.
  const judgmentCourt = text.match(/([\u4e00-\u9fa5]{2,15}人民法院)(?:一审|二审|终审)/)
  if (judgmentCourt) return judgmentCourt[1] ?? ''

  // Pattern 2: Court in byline (文/XX人民法院 or 文/XX人民法院法官XX).
  const bylineCourt = text.match(/文\/([\u4e00-\u9fa5]{2,15}人民法院)/)
  if (bylineCourt) return bylineCourt[1] ?? ''

  // Pattern 3: Generic court mention — matches XX区/县/市/人民法院 as well as
  // 最高人民法院, 高级人民法院, 中级人民法院.
  const genericCourt = text.match(/([\u4e00-\u9fa5]{2,10}(?:区|县|市|省)?人民法院)/)
  return genericCourt ? (genericCourt[1] ?? '') : ''
}

/**
 * Extract case number from text.
 *
 * Matches Chinese case number formats like:
 * - （2020）最高法民终123号
 * - (2019)京01民终5678号
 * - （2007）朝民初字第18230号
 *
 * Excludes document numbers (e.g., 温国土资发（2018）366号) by requiring
 * a court-type character sequence after the year.
 */
function extractCaseNumber(text: string): string {
  // Primary pattern: full-width parentheses with court-type characters.
  // 法/民/刑/行/知/商/执/再/初/终 etc. after year ensure it's a case number.
  const cnPattern = /[（(]\d{4}[）)][^\s]{0,5}[民刑商行知执再初终]\S*?\d+号/
  const m = text.match(cnPattern)
  if (m) return m[0]

  // Fallback: simpler pattern but still require 号 suffix and reasonable length.
  const fallback = text.match(/[（(]\d{4}[）)][^\s]{1,15}法[^\s]{0,10}\d+号/)
  if (fallback) return fallback[0]

  // Last resort: any (YYYY)...号 pattern with court-like prefix.
  const lastResort = text.match(/[（(]\d{4}[）)][^\s]{1,20}号/)
  return lastResort ? lastResort[0] : ''
}

/**
 * Extract decision date from text.
 *
 * Priority order:
 * 1. Explicit "裁判日期：YYYY-MM-DD" or "裁判日期：YYYY年MM月DD日"
 * 2. Date in judgment context: "于YYYY年MM月DD日作出/判决/宣判"
 * 3. Date near court judgment mention
 */
function extractDecisionDate(text: string): string {
  // Pattern 1: Explicit label.
  const isoMatch = text.match(/裁判日期[：:]\s*(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) return isoMatch[1] ?? ''
  const isoCnMatch = text.match(/裁判日期[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (isoCnMatch) {
    return `${isoCnMatch[1]}-${(isoCnMatch[2] ?? '').padStart(2, '0')}-${(isoCnMatch[3] ?? '').padStart(2, '0')}`
  }

  // Pattern 2: Date in judgment context — "于YYYY年MM月DD日作出/判决/宣判/审理".
  const judgmentDate = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^。]{0,20}?(?:作出|判决|宣判|审理|审结)/)
  if (judgmentDate) {
    return `${judgmentDate[1]}-${(judgmentDate[2] ?? '').padStart(2, '0')}-${(judgmentDate[3] ?? '').padStart(2, '0')}`
  }

  // Pattern 3: Date near court mention (within 30 chars before 人民法院).
  const courtDate = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^。]{0,30}?人民法院/)
  if (courtDate) {
    return `${courtDate[1]}-${(courtDate[2] ?? '').padStart(2, '0')}-${(courtDate[3] ?? '').padStart(2, '0')}`
  }

  // Pattern 4: Generic Chinese date format (last resort — may be fact date, not decision date).
  const cnMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日.*?裁判/)
  if (cnMatch) {
    return `${cnMatch[1]}-${(cnMatch[2] ?? '').padStart(2, '0')}-${(cnMatch[3] ?? '').padStart(2, '0')}`
  }

  return ''
}

/** Detect case type from text keywords. */
function detectCaseType(text: string): string {
  if (text.includes('劳动争议') || text.includes('劳动人事') || text.includes('工伤') || text.includes('劳动合同') || text.includes('加班费') || text.includes('劳务派遣')) return '劳动争议'
  if (text.includes('行政协议') || text.includes('行政诉讼') || text.includes('行政行为') || text.includes('行政复议') || text.includes('行政决定') || text.includes('行政出让')) return '行政'
  if (text.includes('消费者') || text.includes('消费购物') || text.includes('买卖合同') || text.includes('网络购物') || text.includes('销售欺诈') || text.includes('服务合同')) return '消费维权'
  if (text.includes('知识产权') || text.includes('专利') || text.includes('商标') || text.includes('著作权') || text.includes('侵犯名誉权')) return '知识产权'
  if (text.includes('民事') || text.includes('合同纠纷') || text.includes('侵权') || text.includes('婚姻') || text.includes('继承') || text.includes('物权') || text.includes('居住权') || text.includes('保理') || text.includes('人格权')) return '民事'
  if (text.includes('刑事') || text.includes('犯罪') || text.includes('刑法')) return '刑事'
  return ''
}

/**
 * Import cases from the data source directory into an existing SQLite database.
 *
 * @param inputDir - root data directory (e.g. `/path/to/Laws-1.0.0`).
 * @param dbPath - path to the SQLite database (must already exist with schema).
 * @param options - import options.
 * @returns case import result statistics.
 */
export function importCases(
  inputDir: string,
  dbPath: string,
  options: {
    onProgress?: (msg: string) => void
  } = {},
): CaseImportResult {
  const log = options.onProgress ?? (() => {})
  const caseDir = join(inputDir, '案例')

  if (!statSync(caseDir).isDirectory()) {
    log('案例目录不存在，跳过')
    return { filesScanned: 0, casesImported: 0, parseErrors: 0, dbPath }
  }

  // Scan case files recursively.
  const caseFiles: string[] = []
  const entries = readdirSync(caseDir)
  for (const entry of entries) {
    if (entry === '_index.md' || entry.startsWith('.')) continue
    const fullPath = join(caseDir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      for (const sub of readdirSync(fullPath)) {
        if (sub.endsWith('.md') && sub !== '_index.md') {
          caseFiles.push(join(fullPath, sub))
        }
      }
    } else if (stat.isFile() && entry.endsWith('.md')) {
      caseFiles.push(fullPath)
    }
  }

  log(`扫描案例文件: ${caseFiles.length} 个`)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=NORMAL')

  // Ensure schema exists (in case this runs standalone).
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

  let casesImported = 0
  let parseErrors = 0

  const insertCase = db.prepare(`
    INSERT OR REPLACE INTO cases
      (id, case_name, doc_type, court, decision_date, case_number, case_type,
       keywords, key_points, basic_facts, judgment_result, full_text, source_file)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFts = db.prepare(`
    INSERT INTO cases_fts (rowid, case_name, keywords, key_points, basic_facts, full_text)
    VALUES ((SELECT rowid FROM cases WHERE id = ?), ?, ?, ?, ?, ?)
  `)

  db.exec('BEGIN')
  try {
    for (const filePath of caseFiles) {
      try {
        const parsed = parseCaseMd(filePath)
        const id = `case_${casesImported + 1}_${basename(filePath, '.md').slice(0, 40).replace(/\s+/g, '_')}`

        insertCase.run(
          id,
          parsed.caseName,
          'judgment',
          parsed.court,
          parsed.decisionDate,
          parsed.caseNumber,
          parsed.caseType,
          parsed.keywords,
          parsed.keyPoints,
          parsed.basicFacts,
          parsed.judgmentResult,
          parsed.fullText,
          parsed.sourceFile,
        )
        insertFts.run(
          id,
          parsed.caseName,
          parsed.keywords,
          parsed.keyPoints,
          parsed.basicFacts,
          parsed.fullText,
        )
        casesImported++
        log(`  ✓ ${relative(inputDir, filePath)}`)
      } catch (err) {
        parseErrors++
        log(`  ✗ ${relative(inputDir, filePath)}: ${String(err)}`)
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    db.close()
    throw err
  }

  db.close()
  log(`\n案例导入完成: ${casesImported} 个成功, ${parseErrors} 个失败`)

  return {
    filesScanned: caseFiles.length,
    casesImported,
    parseErrors,
    dbPath,
  }
}

/**
 * Search cases using FTS5.
 * @param dbPath - path to the SQLite database.
 * @param query - search text.
 * @param limit - maximum results.
 */
export function searchCases(
  dbPath: string,
  query: string,
  limit = 10,
): Array<{ id: string; caseName: string; court: string; score: number }> {
  const db = new DatabaseSync(dbPath)
  try {
    const rows = db.prepare(`
      SELECT c.id, c.case_name, c.court, bm25(cases_fts) AS score
      FROM cases_fts f
      JOIN cases c ON c.rowid = f.rowid
      WHERE cases_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(query, limit) as Array<{ id: string; case_name: string; court: string; score: number }>
    return rows.map(r => ({
      id: r.id,
      caseName: r.case_name,
      court: r.court,
      score: r.score,
    }))
  } finally {
    db.close()
  }
}
