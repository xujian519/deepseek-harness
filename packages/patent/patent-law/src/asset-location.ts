/**
 * Locate the packaged law-baseline assets.
 *
 * The index ships inside the package (`assets/law/`) and resolves relative to
 * this module, so both the source tree and the built `lib/` bundle read the same
 * directory. An explicit directory replaces the packaged one and must mirror its
 * layout.
 * @module @deepseek-ai/dsh-patent-law/asset-location
 */

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS_LAW_URL = new URL('../assets/law/', import.meta.url)

/** Packaged law-index file names, one per law document. */
export const LAW_FILE_NAMES = [
  'cn-patent-law.yaml',
  'cn-implementing-regulations.yaml',
  'cn-examination-guidelines.yaml',
] as const

/**
 * Directory holding the law-index assets: the explicit override when given
 * (resolved against the process working directory), otherwise the packaged one.
 * @param baselineDir - optional directory override.
 * @returns the absolute law-index directory path.
 */
export function lawBaselineDir(baselineDir?: string): string {
  return baselineDir !== undefined && baselineDir.trim() !== ''
    ? resolve(baselineDir)
    : fileURLToPath(ASSETS_LAW_URL)
}

/**
 * List the law-index files in a directory, sorted for a deterministic load
 * order.
 * @param dir - the law-index directory.
 * @returns the absolute file paths ending in `.yaml`.
 */
export function listLawFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(entry => entry.endsWith('.yaml'))
    .sort()
    .map(entry => resolve(dir, entry))
}
