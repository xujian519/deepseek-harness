/**
 * Case-law search engine for the legal domain (SQLite FTS5 + in-memory backends).
 *
 * Searches case-law records (裁判案例) by keyword matching across case name,
 * court, case number, case type, full text, and summary. Supports filtering
 * by document type, court, and case type.
 *
 * Dual-backend architecture:
 * - SQLite mode (dbPath provided): FTS5 (BM25 ranking) → LIKE fallback → memory
 * - In-memory mode (no dbPath): keyword TF scoring (Phase 2 initial backend)
 *
 * FTS5 capability is probed at construction: the FTS table must exist AND the
 * runtime SQLite must have been compiled with FTS5 support.
 * @module @deepseek-ai/dsh-legal-knowledge/case-law/search
 */

import { type DatabaseSync } from 'node:sqlite'
import { searchInMemory, filterRecords } from '../shared/memory-store.ts'
import { escapeFtsPhrase, joinFtsOrTerms, sqliteHasFts5 } from '../shared/fts.ts'
import { runFtsSearch } from '../shared/fts-search.ts'
import type { CaseLawHit, CaseLawRecord, CaseLawSearchOptions } from '../types.ts'

/** Maximum result limit for case-law search. */
const MAX_LIMIT = 50

/** Extract all searchable text from a case-law record. */
function extractSearchableText(record: CaseLawRecord): string {
  return [
    record.caseName,
    record.court,
    record.caseNumber,
    record.caseType,
    record.fullText,
    record.summary ?? '',
  ].join(' ')
}

/**
 * Case-law search engine (SQLite FTS5 + in-memory dual backend).
 *
 * Provides keyword-based search over case-law records with filtering by
 * document type, court, and case type. SQLite mode uses FTS5 BM25 ranking
 * with LIKE fallback; in-memory mode uses term frequency scoring.
 */
export class CaseLawSearchEngine {
  private readonly records: CaseLawRecord[]
  private readonly db: DatabaseSync | null
  private readonly hasFts: boolean
  /** FTS5 查询曾抛异常（模块缺失等）后置 true，后续查询直接走 LIKE。 */
  private ftsDegraded = false
  private readonly logger?: { warn: (message: string) => void }

  constructor(
    recordsOrOptions?: CaseLawRecord[] | {
      db?: DatabaseSync
      dbPath?: string
      records?: CaseLawRecord[]
      logger?: { warn: (message: string) => void }
    },
  ) {
    // Backward-compatible: accept either a records array or an options object.
    const options = Array.isArray(recordsOrOptions)
      ? { records: recordsOrOptions }
      : recordsOrOptions ?? {}
    this.records = options.records ?? []
    if (options.logger) {
      this.logger = options.logger
    }
    if (options.db) {
      this.db = options.db
    } else if (options.dbPath) {
      const { DatabaseSync: DB } = process.getBuiltinModule('node:sqlite')
      this.db = new DB(options.dbPath, { readOnly: true })
    } else {
      this.db = null
    }
    // Detect FTS5 availability: table must exist AND runtime must support FTS5.
    if (this.db) {
      const row = this.db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='case_law_fts' LIMIT 1")
        .get() as { present: number } | undefined
      this.hasFts = row !== undefined && sqliteHasFts5(this.db)
    } else {
      this.hasFts = false
    }
  }

