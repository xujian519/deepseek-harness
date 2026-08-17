/**
 * Patent search/scrape result cache: LRU + TTL + in-flight merge. Only
 * cacheable (successful) results are stored; failures, timeouts, and empty
 * results pass through without poisoning the cache.
 * @module @deepseek-ai/dsh-patent-data/patent-cache
 */

import type { PatentSearchResult, ScrapeResult } from '@deepseek-ai/nuo-patent'
import type { PatentCacheOptions } from './types.ts'

type CacheNode<T> = { value: T; expiresAt: number }

/**
 * Generic async-result cache: LRU eviction, per-entry TTL, and in-flight merge.
 * Only a loader's resolved value is cached; rejections never are.
 */
export class AsyncResultCache<T> {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly map = new Map<string, CacheNode<T>>()
  private readonly inflight = new Map<string, Promise<T>>()

  constructor(options: PatentCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
    this.maxEntries = options.maxEntries ?? 100
  }

  /**
   * Return the cached value, or load (deduplicating concurrent callers) and cache it.
   * @param key - cache key.
   * @param loader - the underlying load to run on a miss.
   * @param shouldCache - optional predicate; false passes the value through without caching.
   * @returns the cached or freshly loaded value.
   */
  async getOrLoad(key: string, loader: () => Promise<T>, shouldCache?: (value: T) => boolean): Promise<T> {
    const pending = this.inflight.get(key)
    if (pending) return pending

    const node = this.map.get(key)
    if (node) {
      if (Date.now() < node.expiresAt) {
        this.map.delete(key)
        this.map.set(key, node)
        return node.value
      }
      this.map.delete(key)
    }

    const promise = loader().then(
      (value) => {
        if (shouldCache === undefined || shouldCache(value)) {
          this.set(key, value)
        }
        return value
      },
      (error) => {
        throw error
      },
    )
    this.inflight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inflight.delete(key)
    }
  }

  private set(key: string, value: T): void {
    const existing = this.map.get(key)
    if (existing) {
      this.map.delete(key)
    }
    while (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey === undefined) break
      this.map.delete(oldestKey)
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  /** Clear the cache and the in-flight merge table (tests / explicit invalidation). */
  clear(): void {
    this.map.clear()
    this.inflight.clear()
  }

  /** Number of live entries in the cache. */
  get size(): number {
    return this.map.size
  }
}

/**
 * A search result is cacheable when it carries no failure-class warning.
 * @param result - the search result to check.
 * @returns true when the result carries no failure-class warning.
 */
export function isSearchResultCacheable(result: PatentSearchResult): boolean {
  const failure = result.warnings.find(w => /^(查询条件为空|检索超时|检索失败)/.test(w))
  return !failure
}

/**
 * A scrape result is cacheable only on success.
 * @param result - the scrape result to check.
 * @returns true when the scrape succeeded.
 */
export function isScrapeResultCacheable(result: ScrapeResult): boolean {
  return result.success === true
}

/**
 * Build the search cache key (query + limit).
 * @param query - the search query.
 * @param limit - the max-hits limit.
 * @returns the cache key.
 */
export function searchCacheKey(query: string, limit: number): string {
  return `search\u0000${query}\u0000${limit}`
}

/**
 * Build the scrape cache key (patent + content toggles).
 * @param patent - the patent number.
 * @param opts - the content toggles (abstract and legal status).
 * @returns the cache key.
 */
export function scrapeCacheKey(patent: string, opts: { returnAbstract: boolean; returnLegal: boolean }): string {
  return `scrape\u0000${patent}\u0000${opts.returnAbstract ? 1 : 0}${opts.returnLegal ? 1 : 0}`
}

/**
 * Wrap a search implementation with LRU cache + in-flight merge.
 * @param impl - the underlying search function.
 * @param options - optional cache tuning.
 * @returns the same-signature cached search function.
 */
export function cachedSearchPatents(
  impl: (query: string, options?: { limit?: number }) => Promise<PatentSearchResult>,
  options: PatentCacheOptions = {},
): (query: string, options?: { limit?: number }) => Promise<PatentSearchResult> {
  const cache = new AsyncResultCache<PatentSearchResult>(options)
  return async (query, opts) => {
    const limit = opts?.limit ?? 10
    return cache.getOrLoad(searchCacheKey(query, limit), () => impl(query, { limit }), isSearchResultCacheable)
  }
}

/**
 * Wrap a scrape implementation with LRU cache + in-flight merge (success only).
 * @param impl - the underlying scrape function.
 * @param options - optional cache tuning.
 * @returns the same-signature cached scrape function.
 */
export function cachedScrapePatent(
  impl: (patent: string, options?: { returnAbstract?: boolean; returnLegal?: boolean }) => Promise<ScrapeResult>,
  options: PatentCacheOptions = {},
): (patent: string, options?: { returnAbstract?: boolean; returnLegal?: boolean }) => Promise<ScrapeResult> {
  const cache = new AsyncResultCache<ScrapeResult>(options)
  return async (patent, opts) => {
    const returnAbstract = opts?.returnAbstract ?? true
    const returnLegal = opts?.returnLegal ?? true
    return cache.getOrLoad(
      scrapeCacheKey(patent, { returnAbstract, returnLegal }),
      () => impl(patent, { returnAbstract, returnLegal }),
      isScrapeResultCacheable,
    )
  }
}
