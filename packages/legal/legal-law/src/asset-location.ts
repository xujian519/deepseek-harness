/**
 * Locate the packaged legal-law baseline assets.
 *
 * The index ships inside the package (`assets/legal-law/`) and resolves relative
 * to this module, so both the source tree and the built `lib/` bundle read the
 * same directory. An explicit directory replaces the packaged one and must
 * mirror its layout, `manifest.json` included.
 * @module @deepseek-ai/dsh-legal-law/asset-location
 */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS_LEGAL_LAW_URL = new URL('../assets/legal-law/', import.meta.url)

/**
 * Manifest file inside a legal-law index directory. It lists which law each
 * `.yaml` file holds, so a caller can learn the index's law names without
 * parsing the article data.
 */
export const LEGAL_LAW_MANIFEST_FILE = 'manifest.json'

/**
 * Directory holding the legal-law index assets: the explicit override when
 * given (resolved against the process working directory), otherwise the
 * packaged one.
 * @param baselineDir - optional directory override.
 * @returns the absolute legal-law index directory path.
 */
export function legalLawBaselineDir(baselineDir?: string): string {
  return baselineDir !== undefined && baselineDir.trim() !== ''
    ? resolve(baselineDir)
    : fileURLToPath(ASSETS_LEGAL_LAW_URL)
}

/**
 * List the legal-law index files in a directory, sorted for a deterministic
 * load order.
 * @param dir - the legal-law index directory.
 * @returns the absolute file paths ending in `.yaml`.
 */
export function listLegalLawFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(entry => entry.endsWith('.yaml'))
    .sort()
    .map(entry => resolve(dir, entry))
}
