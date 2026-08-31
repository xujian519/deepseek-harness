/**
 * Service Definition for the `ctx.pluginMarket` capability seam: open plugin
 * catalog discovery and managed installation. Sources are user-registered
 * HTTPS catalog endpoints speaking the catalog protocol (docs/schemas); every
 * remote payload is untrusted input validated against the wire schemas.
 * Installation wraps the profile's package manager with a snapshot/rollback
 * receipt trail, so a failed add never leaves the profile half-installed.
 * @module @deepseek-ai/dsh-host-plugin-market
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { CatalogPage, CatalogQuery, InstallPreview, InstallReceipt, PluginMarketErrorCode, PluginMarketSource } from './types.ts'

/** Type vocabulary (sources, queries, pages, receipts, error codes). */
export type * from './types.ts'

/** Typed failure thrown by market operations. */
export class PluginMarketError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param message - operator-facing description.
   */
  constructor(readonly code: PluginMarketErrorCode, message: string) {
    super(message)
    this.name = 'PluginMarketError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Open plugin catalog and managed-installation service. */
    pluginMarket: PluginMarket
  }
}

/**
 * Abstract plugin-market service. Subclass, implement the methods, and load
 * the subclass as a plugin — it registers as `ctx.pluginMarket`.
 */
export abstract class PluginMarket extends Service {
  constructor(ctx: Context) {
    super(ctx, 'pluginMarket')
  }

  /**
   * List the registered catalog sources.
   * @returns every registered source.
   */
  abstract listSources(): Promise<readonly PluginMarketSource[]>

  /**
   * Register a catalog source from its manifest URL.
   * @param url - HTTPS URL of the source manifest.
   * @returns the registered, validated source.
   */
  abstract addSource(url: string): Promise<PluginMarketSource>

  /**
   * Remove a registered source.
   * @param id - the source identity from {@link listSources}.
   */
  abstract removeSource(id: string): Promise<void>

  /**
   * Query one source's catalog.
   * @param sourceId - the source to query.
   * @param query - search parameters; unsupported ones are dropped.
   * @returns one page of provenance-stamped entries.
   */
  abstract search(sourceId: string, query?: CatalogQuery): Promise<CatalogPage>

  /**
   * Preview an installation against the npm registry without touching the profile.
   * @param ref - `name@version` package reference.
   * @returns the verification result.
   */
  abstract preview(ref: string): Promise<InstallPreview>

  /**
   * Install a catalog entry into the active profile, with snapshot/rollback.
   * @param sourceId - the source that listed the entry.
   * @param ref - `name@version` package reference.
   * @returns a durable receipt keying uninstall.
   */
  abstract install(sourceId: string, ref: string): Promise<InstallReceipt>

  /**
   * Uninstall a previously managed installation.
   * @param receiptId - the receipt from {@link install}.
   */
  abstract uninstall(receiptId: string): Promise<void>

  /**
   * List the managed installations.
   * @returns every durable installation receipt.
   */
  abstract listInstallations(): Promise<readonly InstallReceipt[]>
}

export default PluginMarket
