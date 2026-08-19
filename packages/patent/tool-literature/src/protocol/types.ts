/**
 * Academic literature connector contract, ported from the Sati literature layer.
 *
 * A Connector is a thin wrapper over one public academic data source (arXiv,
 * OpenAlex, Semantic Scholar, Crossref...), uniformly implementing `search`/`fetch`
 * plus metadata. The tool layer (`paper_search` / `paper_list_sources`) routes only
 * through the registry and never touches a concrete database, so the model-facing
 * tool count stays constant (2) no matter how many sources are wired in.
 * @module @deepseek-ai/dsh-tool-literature/protocol
 */

/** Literature domain (union reserved for future expansion: chemistry, genomics, ...). */
export type LiteratureDomain = 'literature'

/** One normalized search hit. */
export interface ConnectorHit {
  /** Stable id within the source (arXiv id, OpenAlex W…, DOI…). */
  id: string
  /** Human-readable title. */
  title: string
  /** Abstract or citation snippet. */
  summary?: string
  /** Canonical record URL at the source. */
  url?: string
  /** Source-provided relevance score (0-1 or source-native). */
  score?: number
  /** Source-specific structured fields passed through verbatim (e.g. arXiv pdf link). */
  extra?: Record<string, unknown>
}

/** Options accepted by `search`; connectors ignore unsupported fields. */
export interface SearchOptions {
  /** Max hits; connectors clamp to their own cap (1-50). */
  limit?: number
  /** Pass-through cancellation signal. */
  signal?: AbortSignal
}

/** Options accepted by `fetch`. */
export interface FetchOptions {
  signal?: AbortSignal
}

/** The uniform contract every academic data source implements. */
export interface Connector {
  /** Unique, stable, lowercase routing id (e.g. "arxiv", "openalex"). */
  id: string
  /** Display name (e.g. "arXiv"). */
  name: string
  /** Business domain this source belongs to. */
  domain: LiteratureDomain
  /** One-line description shown by `paper_list_sources`. */
  description: string
  /** Homepage / documentation URL. */
  homepage?: string
  /** Search; returns normalized hits. */
  search(query: string, opts?: SearchOptions): Promise<ConnectorHit[]>
  /** Fetch one record by id (reserved; not exposed by the first-tier tools). */
  fetch?(id: string, opts?: FetchOptions): Promise<unknown>
}

/** Serializable catalog entry the registry exposes (no functions). */
export interface CatalogEntry {
  id: string
  name: string
  domain: LiteratureDomain
  description: string
  homepage?: string
}
