/**
 * Legal knowledge-base contracts.
 * Row structures align with the law + category tables of laws-full.db.
 * @module @deepseek-ai/dsh-patent-knowledge/legal/types
 */

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
  /** Whether expired (0=in force, 1=expired). */
  expired: number
  /** Category foreign key. */
  categoryId: number
  /** Subtitle (e.g. a civil-code book name). */
  subtitle?: string | undefined
  /** Effective date YYYY-MM-DD. */
  validFrom?: string | undefined
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
  search(keyword: string, options?: { limit?: number; level?: string; category?: string }): LawSearchResult[]
  /** Fuzzy find by name. */
  findByName(name: string, limit?: number): LawRecord[]
  /** Exact get by primary key. */
  getById(id: string): LawRecord | undefined
  /** Batch get by primary key. */
  getByIds(ids: string[]): LawRecord[]
  /** List categories. */
  getCategories(): LawCategory[]
  /** Total count (diagnostics). */
  count(): number
  close(): void
}
