/**
 * Legal knowledge-base contracts.
 * Row structures align with the law + category tables of laws-full.db.
 * @module @deepseek-ai/dsh-patent-knowledge/legal/types
 */

import type { LawValidity } from './validity.ts'

/** Legal level (law.level values). */
export type LawLevel = '法律' | '行政法规' | '司法解释' | '地方性法规' | '宪法' | '案例' | '部门规章' | '其他'

/** One law record (law table joined with category). */
export type LawRecord = {
  /** Primary key, format "<name>_<publish date>". */
  id: string
  /** Legal level. */
  level: string
  /** Law name (without date). */
  name: string
  /** Original file name. */
  filename?: string | undefined
  /** Publish date YYYY-MM-DD. */
  publish?: string | undefined
  /**
   * Whether expired (0=in force, 1=expired). Absent means the source carries no
   * expiry flag; readers must consult {@link LawRecord.validity} instead of
   * treating absence as 0.
   */
  expired?: number | undefined
  /** Validity at the search's as-of date; `unverified` when no time column is available. */
  validity: LawValidity
  /** Effective date YYYY-MM-DD. */
  validFrom?: string | undefined
  /** Expiry date YYYY-MM-DD. */
  validTo?: string | undefined
  /** Where the validity columns came from (audit label, optional). */
  validitySource?: string | undefined
  /** Category foreign key. */
  categoryId: number
  /** Subtitle (e.g. a civil-code book name). */
  subtitle?: string | undefined
  /** Full text. */
  content?: string | undefined
  /** Category name (joined category.name). */
  categoryName?: string | undefined
}

/** One legal search hit. */
export type LawSearchResult = LawRecord & {
  /** Relevance score (BM25 rank; lower is more relevant). */
  score: number
  /** Matched fragment (FTS5 snippet). */
  snippet?: string
}

/** Point-in-time options shared by the by-name / by-id lookups. */
export type LawLookupOptions = {
  /** 判定时点（YYYY-MM-DD）；缺省为今天。非法日期抛错。 */
  asOf?: string
  /** 是否返回时间效力未核验的记录；缺省 true。 */
  includeUnverified?: boolean
}

/** One legal category (category table). */
export type LawCategory = {
  id: number
  name: string
  folder: string
  isSubFolder: number
  group?: string
}

/**
 * Unified legal search source contract. LegalSearchEngine reads laws-full.db;
 * KnowledgeLawSearch reads the law_article documents of knowledge.db.
 */
export type LegalSearchSource = {
  /** Whether FTS5 is actually available. */
  readonly ftsAvailable: boolean
  /** Full-text search (FTS5 BM25 first, LIKE fallback for short queries or no FTS). */
  search(keyword: string, options?: {
    limit?: number
    level?: string
    category?: string
    /** 判定时点（YYYY-MM-DD）；缺省为今天。 */
    asOf?: string
    /** 是否返回时间效力未核验的记录；缺省 true。 */
    includeUnverified?: boolean
  }): LawSearchResult[]
  /** Fuzzy find by name. */
  findByName(name: string, limit?: number, options?: LawLookupOptions): LawRecord[]
  /** Exact get by primary key. */
  getById(id: string, options?: LawLookupOptions): LawRecord | undefined
  /** Batch get by primary key. */
  getByIds(ids: string[], options?: LawLookupOptions): LawRecord[]
  /** List categories. */
  getCategories(): LawCategory[]
  /** Total count (diagnostics). */
  count(): number
  close(): void
}
