/**
 * Service Definition for the legal knowledge-base query seam (ctx.legalKnowledge):
 * case-law search, legal regulation search, judicial interpretation search,
 * and guiding case lookup.
 *
 * The service provides a unified query interface over SQLite FTS5 or in-memory
 * record stores. When a database is available and useFts5 is true (default),
 * engines use FTS5 full-text search with BM25 ranking and LIKE fallback;
 * otherwise they use in-memory keyword matching.
 *
 * The service owns no model-facing surface; consumers own tool schemas and
 * result rendering.
 * @module @deepseek-ai/dsh-legal-knowledge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveLegalKnowledgePaths } from './config.ts'
import { CaseLawSearchEngine } from './case-law/search.ts'
import { LegalRegulationSearchEngine } from './legal/search.ts'
import { JudicialInterpretationSearch } from './judicial-interpretation/search.ts'
import type { LegalKnowledgeConfig, LegalKnowledgePaths } from './types.ts'
import type { CaseLawHit, CaseLawRecord, CaseLawSearchOptions } from './types.ts'
import type { LegalRegulationHit, LegalRegulationRecord, LegalSearchOptions } from './types.ts'
import type {
  GuidingCaseHit,
  GuidingCaseRecord,
  JudicialInterpretationHit,
  JudicialInterpretationRecord,
  JudicialInterpretationSearchOptions,
} from './types.ts'

// Path/config surface.
export { DEFAULT_LEGAL_KNOWLEDGE_DIR, DEFAULT_LEGAL_SOURCE_DB_PATH, resolveLegalKnowledgePaths } from './config.ts'
export type { LegalKnowledgeConfig, LegalKnowledgePaths } from './types.ts'

// Case-law surface.
export { CaseLawSearchEngine } from './case-law/search.ts'

// Legal regulation surface.
export { LegalRegulationSearchEngine } from './legal/search.ts'

// Judicial interpretation surface.
export { JudicialInterpretationSearch } from './judicial-interpretation/search.ts'

// Install surface.
export { installLegalKnowledgeDb } from './install.ts'

// Validity helpers.
export { isVisible, resolveAsOf, resolveValidity, todayIsoDate } from './shared/validity.ts'
export type { ValidityInput } from './shared/validity.ts'

// In-memory store primitives.
export { filterRecords, searchInMemory } from './shared/memory-store.ts'
export type { MemoryHit } from './shared/memory-store.ts'

// FTS5 shared utilities.
export { escapeFtsPhrase, FTS_MIN_RUNES, joinFtsOrTerms, sqliteHasFts5 } from './shared/fts.ts'
export { runFtsSearch } from './shared/fts-search.ts'
export type { FtsSearchLadder } from './shared/fts-search.ts'
export { extractLawKeywords } from './shared/keywords.ts'

// Type re-exports.
export type {
  CaseLawDocType,
  CaseLawHit,
  CaseLawRecord,
  CaseLawSearchOptions,
  GuidingCaseHit,
  GuidingCaseRecord,
  InstallLegalKnowledgeOptions,
  InstallResult,
  JudicialInterpretationHit,
  JudicialInterpretationRecord,
  JudicialInterpretationSearchOptions,
  LegalLevel,
  LegalRegulationHit,
  LegalRegulationRecord,
  LegalRegulationValidity,
  LegalSearchOptions,
} from './types.ts'

/**
 * LegalKnowledge service: the legal knowledge-base query seam (ctx.legalKnowledge).
 *
 * Lazily initializes search engines for case-law, legal regulations, and
 * judicial interpretations. When useFts5 is true (default) and a database is
 * available at the resolved query path, engines use SQLite FTS5 full-text
 * search with BM25 ranking and LIKE fallback; otherwise they use in-memory
 * keyword matching populated via addRecords().
 */
export class LegalKnowledge extends Service {
  static Config: z<LegalKnowledgeConfig> = z.object({
    knowledgeDir: z.string().default(resolveLegalKnowledgePaths().dataDir),
    sourceDbPath: z.string().default(resolveLegalKnowledgePaths().sourceDbPath),
    cacheMaxEntries: z.number().min(1).default(1024),
    useFts5: z.boolean().default(true),
  })

