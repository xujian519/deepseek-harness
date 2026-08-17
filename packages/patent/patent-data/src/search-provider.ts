/**
 * nuo search provider: adapts the nuo `searchPatents` function (default
 * LRU-cached) into a `StageProvider` for the workflow atoms' search stage.
 * @module @deepseek-ai/dsh-patent-data/search-provider
 */

import { searchPatents as searchPatentsImpl } from '@deepseek-ai/nuo-patent'
import type { StageProvider } from '@deepseek-ai/dsh-patent-core'
import type { CreateNuoSearchProviderOptions } from './types.ts'
import { cachedSearchPatents } from './patent-cache.ts'

/**
 * Build a nuo-backed search provider. `options.search` injects the underlying
 * search function (default: the LRU-cached nuo `searchPatents`); the returned
 * `search` maps source hits to the { title, snippet, url } stage vocabulary.
 * @param options - optional search-function injection.
 * @returns the StageProvider whose search drives the workflow search stage.
 */
export function createNuoSearchProvider(options?: CreateNuoSearchProviderOptions): StageProvider {
  const search = options?.search ? options.search : cachedSearchPatents(searchPatentsImpl)
  return {
    search: async (query, opts) => {
      const result = await search(query, { limit: opts?.maxResults ?? 5 })
      return result.hits.map(h => ({
        title: h.title || h.patent,
        snippet: h.abstract,
        url: h.url,
      }))
    },
  }
}
