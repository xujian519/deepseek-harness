/**
 * Knowledge data-path resolution. The databases are large and are not shipped
 * with the repository, so the service resolves them from the deployment
 * configuration at construction time.
 * @module @deepseek-ai/dsh-patent-knowledge/config
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Config, KnowledgePaths } from './types.ts'

/** Default knowledge data directory: ~/.dsh/knowledge. */
export const DEFAULT_KNOWLEDGE_DIR = join(homedir(), '.dsh', 'knowledge')

/** Default source knowledge.db (the Sati pipeline output): ~/.sati/knowledge/knowledge.db. */
export const DEFAULT_SOURCE_DB_PATH = join(homedir(), '.sati', 'knowledge', 'knowledge.db')

/**
 * Resolve the query database, wiki directory, and install source from config.
 *
 * The query database prefers knowledge.db then knowledge-lite.db under the data
 * directory, and finally falls back to the source database for read-only direct
 * use. Resolution only locates paths; it does not open the database.
 * @param config - deployment configuration (defaults applied for absent fields).
 * @returns the resolved on-disk paths.
 */
export function resolveKnowledgePaths(config: Config = {}): KnowledgePaths {
  const dataDir = config.knowledgeDir ?? DEFAULT_KNOWLEDGE_DIR
  const sourceDbPath = config.sourceDbPath ?? DEFAULT_SOURCE_DB_PATH
  const candidates = [join(dataDir, 'knowledge.db'), join(dataDir, 'knowledge-lite.db'), sourceDbPath]
  const queryDbPath = candidates.find(p => existsSync(p)) ?? join(dataDir, 'knowledge.db')
  return {
    dataDir,
    queryDbPath,
    wikiDir: join(dataDir, 'wiki'),
    sourceDbPath,
  }
}
