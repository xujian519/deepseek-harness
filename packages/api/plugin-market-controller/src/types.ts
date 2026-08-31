/**
 * Browser-safe failure vocabulary of the plugin-market discovery surface this
 * package serves. The catalog views themselves live with their seam in
 * `@deepseek-ai/dsh-host-plugin-market/types`, whose Cordis event declarations
 * already register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-plugin-market-controller/types
 */

import type { PluginMarketErrorCode } from '@deepseek-ai/dsh-host-plugin-market/types'

export type {
  CatalogItem,
  CatalogPage,
  CatalogQuery,
  InstallPreview,
  InstallReceipt,
  PluginMarketErrorCode,
  PluginMarketSource,
  ReceiptId,
  SourceId,
} from '@deepseek-ai/dsh-host-plugin-market/types'

/** Plugin-market business failure carried by a rejected Remote call. */
export type PluginMarketError = {
  readonly code: PluginMarketErrorCode
  readonly message: string
  readonly details: object
}