  /**
   * Search case-law records by keyword.
   * @param query - the search text.
   * @param options - result cap, docType/court/caseType filters.
   * @returns matching hits sorted by relevance (descending).
   */
  search(query: string, options: CaseLawSearchOptions = {}): CaseLawHit[] {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), MAX_LIMIT)
    const trimmed = query.trim()
    if (!trimmed) return []

    if (this.db) {
      return this.searchWithSqlite(trimmed, options, limit)
    }
    return this.searchInMemory(trimmed, options, limit)
  }

  /**
   * Get a case-law record by its ID.
   * @param caseId - the case identifier.
   * @returns the record, or undefined when not found.
   */
  getById(caseId: string): CaseLawRecord | undefined {
    if (this.db) {
      return this.getByIdFromSqlite(caseId)
    }
    return this.records.find(r => r.caseId === caseId)
  }

  /** Total number of case-law records. */
  count(): number {
    if (this.db) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) AS c FROM case_law').get() as { c: number }
        return row.c
      } catch {
        return 0
      }
    }
    return this.records.length
  }

  /**
   * Add records to the in-memory store (for bootstrap / incremental loading).
   * Only effective when the engine is in memory mode (no DB).
   * @param newRecords - records to add.
   */
  addRecords(newRecords: CaseLawRecord[]): void {
    this.records.push(...newRecords)
  }

  /** Close the underlying database connection (no-op for memory mode). */
  close(): void {
    if (this.db) {
      this.db.close()
    }
  }

  /** FTS5 是否实际可用（表存在 + 运行时支持 + 未被降级）。 */
  get ftsAvailable(): boolean {
    return this.hasFts && !this.ftsDegraded
  }

  // --- Private: SQLite search path ---

  private searchWithSqlite(keyword: string, options: CaseLawSearchOptions, limit: number): CaseLawHit[] {
    return runFtsSearch<CaseLawHit>({
      keyword,
      hasFts: this.hasFts,
      ftsDegraded: this.ftsDegraded,
      searchFts: kw => this.searchFts(kw, options, limit),
      searchFtsKeywords: keywords => this.searchFtsKeywords(keywords, options, limit),
      searchLike: kw => this.searchLike(kw, options, limit),
      degrade: (reason) => { this.degradeFts(reason) },
    })
  }

  private degradeFts(reason: string): void {
    this.ftsDegraded = true
    this.logger?.warn(`[legal-knowledge] case-law FTS5 不可用，已降级 LIKE: ${reason}`)
  }

  private searchFts(keyword: string, options: CaseLawSearchOptions, limit: number): CaseLawHit[] {
    const phrase = escapeFtsPhrase(keyword)
    return this.searchFtsWithQuery(phrase, options, limit)
  }

  private searchFtsKeywords(keywords: string[], options: CaseLawSearchOptions, limit: number): CaseLawHit[] {
    const query = joinFtsOrTerms(keywords)
    return this.searchFtsWithQuery(query, options, limit)
  }

  private searchFtsWithQuery(matchQuery: string, options: CaseLawSearchOptions, limit: number): CaseLawHit[] {
    if (!this.db) return []
    const { sql, params } = this.buildFtsQuery(options, limit)
    try {
      const rows = this.db.prepare(sql).all(...params, matchQuery) as Array<Record<string, unknown>>
      return rows.map(row => this.rowToHit(row, 'fts'))
    } catch {
      // FTS query failed (e.g. malformed MATCH); degrade to LIKE.
      return this.searchLike(matchQuery.replace(/"/g, ''), options, limit)
    }
  }

  private buildFtsQuery(options: CaseLawSearchOptions, limit: number): { sql: string; params: Array<string | number> } {
    let sql = `
      SELECT cl.*, bm25(case_law_fts) AS fts_rank
      FROM case_law_fts
      JOIN case_law cl ON cl.id = case_law_fts.rowid
      WHERE case_law_fts MATCH ?
    `
    const params: Array<string | number> = []
    const { filterSql, filterParams } = this.buildFilterClause(options, 'cl')
    sql += filterSql
    params.push(...filterParams)
    sql += ' ORDER BY bm25(case_law_fts) LIMIT ?'
    params.push(limit)
    return { sql, params }
  }

  private searchLike(keyword: string, options: CaseLawSearchOptions, limit: number): CaseLawHit[] {
    if (!this.db) return []
    const pattern = `%${keyword.replace(/[%_\\]/g, m => `\\${m}`)}%`
    const { filterSql, filterParams } = this.buildFilterClause(options, 'cl')
    const sql = `
      SELECT cl.*
      FROM case_law cl
      WHERE (cl.case_name LIKE ? ESCAPE '\\'
             OR cl.full_text LIKE ? ESCAPE '\\'
             OR cl.summary LIKE ? ESCAPE '\\')
      ${filterSql}
      LIMIT ?
    `
    const params: Array<string | number> = [pattern, pattern, pattern, ...filterParams, limit]
    try {
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      return rows.map(row => this.rowToHit(row, 'like'))
    } catch {
      return []
    }
  }

  private buildFilterClause(options: CaseLawSearchOptions, alias: string): { filterSql: string; filterParams: Array<string | number> } {
    let filterSql = ''
    const filterParams: Array<string | number> = []
    if (options.docType) {
      filterSql += ` AND ${alias}.doc_type = ?`
      filterParams.push(options.docType)
    }
    if (options.court) {
      filterSql += ` AND ${alias}.court LIKE ? ESCAPE '\\'`
      filterParams.push(`%${options.court.replace(/[%_\\]/g, m => `\\${m}`)}%`)
    }
    if (options.caseType) {
      filterSql += ` AND ${alias}.case_type = ?`
      filterParams.push(options.caseType)
    }
    return { filterSql, filterParams }
  }

  private rowToHit(row: Record<string, unknown>, via: CaseLawHit['via']): CaseLawHit {
    const base: CaseLawHit = {
      caseId: String(row.case_id ?? row.caseId ?? ''),
      docType: (row.doc_type ?? row.docType ?? 'judgment') as CaseLawHit['docType'],
      caseName: String(row.case_name ?? row.caseName ?? ''),
      court: String(row.court ?? ''),
      decisionDate: String(row.decision_date ?? row.decisionDate ?? ''),
      caseNumber: String(row.case_number ?? row.caseNumber ?? ''),
      caseType: String(row.case_type ?? row.caseType ?? ''),
      fullText: String(row.full_text ?? row.fullText ?? ''),
      relevanceScore: typeof row.fts_rank === 'number' ? row.fts_rank : 0,
      via,
    }
    const summaryVal = row.summary
    if (summaryVal != null) base.summary = String(summaryVal)
    return base
  }

  private getByIdFromSqlite(caseId: string): CaseLawRecord | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare(
        'SELECT * FROM case_law WHERE case_id = ? LIMIT 1',
      ).get(caseId) as Record<string, unknown> | undefined
      if (!row) return undefined
      const base: CaseLawRecord = {
        caseId: String(row.case_id ?? ''),
        docType: (row.doc_type ?? 'judgment') as CaseLawRecord['docType'],
        caseName: String(row.case_name ?? ''),
        court: String(row.court ?? ''),
        decisionDate: String(row.decision_date ?? ''),
        caseNumber: String(row.case_number ?? ''),
        caseType: String(row.case_type ?? ''),
        fullText: String(row.full_text ?? ''),
      }
      const summaryVal = row.summary
      if (summaryVal != null) base.summary = String(summaryVal)
      return base
    } catch {
      return undefined
    }
  }

  // --- Private: In-memory search path ---

  private searchInMemory(query: string, options: CaseLawSearchOptions, limit: number): CaseLawHit[] {
    let filtered = this.records
    filtered = filterRecords(filtered, r => r.docType, options.docType)
    filtered = filterRecords(filtered, r => r.court, options.court)
    filtered = filterRecords(filtered, r => r.caseType, options.caseType)

    const hits = searchInMemory(filtered, query, extractSearchableText, limit)

    return hits.map(hit => ({
      ...hit.record,
      relevanceScore: hit.score,
      via: 'memory' as const,
    }))
  }
}
