/**
 * Type declarations for the legal knowledge-base query seam:
 * deployment-varying configuration, search result types for case-law,
 * legal regulations, judicial interpretations, and guiding cases.
 * @module @deepseek-ai/dsh-legal-knowledge/types
 */

/** Deployment-varying legal knowledge configuration. */
export interface LegalKnowledgeConfig {
  /**
   * Data directory for the legal knowledge store. Defaults to
   * ~/.dsh/legal-knowledge.
   */
  knowledgeDir?: string
  /**
   * Path to the source knowledge database for the install command (and the
   * read-only direct-use fallback). Defaults to ~/.dsh/legal-knowledge/legal.db.
   */
  sourceDbPath?: string
  /**
   * Upper bound on cached in-memory records, least-recently-used eviction.
   * Defaults to 1024.
   */
  cacheMaxEntries?: number
  /**
   * Whether to use SQLite FTS5 full-text search when a database is available.
   * When false, engines use the in-memory keyword matching backend even if a
   * database path is configured. Defaults to true.
   */
  useFts5?: boolean
}

/** Resolved on-disk legal knowledge paths. */
export interface LegalKnowledgePaths {
  /** Data directory (the configured knowledgeDir). */
  dataDir: string
  /** Database the query engines open (fail-loud when absent). */
  queryDbPath: string
  /** Source database path used by the install command. */
  sourceDbPath: string
}

/** Case-law document kind: judgment=裁判, guiding=指导案例. */
export type CaseLawDocType = 'judgment' | 'guiding'

/** Case-law search request options. */
export type CaseLawSearchOptions = {
  /** Result cap (default 5, engine maximum 50). */
  limit?: number
  /** Filter by document kind. */
  docType?: CaseLawDocType
  /** Filter by court substring. */
  court?: string
  /** Filter by case type (民事/刑事/行政/知识产权…). */
  caseType?: string
}

/** One case-law record (metadata). */
export type CaseLawRecord = {
  /** Primary key (unique document identifier). */
  caseId: string
  /** Document kind. */
  docType: CaseLawDocType
  /** Case name (案件名称). */
  caseName: string
  /** Adjudicating court (审理法院). */
  court: string
  /** Decision date (裁判日期, YYYY-MM-DD). */
  decisionDate: string
  /** Case number (案号, e.g. (2023)最高法民终123号). */
  caseNumber: string
  /** Case type (案件类型: 民事/刑事/行政…). */
  caseType: string
  /** Full text or summary snippet. */
  fullText: string
  /** Optional summary (裁判要旨). */
  summary?: string
}

/** One case-law search hit with relevance score and match path. */
export type CaseLawHit = CaseLawRecord & {
  /** Relevance score (BM25 rank or in-memory similarity; lower is more relevant for FTS). */
  relevanceScore: number
  /** Hit path: fts=full-text match, like=LIKE degraded match, memory=in-memory match. */
  via: 'fts' | 'like' | 'memory'
}

/** Legal regulation level (法律层级). */
export type LegalLevel = '法律' | '行政法规' | '司法解释' | '地方性法规' | '部门规章' | '其他'

/** Legal regulation search request options. */
export type LegalSearchOptions = {
  /** Result cap (default 10). */
  limit?: number
  /** Filter by legal level. */
  level?: LegalLevel
  /** Point-in-time validity (YYYY-MM-DD); defaults to today. */
  asOf?: string
  /** Whether to return records whose validity is unverified; defaults true. */
  includeUnverified?: boolean
}

/** One legal regulation record (metadata). */
export type LegalRegulationRecord = {
  /** Primary key (unique regulation identifier). */
  regulationId: string
  /** Regulation name (法规名称). */
  regulationName: string
  /** Legal level (法律层级). */
  level: LegalLevel
  /** Promulgation date (公布日期, YYYY-MM-DD). */
  publishDate?: string
  /** Effective date (施行日期, YYYY-MM-DD). */
  effectiveDate: string
  /** Expiry date (失效日期, YYYY-MM-DD); undefined means no known expiry. */
  expiryDate?: string
  /** Whether expired (0=in force, 1=expired); undefined means unverified. */
  expired?: number
  /** Validity at the search's as-of date. */
  validity: LegalRegulationValidity
  /** Article number (条号). */
  articleNumber: number
  /** Article text (条文内容). */
  articleText: string
  /** Source file path for citation tracing. */
  sourcePath?: string
}

