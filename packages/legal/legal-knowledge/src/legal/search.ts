/**
 * Legal regulation search engine for the legal domain (SQLite FTS5 + in-memory backends).
 *
 * Searches legal regulation records (法律法规) by keyword matching across
 * regulation name, article text, and level. Supports filtering by legal level
 * and point-in-time validity checking.
 *
 * Dual-backend architecture:
 * - SQLite mode (dbPath provided): FTS5 (BM25 ranking) → LIKE fallback → memory
 * - In-memory mode (no dbPath): keyword TF scoring (Phase 2 initial backend)
 *
 * FTS5 capability is probed at construction: the FTS table must exist AND the
 * runtime SQLite must have been compiled with FTS5 support.
 * @module @deepseek-ai/dsh-legal-knowledge/legal/search
 */

import { type DatabaseSync } from 'node:sqlite'
import { searchInMemory, filterRecords } from '../shared/memory-store.ts'
import { isVisible, resolveAsOf, resolveValidity } from '../shared/validity.ts'
import { escapeFtsPhrase, joinFtsOrTerms, sqliteHasFts5 } from '../shared/fts.ts'
import { runFtsSearch } from '../shared/fts-search.ts'
import type { LegalRegulationHit, LegalRegulationRecord, LegalSearchOptions } from '../types.ts'

/** Extract all searchable text from a legal regulation record. */
function extractSearchableText(record: LegalRegulationRecord): string {
  return [record.regulationName, record.articleText].join(' ')
}

/**
 * Legal regulation search engine (SQLite FTS5 + in-memory dual backend).
 *
 * Provides keyword-based search over legal regulation records with filtering
 * by legal level and point-in-time validity checking. SQLite mode uses FTS5
 * BM25 ranking with LIKE fallback; in-memory mode uses term frequency scoring.
 */
export class LegalRegulationSearchEngine {
  private readonly records: LegalRegulationRecord[]
  private readonly db: DatabaseSync | null
  private readonly hasFts: boolean
  /** FTS5 查询曾抛异常（模块缺失等）后置 true，后续查询直接走 LIKE。 */
  private ftsDegraded = false
  private readonly logger?: { warn: (message: string) => void }

