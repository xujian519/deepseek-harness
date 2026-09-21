/**
 * Directory holding the packaged template assets: one subdirectory per category,
 * one `.md` asset per template.
 * @module @deepseek-ai/dsh-doc-template/asset-location
 */

import { fileURLToPath } from 'node:url'

const ASSETS_TEMPLATES_URL = new URL('../assets/templates/', import.meta.url)

/**
 * Directory holding the packaged template assets.
 * @returns the absolute template root path.
 */
export function templatesDirectory(): string {
  return fileURLToPath(ASSETS_TEMPLATES_URL)
}
