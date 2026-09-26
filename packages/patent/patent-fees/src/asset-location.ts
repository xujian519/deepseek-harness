/**
 * Locate the packaged fee index.
 *
 * The index ships inside the package (`assets/fees/`) and resolves relative to
 * this module, so both the source tree and the built `lib/` bundle read the same
 * file. An explicit path replaces the packaged one.
 * @module @deepseek-ai/dsh-patent-fees/asset-location
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS_FEES_URL = new URL('../assets/fees/', import.meta.url)

/** File name of the packaged fee index. */
export const FEE_FILE_NAME = 'cn-fees.yaml'

/**
 * Path of the fee index: the explicit override when given (resolved against the
 * process working directory), otherwise the packaged one.
 * @param tablePath - optional file path override.
 * @returns the absolute path of the fee index.
 */
export function feeTablePath(tablePath?: string): string {
  return tablePath !== undefined && tablePath.trim() !== ''
    ? resolve(tablePath)
    : fileURLToPath(new URL(FEE_FILE_NAME, ASSETS_FEES_URL))
}
