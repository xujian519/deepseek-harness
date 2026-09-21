/**
 * Location of the packaged style assets. The directory ships inside the package
 * (`assets/styles/`) and resolves relative to this module, so both the source
 * tree and the built `lib/` bundle read the same directory.
 * @module @deepseek-ai/dsh-doc-style/asset-location
 */

import { fileURLToPath } from 'node:url'

const ASSETS_STYLES_URL = new URL('../assets/styles/', import.meta.url)

/**
 * Directory holding the packaged style assets.
 * @returns the absolute styles directory path.
 */
export function stylesDirectory(): string {
  return fileURLToPath(ASSETS_STYLES_URL)
}
