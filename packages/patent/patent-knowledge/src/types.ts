/**
 * Type declarations for the knowledge.db query seam: deployment-varying
 * configuration, the install bootstrap options/result, and the resolved
 * on-disk paths.
 * @module @deepseek-ai/dsh-patent-knowledge/types
 */

/** Deployment-varying knowledge configuration. */
export interface Config {
  /**
   * Data directory for the trimmed query database and wiki cards. Defaults to
   * ~/.dsh/knowledge.
   */
  knowledgeDir?: string
  /**
   * Path to the source knowledge.db for the install command (and the read-only
   * direct-use fallback). Defaults to ~/.sati/knowledge/knowledge.db.
   */
  sourceDbPath?: string
}

/** Options for the patent-knowledge:install data bootstrap. */
export interface InstallKnowledgeDbOptions {
  /** Source database to trim. Defaults to the configured sourceDbPath. */
  sourceDbPath?: string | undefined
  /** Destination data directory. Defaults to the configured knowledgeDir. */
  knowledgeDir?: string | undefined
  /** Explicit output path. Defaults to <knowledgeDir>/knowledge-lite.db. */
  output?: string | undefined
  /** Compress chunks.content long bodies to gzip BLOBs (default true). */
  compressChunks?: boolean
  /** Keep the embeddings tables (default false: drop them, per P0.4). */
  keepEmbeddings?: boolean
  /** Drop the FTS5 indexes, degrading full-text search to LIKE (default false). */
  noFts?: boolean
  /** Skip the post-trim component verification (default false). */
  skipVerify?: boolean
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
  /** Dropped tables. */
  dropped: string[]
  /** Number of chunks compressed (0 when compression was disabled). */
  compressedChunks: number
}

/** Resolved on-disk knowledge paths. */
export interface KnowledgePaths {
  /** Data directory (the configured knowledgeDir). */
  dataDir: string
  /** Database the query engines open (fail-loud when absent). */
  queryDbPath: string
  /** Wiki-card directory (keyword table lookup only; no vector index in P1). */
  wikiDir: string
  /** Source database path used by the install command. */
  sourceDbPath: string
}
