/**
 * Legal knowledge data-path resolution. The databases are large and are not
 * shipped with the repository, so the service resolves them from the deployment
 * configuration at construction time.
 * @module @deepseek-ai/dsh-legal-knowledge/config
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LegalKnowledgeConfig, LegalKnowledgePaths } from './types.ts'

/** Default legal knowledge data directory: ~/.dsh/legal-knowledge. */
export const DEFAULT_LEGAL_KNOWLEDGE_DIR = join(homedir(), '.dsh', 'legal-knowledge')

/** Default source legal.db path: ~/.dsh/legal-knowledge/legal.db. */
export const DEFAULT_LEGAL_SOURCE_DB_PATH = join(homedir(), '.dsh', 'legal-knowledge', 'legal.db')

/**
 * Resolve the query database and install source from config.
 *
 * The query database prefers legal.db then legal-lite.db under the data
 * directory, and finally falls back to the source database for read-only direct
 * use. Resolution only locates paths; it does not open the database.
 * @param config - deployment configuration (defaults applied for absent fields).
 * @returns the resolved on-disk paths.
 */
export function resolveLegalKnowledgePaths(config: LegalKnowledgeConfig = {}): LegalKnowledgePaths {
  const dataDir = config.knowledgeDir ?? DEFAULT_LEGAL_KNOWLEDGE_DIR
  const sourceDbPath = config.sourceDbPath ?? DEFAULT_LEGAL_SOURCE_DB_PATH
  const candidates = [join(dataDir, 'legal.db'), join(dataDir, 'legal-lite.db'), sourceDbPath]
  const queryDbPath = candidates.find(p => existsSync(p)) ?? join(dataDir, 'legal.db')
  return {
    dataDir,
    queryDbPath,
    sourceDbPath,
  }
}
