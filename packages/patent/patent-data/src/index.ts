/**
 * Service Definition for the patent data seam (ctx.patentData): the nuo search
 * provider factory (LRU-cached over the vendored @deepseek-ai/nuo-patent engine),
 * the patent result cache, the structured metadata mapper, the ego-browser
 * anti-crawl session runner over the injected subprocess service, and the
 * persistence/path helpers ported from Sati.
 * @module @deepseek-ai/dsh-patent-data
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { StageProvider } from '@deepseek-ai/dsh-patent-core'
import { createNuoSearchProvider } from './search-provider.ts'
import { EgoBrowserSession } from './ego-session.ts'
import { SubprocessEgoSpawnRunner } from './subprocess-runner.ts'
import type { CreateNuoSearchProviderOptions, EgoSessionOptions } from './types.ts'

export { createNuoSearchProvider } from './search-provider.ts'
export {
  AsyncResultCache,
  cachedScrapePatent,
  cachedSearchPatents,
  isScrapeResultCacheable,
  isSearchResultCacheable,
  scrapeCacheKey,
  searchCacheKey,
} from './patent-cache.ts'
export { mapPatentData, parseJsonArray } from './mapper.ts'
export { EGO_HEREDOC_MARKER, EgoBrowserSession, normalizePatentNumber } from './ego-session.ts'
export { SubprocessEgoSpawnRunner } from './subprocess-runner.ts'
// Persistence/path helpers live in dsh-patent-core (single home); re-exported
// here so the data seam keeps its historical public surface.
export { JsonFileStore, SAFE_ID_PATTERN, assertSafeId, atomicWriteJson } from '@deepseek-ai/dsh-patent-core'
export {
  CASE_OUTPUTS_REL,
  CASE_ROOT_REL,
  CASE_WORKFLOW_RUNS_REL,
  caseOutputsDir,
  caseWorkflowRunsDir,
} from '@deepseek-ai/dsh-patent-core'
export type {
  CreateNuoSearchProviderOptions,
  EgoAvailability,
  EgoRunOptions,
  EgoScriptResult,
  EgoSessionOptions,
  EgoSpawnResult,
  EgoSpawnRunner,
  EgoSpawnSpec,
  PatentCacheOptions,
  StructuredPatentData,
} from './types.ts'

/**
 * PatentData service: the patent data seam (ctx.patentData). It exposes the nuo
 * search provider factory and the ego-browser session runner over the injected
 * subprocess service.
 */
export class PatentData extends Service {
  static inject = ['subprocess']

  constructor(ctx: Context) {
    super(ctx, 'patentData')
  }

  /**
   * Build a nuo-backed search provider (default: LRU-cached nuo searchPatents).
   * @param options - optional search-function injection.
   * @returns the StageProvider for the workflow atoms' search stage.
   */
  createSearchProvider(options?: CreateNuoSearchProviderOptions): StageProvider {
    return createNuoSearchProvider(options)
  }

  /**
   * Build an ego-browser session runner backed by the injected subprocess service.
   * @param options - session options; runner overrides the subprocess-backed default.
   * @returns the ego-browser session.
   */
  createEgoSession(options?: EgoSessionOptions): EgoBrowserSession {
    return new EgoBrowserSession({
      ...options,
      runner: options?.runner ?? new SubprocessEgoSpawnRunner(this.ctx.subprocess),
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    patentData: PatentData
  }
}

export default PatentData
