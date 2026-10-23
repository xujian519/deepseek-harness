/**
 * Judicial interpretation search engine for the legal domain (SQLite FTS5 + in-memory backends).
 *
 * Searches judicial interpretation records (司法解释) and guiding case records
 * (指导性案例) by keyword matching. Supports filtering by interpretation type
 * and point-in-time validity checking.
 *
 * Dual-backend architecture:
 * - SQLite mode (dbPath provided): FTS5 (BM25 ranking) → LIKE fallback → memory
 * - In-memory mode (no dbPath): keyword TF scoring (Phase 2 initial backend)
 *
 * FTS5 capability is probed at construction: the FTS table must exist AND the
 * runtime SQLite must have been compiled with FTS5 support.
 * @module @deepseek-ai/dsh-legal-knowledge/judicial-interpretation/search
 */

import { type DatabaseSync } from 'node:sqlite'
import { searchInMemory, filterRecords } from '../shared/memory-store.ts'
import { columnText } from '../shared/row-text.ts'
import { isVisible, resolveAsOf, resolveValidity } from '../shared/validity.ts'
import { escapeFtsPhrase, joinFtsOrTerms, sqliteHasFts5 } from '../shared/fts.ts'
import { runFtsSearch } from '../shared/fts-search.ts'
import type {
  GuidingCaseHit,
  GuidingCaseRecord,
  JudicialInterpretationHit,
  JudicialInterpretationRecord,
  JudicialInterpretationSearchOptions,
} from '../types.ts'

/** Extract all searchable text from a judicial interpretation record. */
function extractInterpretationText(record: JudicialInterpretationRecord): string {
  return [record.interpretationName, record.documentNumber, record.articleText].join(' ')
}

/** Extract all searchable text from a guiding case record. */
function extractGuidingCaseText(record: GuidingCaseRecord): string {
  return [record.caseName, record.guidingCaseNumber, record.keyPoints, record.fullText].join(' ')
}

/**
 * Judicial interpretation search engine (SQLite FTS5 + in-memory dual backend).
 *
 * Provides keyword-based search over judicial interpretation records and
 * guiding case records with filtering by interpretation type and point-in-time
 * validity checking. SQLite mode uses FTS5 BM25 ranking with LIKE fallback;
 * in-memory mode uses term frequency scoring.
 */
export class JudicialInterpretationSearch {
  private readonly interpretations: JudicialInterpretationRecord[]
  private readonly guidingCases: GuidingCaseRecord[]
  private readonly db: DatabaseSync | null
  private readonly hasFts: boolean
  /** FTS5 查询曾抛异常（模块缺失等）后置 true，后续查询直接走 LIKE。 */
  private ftsDegraded = false
  private readonly logger?: { warn: (message: string) => void }