  /** Resolved on-disk paths (query db, install source). */
  readonly paths: LegalKnowledgePaths

  private readonly caseLawEngine: CaseLawSearchEngine
  private readonly legalEngine: LegalRegulationSearchEngine
  private readonly judicialEngine: JudicialInterpretationSearch
  /** Whether the engines are using the SQLite FTS5 backend. */
  private readonly useFts5: boolean

  constructor(ctx: Context, config: LegalKnowledgeConfig = {}) {
    super(ctx, 'legalKnowledge')
    this.paths = resolveLegalKnowledgePaths(config)
    this.useFts5 = config.useFts5 !== false

    // When FTS5 is enabled and the query database exists, pass the path to engines.
    // Engines will probe FTS5 availability at construction and degrade gracefully.
    const dbPath = this.useFts5 ? this.paths.queryDbPath : undefined

    const engineOptions = dbPath !== undefined ? { dbPath } : {}
    this.caseLawEngine = new CaseLawSearchEngine(engineOptions)
    this.legalEngine = new LegalRegulationSearchEngine(engineOptions)
    this.judicialEngine = new JudicialInterpretationSearch(engineOptions)
    this.ctx.effect(() => () => { this.close() }, 'legal-knowledge: engines')
  }

  /**
   * Case-law full-text search (SQLite FTS5 with LIKE fallback, or in-memory).
   * @param query - the search text.
   * @param options - result cap, docType/court/caseType filters.
   * @returns matching hits sorted by relevance.
   */
  caseLawSearch(query: string, options?: CaseLawSearchOptions): CaseLawHit[] {
    return this.caseLawEngine.search(query, options)
  }

  /**
   * Legal regulation full-text search (SQLite FTS5 with LIKE fallback, or in-memory).
   * @param query - the search text.
   * @param options - result cap, level filter, and validity options.
   * @returns matching hits sorted by relevance.
   */
  legalSearch(query: string, options?: LegalSearchOptions): LegalRegulationHit[] {
    return this.legalEngine.search(query, options)
  }

  /**
   * Judicial interpretation full-text search (SQLite FTS5 with LIKE fallback, or in-memory).
   * @param query - the search text.
   * @param options - result cap, type filter, and validity options.
   * @returns matching hits sorted by relevance.
   */
  judicialInterpretationSearch(
    query: string,
    options?: JudicialInterpretationSearchOptions,
  ): JudicialInterpretationHit[] {
    return this.judicialEngine.search(query, options)
  }

  /**
   * Guiding case search (SQLite LIKE or in-memory keyword matching).
   * @param query - the search text.
   * @param limit - result cap.
   * @returns matching guiding case hits sorted by relevance.
   */
  guidingCaseSearch(query: string, limit?: number): GuidingCaseHit[] {
    return this.judicialEngine.searchGuidingCases(query, limit)
  }

  /**
   * Add case-law records to the in-memory store.
   * Only effective when the engine is not using a SQLite database.
   * @param records - records to add.
   */
  addCaseLawRecords(records: CaseLawRecord[]): void {
    this.caseLawEngine.addRecords(records)
  }

  /**
   * Add legal regulation records to the in-memory store.
   * Only effective when the engine is not using a SQLite database.
   * @param records - records to add.
   */
  addLegalRegulationRecords(records: LegalRegulationRecord[]): void {
    this.legalEngine.addRecords(records)
  }

  /**
   * Add judicial interpretation records to the in-memory store.
   * Only effective when the engine is not using a SQLite database.
   * @param records - records to add.
   */
  addJudicialInterpretationRecords(records: JudicialInterpretationRecord[]): void {
    this.judicialEngine.addInterpretations(records)
  }

  /**
   * Add guiding case records to the in-memory store.
   * Only effective when the engine is not using a SQLite database.
   * @param records - records to add.
   */
  addGuidingCaseRecords(records: GuidingCaseRecord[]): void {
    this.judicialEngine.addGuidingCases(records)
  }

  /** Close all engines and release SQLite connections. */
  private close(): void {
    this.caseLawEngine.close()
    this.legalEngine.close()
    this.judicialEngine.close()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    legalKnowledge: LegalKnowledge
  }
}

export default LegalKnowledge
