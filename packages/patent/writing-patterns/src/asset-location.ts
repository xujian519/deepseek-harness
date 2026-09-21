/**
 * Locate the packaged pattern corpus.
 *
 * The seed corpus ships inside the package (`assets/patterns/`) and resolves
 * relative to this module, so both the source tree and the built `lib/` bundle
 * read the same directory. An explicit directory replaces the packaged one and
 * must contain the same YAML pattern files.
 * @module @deepseek-ai/dsh-writing-patterns/asset-location
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS_PATTERNS_URL = new URL('../assets/patterns/', import.meta.url)

/** Suffix of a pattern asset file; every other entry of the directory is ignored. */
export const PATTERN_FILE_SUFFIX = '.yaml'

/**
 * Directory holding the pattern assets: the explicit override when given
 * (resolved against the process working directory), otherwise the packaged one.
 * @param patternDir - optional directory override.
 * @returns the absolute pattern directory path.
 */
export function patternDir(patternDir?: string): string {
  return patternDir !== undefined && patternDir.trim() !== ''
    ? resolve(patternDir)
    : fileURLToPath(ASSETS_PATTERNS_URL)
}