  constructor(options: {
    db?: DatabaseSync
    dbPath?: string
    interpretations?: JudicialInterpretationRecord[]
    guidingCases?: GuidingCaseRecord[]
    logger?: { warn: (message: string) => void }
  } = {}) {
    this.interpretations = options.interpretations ?? []
    this.guidingCases = options.guidingCases ?? []
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
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='judicial_interpretations_fts' LIMIT 1")
        .get() as { present: number } | undefined
      this.hasFts = row !== undefined && sqliteHasFts5(this.db)
    } else {
      this.hasFts = false
    }
  }

  /**
   * Search judicial interpretation records by keyword.
   * @param query - the search text.
   * @param options - result cap, type filter, and validity options.
   * @returns matching hits sorted by relevance (descending).
   */
  search(query: string, options: JudicialInterpretationSearchOptions = {}): JudicialInterpretationHit[] {
    const limit = options.limit ?? 10
    const trimmed = query.trim()
    if (!trimmed) return []

    if (this.db) {
      return this.searchWithSqlite(trimmed, options, limit)
    }
    return this.searchInMemory(trimmed, options, limit)
  }

  /**
   * Search guiding cases by keyword.
   * @param query - the search text.
   * @param limit - result cap.
   * @returns matching guiding case hits sorted by relevance.
   */
  searchGuidingCases(query: string, limit = 10): GuidingCaseHit[] {
    const trimmed = query.trim()
    if (!trimmed) return []

    if (this.db) {
      return this.searchGuidingCasesFromSqlite(trimmed, limit)
    }
    return this.searchGuidingCasesInMemory(trimmed, limit)
  }

  /**
   * Get a judicial interpretation by its ID.
   * @param interpretationId - the interpretation identifier.
   * @param options - validity options.
   * @returns the record, or undefined when not found or not visible.
   */
  getById(
    interpretationId: string,
    options: JudicialInterpretationSearchOptions = {},
  ): JudicialInterpretationRecord | undefined {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true
    if (this.db) {
      return this.getByIdFromSqlite(interpretationId, asOf, includeUnverified)
    }
    const record = this.interpretations.find(r => r.interpretationId === interpretationId)
    if (record === undefined) return undefined
    const validity = resolveValidity(
      { effectiveDate: record.effectiveDate, expiryDate: record.expiryDate, expired: record.expired },
      asOf,
    )
    return isVisible(validity, includeUnverified) ? { ...record, validity } : undefined
  }

  /**
   * Get a guiding case by its ID.
   * @param caseId - the guiding case identifier.
   * @returns the record, or undefined when not found.
   */
  getGuidingCaseById(caseId: string): GuidingCaseRecord | undefined {
    if (this.db) {
      return this.getGuidingCaseByIdFromSqlite(caseId)
    }
    return this.guidingCases.find(r => r.caseId === caseId)
  }

  /** Total number of judicial interpretation records. */
  countInterpretations(): number {
    if (this.db) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) AS c FROM judicial_interpretations').get() as { c: number }
        return row.c
      } catch {
        return 0
      }
    }
    return this.interpretations.length
  }

  /** Total number of guiding case records. */
  countGuidingCases(): number {
    if (this.db) {
      try {
        const row = this.db.prepare('SELECT COUNT(*) AS c FROM guiding_cases').get() as { c: number }
        return row.c
      } catch {
        return 0
      }
    }
    return this.guidingCases.length
  }

  /**
   * Add interpretation records to the in-memory store (for bootstrap / incremental loading).
   * Only effective when the engine is in memory mode (no DB).
   * @param newRecords - records to add.
   */
  addInterpretations(newRecords: JudicialInterpretationRecord[]): void {
    this.interpretations.push(...newRecords)
  }

  /**
   * Add guiding case records to the in-memory store (for bootstrap / incremental loading).
   * Only effective when the engine is in memory mode (no DB).
   * @param newRecords - records to add.
   */
  addGuidingCases(newRecords: GuidingCaseRecord[]): void {
    this.guidingCases.push(...newRecords)
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

  // --- Private: SQLite search path (interpretations) ---

  private searchWithSqlite(keyword: string, options: JudicialInterpretationSearchOptions, limit: number): JudicialInterpretationHit[] {
    return runFtsSearch<JudicialInterpretationHit>({
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
    this.logger?.warn(`[legal-knowledge] 司法解释 FTS5 不可用，已降级 LIKE: ${reason}`)
  }

  private searchFts(keyword: string, options: JudicialInterpretationSearchOptions, limit: number): JudicialInterpretationHit[] {
    const phrase = escapeFtsPhrase(keyword)
    return this.searchFtsWithQuery(phrase, options, limit)
  }

  private searchFtsKeywords(keywords: string[], options: JudicialInterpretationSearchOptions, limit: number): JudicialInterpretationHit[] {
    const query = joinFtsOrTerms(keywords)
    return this.searchFtsWithQuery(query, options, limit)
  }

  private searchFtsWithQuery(matchQuery: string, options: JudicialInterpretationSearchOptions, limit: number): JudicialInterpretationHit[] {
    if (!this.db) return []
    const { sql, params } = this.buildFtsQuery(options, limit)
    try {
      const rows = this.db.prepare(sql).all(...params, matchQuery) as Array<Record<string, unknown>>
      return this.filterByValidity(rows.map(row => this.rowToHit(row, 'fts')), options)
    } catch {
      return this.searchLike(matchQuery.replace(/"/g, ''), options, limit)
    }
  }

  private buildFtsQuery(options: JudicialInterpretationSearchOptions, limit: number): { sql: string; params: Array<string | number> } {
    let sql = `
      SELECT ji.*, bm25(judicial_interpretations_fts) AS fts_rank
      FROM judicial_interpretations_fts
      JOIN judicial_interpretations ji ON ji.id = judicial_interpretations_fts.rowid
      WHERE judicial_interpretations_fts MATCH ?
    `
    const params: Array<string | number> = []
    const { filterSql, filterParams } = this.buildFilterClause(options, 'ji')
    sql += filterSql
    params.push(...filterParams)
    sql += ' ORDER BY bm25(judicial_interpretations_fts) LIMIT ?'
    params.push(limit * 2)
    return { sql, params }
  }

  private searchLike(keyword: string, options: JudicialInterpretationSearchOptions, limit: number): JudicialInterpretationHit[] {
    if (!this.db) return []
    const pattern = `%${keyword.replace(/[%_\\]/g, m => `\\${m}`)}%`
    const { filterSql, filterParams } = this.buildFilterClause(options, 'ji')
    const sql = `
      SELECT ji.*
      FROM judicial_interpretations ji
      WHERE (ji.interpretation_name LIKE ? ESCAPE '\\'
             OR ji.article_text LIKE ? ESCAPE '\\'
             OR ji.document_number LIKE ? ESCAPE '\\')
      ${filterSql}
      LIMIT ?
    `
    const params: Array<string | number> = [pattern, pattern, pattern, ...filterParams, limit * 2]
    try {
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      return this.filterByValidity(rows.map(row => this.rowToHit(row, 'like')), options)
    } catch {
      return []
    }
  }

  private buildFilterClause(
    options: JudicialInterpretationSearchOptions,
    alias: string,
  ): { filterSql: string; filterParams: Array<string | number> } {
    let filterSql = ''
    const filterParams: Array<string | number> = []
    if (options.interpretationType) {
      filterSql += ` AND ${alias}.interpretation_type = ?`
      filterParams.push(options.interpretationType)
    }
    return { filterSql, filterParams }
  }

  /** Apply point-in-time validity filtering to SQLite-sourced hits. */
  private filterByValidity(
    hits: JudicialInterpretationHit[],
    options: JudicialInterpretationSearchOptions,
  ): JudicialInterpretationHit[] {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true
    const limit = options.limit ?? 10
    const results: JudicialInterpretationHit[] = []
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

  private rowToHit(row: Record<string, unknown>, via: JudicialInterpretationHit['via']): JudicialInterpretationHit {
    const base: JudicialInterpretationHit = {
      interpretationId: columnText(row.interpretation_id ?? row.interpretationId),
      interpretationName: columnText(row.interpretation_name ?? row.interpretationName),
      interpretationType: (row.interpretation_type ?? row.interpretationType ?? 'judicial-interpretation') as JudicialInterpretationHit['interpretationType'],
      issuingBody: columnText(row.issuing_body ?? row.issuingBody),
      documentNumber: columnText(row.document_number ?? row.documentNumber),
      effectiveDate: columnText(row.effective_date ?? row.effectiveDate),
      validity: 'unverified' as const,
      articleNumber: typeof row.article_number === 'number' ? row.article_number : Number(row.articleNumber ?? 0),
      articleText: columnText(row.article_text ?? row.articleText),
      relevanceScore: typeof row.fts_rank === 'number' ? row.fts_rank : 0,
      via,
    }
    const publishDateVal = row.publish_date ?? row.publishDate
    if (publishDateVal != null) base.publishDate = columnText(publishDateVal)
    const expiryDateVal = row.expiry_date ?? row.expiryDate
    if (expiryDateVal != null) base.expiryDate = columnText(expiryDateVal)
    if (typeof row.expired === 'number') base.expired = row.expired
    const sourcePathVal = row.source_path ?? row.sourcePath
    if (sourcePathVal != null) base.sourcePath = columnText(sourcePathVal)
    return base
  }

  private getByIdFromSqlite(
    interpretationId: string,
    asOf: string,
    includeUnverified: boolean,
  ): JudicialInterpretationRecord | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare(
        'SELECT * FROM judicial_interpretations WHERE interpretation_id = ? LIMIT 1',
      ).get(interpretationId) as Record<string, unknown> | undefined
      if (!row) return undefined
      const record = this.rowToRecord(row)
      const validity = resolveValidity(record, asOf)
      return isVisible(validity, includeUnverified) ? { ...record, validity } : undefined
    } catch {
      return undefined
    }
  }

  private rowToRecord(row: Record<string, unknown>): JudicialInterpretationRecord {
    const base: JudicialInterpretationRecord = {
      interpretationId: columnText(row.interpretation_id ?? row.interpretationId),
      interpretationName: columnText(row.interpretation_name ?? row.interpretationName),
      interpretationType: (row.interpretation_type ?? row.interpretationType ?? 'judicial-interpretation') as JudicialInterpretationRecord['interpretationType'],
      issuingBody: columnText(row.issuing_body ?? row.issuingBody),
      documentNumber: columnText(row.document_number ?? row.documentNumber),
      effectiveDate: columnText(row.effective_date ?? row.effectiveDate),
      validity: 'unverified' as const,
      articleNumber: typeof row.article_number === 'number' ? row.article_number : Number(row.articleNumber ?? 0),
      articleText: columnText(row.article_text ?? row.articleText),
    }
    const publishDateVal = row.publish_date ?? row.publishDate
    if (publishDateVal != null) base.publishDate = columnText(publishDateVal)
    const expiryDateVal = row.expiry_date ?? row.expiryDate
    if (expiryDateVal != null) base.expiryDate = columnText(expiryDateVal)
    if (typeof row.expired === 'number') base.expired = row.expired
    const sourcePathVal = row.source_path ?? row.sourcePath
    if (sourcePathVal != null) base.sourcePath = columnText(sourcePathVal)
    return base
  }

  // --- Private: SQLite search path (guiding cases) ---

  private searchGuidingCasesFromSqlite(keyword: string, limit: number): GuidingCaseHit[] {
    if (!this.db) return []
    const pattern = `%${keyword.replace(/[%_\\]/g, m => `\\${m}`)}%`
    const sql = `
      SELECT gc.*
      FROM guiding_cases gc
      WHERE gc.case_name LIKE ? ESCAPE '\\'
             OR gc.key_points LIKE ? ESCAPE '\\'
             OR gc.full_text LIKE ? ESCAPE '\\'
      LIMIT ?
    `
    try {
      const rows = this.db.prepare(sql).all(pattern, pattern, pattern, limit) as Array<Record<string, unknown>>
      return rows.map(row => this.rowToGuidingCaseHit(row, 'like'))
    } catch {
      return []
    }
  }

  private getGuidingCaseByIdFromSqlite(caseId: string): GuidingCaseRecord | undefined {
    if (!this.db) return undefined
    try {
      const row = this.db.prepare(
        'SELECT * FROM guiding_cases WHERE case_id = ? LIMIT 1',
      ).get(caseId) as Record<string, unknown> | undefined
      if (!row) return undefined
      return this.rowToGuidingCaseRecord(row)
    } catch {
      return undefined
    }
  }

  private rowToGuidingCaseHit(row: Record<string, unknown>, via: GuidingCaseHit['via']): GuidingCaseHit {
    return {
      caseId: columnText(row.case_id ?? row.caseId),
      guidingCaseNumber: columnText(row.guiding_case_number ?? row.guidingCaseNumber),
      caseName: columnText(row.case_name ?? row.caseName),
      court: columnText(row.court),
      decisionDate: columnText(row.decision_date ?? row.decisionDate),
      caseType: columnText(row.case_type ?? row.caseType),
      keyPoints: columnText(row.key_points ?? row.keyPoints),
      relatedLaws: this.parseRelatedLaws(row.related_laws ?? row.relatedLaws),
      fullText: columnText(row.full_text ?? row.fullText),
      relevanceScore: 0,
      via,
    }
  }

  private rowToGuidingCaseRecord(row: Record<string, unknown>): GuidingCaseRecord {
    return {
      caseId: columnText(row.case_id ?? row.caseId),
      guidingCaseNumber: columnText(row.guiding_case_number ?? row.guidingCaseNumber),
      caseName: columnText(row.case_name ?? row.caseName),
      court: columnText(row.court),
      decisionDate: columnText(row.decision_date ?? row.decisionDate),
      caseType: columnText(row.case_type ?? row.caseType),
      keyPoints: columnText(row.key_points ?? row.keyPoints),
      relatedLaws: this.parseRelatedLaws(row.related_laws ?? row.relatedLaws),
      fullText: columnText(row.full_text ?? row.fullText),
    }
  }

  private parseRelatedLaws(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String)
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value)
        if (Array.isArray(parsed)) return parsed.map(String)
      } catch {
        return value.split(',').map(s => s.trim()).filter(Boolean)
      }
    }
    return []
  }

  // --- Private: In-memory search path ---

  private searchInMemory(
    query: string,
    options: JudicialInterpretationSearchOptions,
    limit: number,
  ): JudicialInterpretationHit[] {
    const asOf = resolveAsOf(options.asOf)
    const includeUnverified = options.includeUnverified ?? true

    const filtered = filterRecords(this.interpretations, r => r.interpretationType, options.interpretationType)
    const hits = searchInMemory(filtered, query, extractInterpretationText, limit * 2)

    const results: JudicialInterpretationHit[] = []
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

  private searchGuidingCasesInMemory(query: string, limit: number): GuidingCaseHit[] {
    const hits = searchInMemory(this.guidingCases, query, extractGuidingCaseText, limit)
    return hits.map(hit => ({
      ...hit.record,
      relevanceScore: hit.score,
      via: 'memory' as const,
    }))
  }
}
