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
import { DEFAULT_CACHE_TTL_MS, DEFAULT_RETRY, DEFAULT_TIMEOUT_MS } from './runtime/http.ts'
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
// Shared network-fetch primitive (timeout / retry / Retry-After-aware backoff): the
// single fetch abstraction used across the patent tool family, re-exported here so
// sibling packages reuse the same primitive instead of hand-rolling a fetch layer.
export { networkFetch, NetworkFetchError, normalizeNetworkError, isRetryableNetworkCode, parseRetryAfterHeader } from './network-fetch.ts'
export type { NetworkErrorCode, NetworkRetryOptions, NetworkFetchOptions } from './network-fetch.ts'
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
  /**
   * Timeout for one HTTP request in ms. Defaults to 30000. Slow networks
   * (proxy, internal mirror) raise it; offline deployments shorten it.
   */
  timeoutMs?: number
  /** GET cache TTL in ms; 0 disables the cache. Defaults to 300000. */
  cacheTtlMs?: number
  /**
   * Retry budget for one request. Timeout times retries bounds the worst-case
   * latency, so the two are configured together.
   */
  retry?: {
    /** Retries after the first attempt. Defaults to 3. */
    maxRetries?: number
    /** First backoff delay in ms. Defaults to 1000. */
    baseDelayMs?: number
    /** Cap for one backoff delay in ms. Defaults to 15000. */
    maxDelayMs?: number
  }
}

/** Schemastery configuration: connector registration, optional credentials, and network budgets. */
export const Config: z<Config> = z.object({
  arxiv: z.boolean().default(true),
  openalex: z.boolean().default(true),
  semanticScholar: z.boolean().default(true),
  crossref: z.boolean().default(true),
  openalexMailto: z.string(),
  semanticScholarApiKey: z.string(),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
  cacheTtlMs: z.number().step(1).min(0).default(DEFAULT_CACHE_TTL_MS),
  retry: z.object({
    maxRetries: z.number().step(1).min(0).default(DEFAULT_RETRY.maxRetries),
    baseDelayMs: z.number().step(1).min(0).default(DEFAULT_RETRY.baseDelayMs),
    maxDelayMs: z.number().step(1).min(0).default(DEFAULT_RETRY.maxDelayMs),
  }),
})

/**
 * Build the connector registry from config and register the two literature tools.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's connector toggles, optional credentials, and network budgets.
 */
export function apply(ctx: Context, config: Config): void {
  const registry = createLiteratureRegistry({
    arxiv: config.arxiv,
    openalex: config.openalex,
    semanticScholar: config.semanticScholar,
    crossref: config.crossref,
    openalexMailto: config.openalexMailto,
    semanticScholarApiKey: config.semanticScholarApiKey,
    timeoutMs: config.timeoutMs,
    cacheTtlMs: config.cacheTtlMs,
    retry: config.retry,
  })
  ctx.tools.register(createPaperSearchTool(registry))
  ctx.tools.register(createPaperListSourcesTool(registry))
  // 论文 PDF 下载：直链优先，ego 提取链接兜底（统一 ego 栈）。
  ctx.tools.register(createPaperDownloadTool({ registry, extractor: new EgoExtractor() }))
}
