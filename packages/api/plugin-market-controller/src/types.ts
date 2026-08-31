/**
 * Browser-safe failure vocabulary of the plugin-market discovery surface this
 * package serves. The catalog views themselves live with their seam in
 * `@deepseek-ai/dsh-host-plugin-market/types`, whose Cordis event declarations
 * already register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-plugin-market-controller/types
 */

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

/**
 * Every seam business code this controller can carry onto the wire as a
 * Remote failure; `subject` names the source id or package ref the call
 * addressed when one exists.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'source-invalid': { readonly subject?: string }
    'source-not-found': { readonly subject?: string }
    'preview-failed': { readonly subject?: string }
    'install-failed': { readonly subject?: string }
    'install-unavailable': { readonly subject?: string }
    'receipt-mismatch': { readonly subject?: string }
    'network': { readonly subject?: string }
  }
}
