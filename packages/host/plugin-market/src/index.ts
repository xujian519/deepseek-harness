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
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Host-issued identity of one registered catalog source. */
export type SourceId = Branded<'plugin-market:source'>
/** Host-issued identity of one installation receipt. */
export type ReceiptId = Branded<'plugin-market:receipt'>

/** One user-registered catalog source, validated from its manifest. */
export interface PluginMarketSource {
  /** Host-issued stable identity (not the provider's own id). */
  id: SourceId
  /** Provider-claimed stable identifier from the manifest. */
  providerId: string
  /** Display name. */
  name: string
  /** One-line description. */
  description?: string
  /** Project homepage. */
  homepage?: string
  /** Attribution shown beside catalog results. */
  attribution: { name: string; url: string }
  /** The HTTPS catalog base URL; queries go to `endpoint + '/v1/plugins'`. */
  endpoint: string
  /** The query parameters this provider supports (subset of the protocol vocabulary). */
  query: { supported: readonly string[] }
}

/** One catalog search query; only the parameters the source supports are sent. */
export interface CatalogQuery {
  /** Free-text search term. */
  q?: string
  /** Category filter. */
  category?: string
  /** Capability filter. */
  capability?: string
  /** Opaque continuation cursor from the previous page. */
  cursor?: string
  /** Page size request (the provider may clamp). */
  limit?: number
  /** Sort key. */
  sort?: string
  /** Display locale hint. */
  locale?: string
}

/** One catalog entry as served by a source, plus host-injected provenance. */
export interface CatalogItem {
  /** Provider-claimed stable item identifier. */
  id: string
  /** Display name. */
  name: string
  /** One-line description. */
  description?: string
  /** The npm package name to install. */
  package: string
  /** The exact version the entry pins. */
  version: string
  /** Category label. */
  category?: string
  /** Capability labels. */
  capability?: readonly string[]
  /** Project homepage. */
  homepage?: string
  /** SPDX license identifier. */
  license?: string
  /** The source providerId this entry came from (host-injected provenance). */
  source: string
}

/** One page of catalog results. */
export interface CatalogPage {
  /** This page's entries, provenance-stamped. */
  items: readonly CatalogItem[]
  /** Continuation cursor for the next page, absent on the last page. */
  nextCursor?: string
}

/** The outcome of an install preview against the npm registry. */
export interface InstallPreview {
  /** Package name as verified. */
  package: string
  /** Exact version as verified. */
  version: string
  /** Whether the reference resolved to a real, non-deprecated registry release. */
  verified: boolean
  /** Human-readable notes; rejection reasons when `verified` is false. */
  reasons: readonly string[]
  /** Lifecycle scripts the package declares (preinstall/install/postinstall/prepare). */
  lifecycleScripts: readonly string[]
  /** Whether the package's engines constraints accept the running Node. */
  compatible: boolean
}

/** A durable record that a managed installation succeeded. */
export interface InstallReceipt {
  /** Host-issued receipt identity, keying uninstall. */
  id: ReceiptId
  /** The installed package name. */
  package: string
  /** The installed exact version. */
  version: string
  /** The profile directory the package was added to. */
  profile: string
  /** ISO timestamp of the installation. */
  installedAt: string
}

/** Closed failure vocabulary for market operations. */
export type PluginMarketErrorCode =
  | 'source-invalid'
  | 'source-not-found'
  | 'preview-failed'
  | 'install-failed'
  | 'receipt-mismatch'
  | 'network'

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
