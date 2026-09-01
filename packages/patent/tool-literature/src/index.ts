/**
 * Function plugin porting the Sati literature layer: arXiv, OpenAlex, Semantic Scholar, and
 * Crossref connectors with per-host rate limiting and in-process GET caching, exposed as the
 * model-facing `paper_list_sources` and `paper_search` tools. Named exports preserve loader
 * injection metadata.
 * @module @deepseek-ai/dsh-tool-literature
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EgoExtractor } from '@deepseek-ai/dsh-browser-backend'
import { createLiteratureRegistry } from './runtime/create-literature-registry.ts'
import { createPaperSearchTool } from './tool/paper-search.ts'
import { createPaperListSourcesTool } from './tool/paper-list-sources.ts'
import { createPaperDownloadTool } from './tool/paper-download.ts'

// Re-export the public API surface for consumers.
export { ConnectorRegistry } from './runtime/connector-registry.ts'
export { createLiteratureRegistry } from './runtime/create-literature-registry.ts'
export type { CreateLiteratureRegistryOptions } from './runtime/create-literature-registry.ts'
export type {
  Connector,
  ConnectorHit,
  CatalogEntry,
  SearchOptions,
  FetchOptions,
  LiteratureDomain,
} from './protocol/types.ts'
export { LiteratureToolError } from './error.ts'
export type { LiteratureToolErrorCode } from './error.ts'
// Shared network-fetch primitive (timeout / retry / Retry-After-aware backoff):
// re-exported so sibling packages can reuse it without importing the internal path.
export { networkFetch, NetworkFetchError, normalizeNetworkError, isRetryableNetworkCode, parseRetryAfterHeader } from './internal/network-fetch.ts'
export type { NetworkErrorCode, NetworkRetryOptions, NetworkFetchOptions } from './internal/network-fetch.ts'
export { createPaperSearchTool } from './tool/paper-search.ts'
export { createPaperListSourcesTool } from './tool/paper-list-sources.ts'
export { createPaperDownloadTool } from './tool/paper-download.ts'
export type { PaperSearchInput, PaperSearchOutput } from './tool/paper-search.ts'
export type { PaperListSourcesInput, PaperListSourcesOutput } from './tool/paper-list-sources.ts'
export type {
  PaperDownloadInput,
  PaperDownloadOutput,
  PaperDownloadResult,
  PaperDownloadDeps,
  FetchedPdf,
} from './tool/paper-download.ts'

export const name = 'tool-literature'
export const inject = ['tools']

/** Model-facing literature tool configuration. */
export interface Config {
  /** Register the arXiv connector. Defaults to true. */
  arxiv?: boolean
  /** Register the OpenAlex connector. Defaults to true. */
  openalex?: boolean
  /** Register the Semantic Scholar connector. Defaults to true. */
  semanticScholar?: boolean
  /** Register the Crossref connector. Defaults to true. */
  crossref?: boolean
  /** OpenAlex polite-pool email (optional; falls back to OPENALEX_MAILTO then a default). */
  openalexMailto?: string
  /** Semantic Scholar API key for a higher rate tier (optional). */
  semanticScholarApiKey?: string
}

/** Schemastery configuration: which connectors to register, plus optional polite-pool/key fields. */
export const Config: z<Config> = z.object({
  arxiv: z.boolean().default(true),
  openalex: z.boolean().default(true),
  semanticScholar: z.boolean().default(true),
  crossref: z.boolean().default(true),
  openalexMailto: z.string(),
  semanticScholarApiKey: z.string(),
})

/**
 * Build the connector registry from config and register the two literature tools.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's connector toggles and optional polite-pool/key fields.
 */
export function apply(ctx: Context, config: Config): void {
  const registry = createLiteratureRegistry({
    arxiv: config.arxiv,
    openalex: config.openalex,
    semanticScholar: config.semanticScholar,
    crossref: config.crossref,
    openalexMailto: config.openalexMailto,
    semanticScholarApiKey: config.semanticScholarApiKey,
  })
  ctx.tools.register(createPaperSearchTool(registry))
  ctx.tools.register(createPaperListSourcesTool(registry))
  // 论文 PDF 下载：直链优先，ego 提取链接兜底（统一 ego 栈）。
  ctx.tools.register(createPaperDownloadTool({ registry, extractor: new EgoExtractor() }))
}
