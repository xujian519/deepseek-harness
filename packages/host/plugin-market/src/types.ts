/**
 * Pure type vocabulary for the `ctx.pluginMarket` capability seam, imported by
 * `./types` consumers so a browser or tool faces the same wire contracts the
 * Host emits without pulling the Host service implementation.
 * @module @deepseek-ai/dsh-host-plugin-market/types
 */

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
  /** A host-bundled catalog served from memory, never reached over the network. */
  builtin?: boolean
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
  | 'install-unavailable'
  | 'receipt-mismatch'
  | 'network'