  constructor(
    recordsOrOptions?: LegalRegulationRecord[] | {
      db?: DatabaseSync
      dbPath?: string
      records?: LegalRegulationRecord[]
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync: DB } = require('node:sqlite') as typeof import('node:sqlite')
      this.db = new DB(options.dbPath, { readOnly: true })
    } else {
      this.db = null
    }
    // Detect FTS5 availability: table must exist AND runtime must support FTS5.
    if (this.db) {
      const row = this.db
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='legal_regulations_fts' LIMIT 1")
        .get() as { present: number } | undefined
      this.hasFts = row !== undefined && sqliteHasFts5(this.db)
    } else {
      this.hasFts = false
    }
  }

  /**
   * Search legal regulation records by keyword.
   * @param query - the search text.
   * @param options - result cap, level filter, and validity options.
   * @returns matching hits sorted by relevance (descending).
   */
  search(query: string, options: LegalSearchOptions = {}): LegalRegulationHit[] {
    const limit = options.limit ?? 10
    const trimmed = query.trim()
    if (!trimmed) return []

    if (this.db) {
      return this.searchWithSqlite(trimmed, options, limit)
    }
    return this.searchInMemory(trimmed, options, limit)
  }

  /**
   * Find regulations by name (fuzzy match).
   * @param name - the regulation name (or substring).
   * @param limit - result cap.
   * @param options - validity options.
   * @returns matching records.
   */
  findByName(name: string, limit = 10, options: LegalSearchOptions = {}): LegalRegulationRecord[] {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true
    if (this.db) {
      return this.findByNameFromSqlite(name, limit, asOf, includeUnverified)
    }
    const lower = name.toLowerCase()
    const matches = this.records
      .filter(r => r.regulationName.toLowerCase().includes(lower))
      .filter((r) => {
        const validity = resolveValidity(
          { effectiveDate: r.effectiveDate, expiryDate: r.expiryDate, expired: r.expired },
          asOf,
        )
        return isVisible(validity, includeUnverified)
      })
      .slice(0, limit)
    return matches.map(r => ({
      ...r,
      validity: resolveValidity(
        { effectiveDate: r.effectiveDate, expiryDate: r.expiryDate, expired: r.expired },
        asOf,
      ),
    }))
  }

  /**
   * Get a regulation record by its ID.
   * @param regulationId - the regulation identifier.
   * @param options - validity options.
   * @returns the record, or undefined when not found or not visible.
   */
  getById(regulationId: string, options: LegalSearchOptions = {}): LegalRegulationRecord | undefined {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true
    if (this.db) {
      return this.getByIdFromSqlite(regulationId, asOf, includeUnverified)
    }
    const record = this.records.find(r => r.regulationId === regulationId)
    if (record === undefined) return undefined
    const validity = resolveValidity(
      { effectiveDate: record.effectiveDate, expiryDate: record.expiryDate, expired: record.expired },
      asOf,
    )
    return isVisible(validity, includeUnverified) ? { ...record, validity } : undefined
  }

  /** Total number of regulation records. */
  count(): number {
    if (this.db) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) AS c FROM legal_regulations').get() as { c: number }
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
  addRecords(newRecords: LegalRegulationRecord[]): void {
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

  private searchWithSqlite(keyword: string, options: LegalSearchOptions, limit: number): LegalRegulationHit[] {
    return runFtsSearch<LegalRegulationHit>({
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
    this.logger?.warn(`[legal-knowledge] 法规 FTS5 不可用，已降级 LIKE: ${reason}`)
  }

  private searchFts(keyword: string, options: LegalSearchOptions, limit: number): LegalRegulationHit[] {
    const phrase = escapeFtsPhrase(keyword)
    return this.searchFtsWithQuery(phrase, options, limit)
  }

  private searchFtsKeywords(keywords: string[], options: LegalSearchOptions, limit: number): LegalRegulationHit[] {
    const query = joinFtsOrTerms(keywords)
    return this.searchFtsWithQuery(query, options, limit)
  }

  private searchFtsWithQuery(matchQuery: string, options: LegalSearchOptions, limit: number): LegalRegulationHit[] {
    if (!this.db) return []
    const { sql, params } = this.buildFtsQuery(options, limit)
    try {
      const rows = this.db.prepare(sql).all(...params, matchQuery) as Array<Record<string, unknown>>
      return this.filterByValidity(rows.map(row => this.rowToHit(row, 'fts')), options)
    } catch {
      return this.searchLike(matchQuery.replace(/"/g, ''), options, limit)
    }
  }

  private buildFtsQuery(options: LegalSearchOptions, limit: number): { sql: string; params: Array<string | number> } {
    let sql = `
      SELECT lr.*, bm25(legal_regulations_fts) AS fts_rank
      FROM legal_regulations_fts
      JOIN legal_regulations lr ON lr.id = legal_regulations_fts.rowid
      WHERE legal_regulations_fts MATCH ?
    `
    const params: Array<string | number> = []
    const { filterSql, filterParams } = this.buildFilterClause(options, 'lr')
    sql += filterSql
    params.push(...filterParams)
    sql += ' ORDER BY bm25(legal_regulations_fts) LIMIT ?'
    params.push(limit * 2) // Over-fetch to account for validity filtering.
    return { sql, params }
  }

  private searchLike(keyword: string, options: LegalSearchOptions, limit: number): LegalRegulationHit[] {
    if (!this.db) return []
    const pattern = `%${keyword.replace(/[%_\\]/g, m => `\\${m}`)}%`
    const { filterSql, filterParams } = this.buildFilterClause(options, 'lr')
    const sql = `
      SELECT lr.*
      FROM legal_regulations lr
      WHERE (lr.regulation_name LIKE ? ESCAPE '\\'
             OR lr.article_text LIKE ? ESCAPE '\\')
      ${filterSql}
      LIMIT ?
    `
    const params: Array<string | number> = [pattern, pattern, ...filterParams, limit * 2]
    try {
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      return this.filterByValidity(rows.map(row => this.rowToHit(row, 'like')), options)
    } catch {
      return []
    }
  }

  private buildFilterClause(options: LegalSearchOptions, alias: string): { filterSql: string; filterParams: Array<string | number> } {
    let filterSql = ''
    const filterParams: Array<string | number> = []
    if (options.level) {
      filterSql += ` AND ${alias}.level = ?`
      filterParams.push(options.level)
    }
    return { filterSql, filterParams }
  }

  /** Apply point-in-time validity filtering to SQLite-sourced hits. */
  private filterByValidity(hits: LegalRegulationHit[], options: LegalSearchOptions): LegalRegulationHit[] {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true
    const limit = options.limit ?? 10
    const results: LegalRegulationHit[] = []
    for (const hit of hits) {
      if (results.length >= limit) break
      const validity = resolveValidity(
        { effectiveDate: hit.effectiveDate, expiryDate: hit.expiryDate, expired: hit.expired },
        asOf,
      )
      if (!isVisible(validity, includeUnverified)) continue
      results.push({ ...hit, validity })
    }
    return results
  }

  private rowToHit(row: Record<string, unknown>, via: LegalRegulationHit['via']): LegalRegulationHit {
    const base: LegalRegulationHit = {
      regulationId: String(row.regulation_id ?? row.regulationId ?? ''),
      regulationName: String(row.regulation_name ?? row.regulationName ?? ''),
      level: (row.level ?? '其他') as LegalRegulationHit['level'],
      effectiveDate: String(row.effective_date ?? row.effectiveDate ?? ''),
      validity: 'unverified' as const, // Will be resolved by filterByValidity.
      articleNumber: typeof row.article_number === 'number' ? row.article_number : Number(row.articleNumber ?? 0),
      articleText: String(row.article_text ?? row.articleText ?? ''),
      relevanceScore: typeof row.fts_rank === 'number' ? row.fts_rank : 0,
      via,
    }
    const publishDateVal = row.publish_date ?? row.publishDate
    if (publishDateVal != null) base.publishDate = String(publishDateVal)
    const expiryDateVal = row.expiry_date ?? row.expiryDate
    if (expiryDateVal != null) base.expiryDate = String(expiryDateVal)
    if (typeof row.expired === 'number') base.expired = row.expired
    const sourcePathVal = row.source_path ?? row.sourcePath
    if (sourcePathVal != null) base.sourcePath = String(sourcePathVal)
    return base
  }

  private findByNameFromSqlite(name: string, limit: number, asOf: string, includeUnverified: boolean): LegalRegulationRecord[] {
    if (!this.db) return []
    const pattern = `%${name.replace(/[%_\\]/g, m => `\\${m}`)}%`
    const sql = `
      SELECT * FROM legal_regulations
      WHERE regulation_name LIKE ? ESCAPE '\\'
      LIMIT ?
    `
    try {
      const rows = this.db.prepare(sql).all(pattern, limit * 2) as Array<Record<string, unknown>>
      const results: LegalRegulationRecord[] = []
      for (const row of rows) {
        if (results.length >= limit) break
        const record = this.rowToRecord(row)
        const validity = resolveValidity(record, asOf)
        if (!isVisible(validity, includeUnverified)) continue
        results.push({ ...record, validity })
      }
      return results
    } catch {
      return []
    }
  }

  private getByIdFromSqlite(regulationId: string, asOf: string, includeUnverified: boolean): LegalRegulationRecord | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare(
        'SELECT * FROM legal_regulations WHERE regulation_id = ? LIMIT 1',
      ).get(regulationId) as Record<string, unknown> | undefined
      if (!row) return undefined
      const record = this.rowToRecord(row)
      const validity = resolveValidity(record, asOf)
      return isVisible(validity, includeUnverified) ? { ...record, validity } : undefined
    } catch {
      return undefined
    }
  }

  private rowToRecord(row: Record<string, unknown>): LegalRegulationRecord {
    const base: LegalRegulationRecord = {
      regulationId: String(row.regulation_id ?? row.regulationId ?? ''),
      regulationName: String(row.regulation_name ?? row.regulationName ?? ''),
      level: (row.level ?? '其他') as LegalRegulationRecord['level'],
      effectiveDate: String(row.effective_date ?? row.effectiveDate ?? ''),
      validity: 'unverified' as const,
      articleNumber: typeof row.article_number === 'number' ? row.article_number : Number(row.articleNumber ?? 0),
      articleText: String(row.article_text ?? row.articleText ?? ''),
    }
    const publishDateVal = row.publish_date ?? row.publishDate
    if (publishDateVal != null) base.publishDate = String(publishDateVal)
    const expiryDateVal = row.expiry_date ?? row.expiryDate
    if (expiryDateVal != null) base.expiryDate = String(expiryDateVal)
    if (typeof row.expired === 'number') base.expired = row.expired
    const sourcePathVal = row.source_path ?? row.sourcePath
    if (sourcePathVal != null) base.sourcePath = String(sourcePathVal)
    return base
  }

  // --- Private: In-memory search path ---

  private searchInMemory(query: string, options: LegalSearchOptions, limit: number): LegalRegulationHit[] {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true

    const filtered = filterRecords(this.records, r => r.level, options.level)
    const hits = searchInMemory(filtered, query, extractSearchableText, limit * 2)

    const results: LegalRegulationHit[] = []
    for (const hit of hits) {
      if (results.length >= limit) break
      const validity = resolveValidity(
        { effectiveDate: hit.record.effectiveDate, expiryDate: hit.record.expiryDate, expired: hit.record.expired },
        asOf,
      )
      if (!isVisible(validity, includeUnverified)) continue
      results.push({
        ...hit.record,
        validity,
        relevanceScore: hit.score,
        via: 'memory',
      })
    }
    return results
  }
}