/** One legal regulation search hit with relevance score. */
export type LegalRegulationHit = LegalRegulationRecord & {
  /** Relevance score (BM25 rank; lower is more relevant for FTS). */
  relevanceScore: number
  /** Hit path. */
  via: 'fts' | 'like' | 'memory'
}

/** Validity status of a legal regulation at a given point in time. */
export type LegalRegulationValidity = 'in-force' | 'expired' | 'not-yet-effective' | 'unverified'

/** Judicial interpretation search request options. */
export type JudicialInterpretationSearchOptions = {
  /** Result cap (default 10). */
  limit?: number
  /** Filter by interpretation level (司法解释/指导性案例). */
  interpretationType?: 'judicial-interpretation' | 'guiding-case'
  /** Point-in-time validity (YYYY-MM-DD); defaults to today. */
  asOf?: string
  /** Whether to return records whose validity is unverified; defaults true. */
  includeUnverified?: boolean
}

/** One judicial interpretation record (metadata). */
export type JudicialInterpretationRecord = {
  /** Primary key (unique interpretation identifier). */
  interpretationId: string
  /** Interpretation name (司法解释名称). */
  interpretationName: string
  /** Interpretation type. */
  interpretationType: 'judicial-interpretation' | 'guiding-case'
  /** Issuing body (发布机关, e.g. 最高人民法院). */
  issuingBody: string
  /** Document number (文号, e.g. 法释〔2023〕1号). */
  documentNumber: string
  /** Promulgation date (公布日期, YYYY-MM-DD). */
  publishDate?: string
  /** Effective date (施行日期, YYYY-MM-DD). */
  effectiveDate: string
  /** Expiry date (失效日期, YYYY-MM-DD); undefined means no known expiry. */
  expiryDate?: string
  /** Whether expired (0=in force, 1=expired); undefined means unverified. */
  expired?: number
  /** Validity at the search's as-of date. */
  validity: LegalRegulationValidity
  /** Article number (条号). */
  articleNumber: number
  /** Article text (条文内容). */
  articleText: string
  /** Source file path for citation tracing. */
  sourcePath?: string
}

/** One judicial interpretation search hit with relevance score. */
export type JudicialInterpretationHit = JudicialInterpretationRecord & {
  /** Relevance score (BM25 rank; lower is more relevant for FTS). */
  relevanceScore: number
  /** Hit path. */
  via: 'fts' | 'like' | 'memory'
}

/** Guiding case record (指导性案例). */
export type GuidingCaseRecord = {
  /** Primary key (unique guiding case identifier). */
  caseId: string
  /** Guiding case number (指导案例编号, e.g. 指导案例1号). */
  guidingCaseNumber: string
  /** Case name (案例名称). */
  caseName: string
  /** Court (审理法院). */
  court: string
  /** Decision date (裁判日期, YYYY-MM-DD). */
  decisionDate: string
  /** Case type (案件类型). */
  caseType: string
  /** Key points (裁判要点). */
  keyPoints: string
  /** Related laws (相关法条). */
  relatedLaws: string[]
  /** Full text. */
  fullText: string
}

/** Guiding case search hit with relevance score. */
export type GuidingCaseHit = GuidingCaseRecord & {
  /** Relevance score. */
  relevanceScore: number
  /** Hit path. */
  via: 'fts' | 'like' | 'memory'
}

/** Options for the legal-knowledge:install data bootstrap. */
export interface InstallLegalKnowledgeOptions {
  /** Source database to trim. Defaults to the configured sourceDbPath. */
  sourceDbPath?: string | undefined
  /** Destination data directory. Defaults to the configured knowledgeDir. */
  knowledgeDir?: string | undefined
  /** Explicit output path. Defaults to <knowledgeDir>/legal.db. */
  output?: string | undefined
  /** Drop the FTS5 indexes, degrading full-text search to LIKE (default false). */
  noFts?: boolean
  /** Progress/log sink. Defaults to console.log. */
  log?: ((line: string) => void) | undefined
}

/** Result of one install run. */
export interface InstallResult {
  /** Source database path. */
  input: string
  /** Trimmed database path. */
  output: string
  /** Source size in bytes. */
  inputBytes: number
  /** Trimmed size in bytes. */
  outputBytes: number
}
