/**
 * Service Definition for the patent data seam (ctx.patentData): the nuo search
 * provider factory (LRU-cached over the vendored @deepseek-ai/nuo-patent engine),
 * the patent result cache, the structured metadata mapper, the ego-browser
 * anti-crawl session runner over the injected subprocess service, and the
 * persistence/path helpers ported from Sati.
 * @module @deepseek-ai/dsh-patent-data
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { StageProvider } from '@deepseek-ai/dsh-patent-core'
import { createNuoSearchProvider } from './search-provider.ts'
import {
  DEFAULT_EGO_COMMAND_NAME,
  DEFAULT_EGO_MAX_OUTPUT_BYTES,
  DEFAULT_EGO_MAX_TIMEOUT_MS,
  DEFAULT_EGO_PROBE_TIMEOUT_MS,
  DEFAULT_EGO_TIMEOUT_MS,
  EgoBrowserSession,
} from './ego-session.ts'
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
export {
  DEFAULT_EGO_COMMAND_NAME,
  DEFAULT_EGO_MAX_OUTPUT_BYTES,
  DEFAULT_EGO_MAX_TIMEOUT_MS,
  DEFAULT_EGO_PROBE_TIMEOUT_MS,
  DEFAULT_EGO_TIMEOUT_MS,
} from './ego-session.ts'
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
 * Deployment-varying patent-data configuration. The ego-browser command, its
 * probe and run deadlines, and the output cap differ between hosts (a wrapper
 * on the PATH, a slower machine, a larger scrape), so each is a validated
 * field here; every default is the value the seam shipped before it was
 * configurable, and a per-call option still overrides it.
 */
export interface Config {
  /** ego-browser CLI command name (default `ego-browser`). */
  commandName?: string
  /** Connection-probe timeout in milliseconds (default 8000). */
  probeTimeoutMs?: number
  /** Default ego-browser run timeout in milliseconds (default 90000). */
  defaultTimeoutMs?: number
  /** Hard cap applied to a per-run timeout in milliseconds (default 300000). */
  maxTimeoutMs?: number
  /** Soft cap in bytes for the merged run output (default 500000). */
  maxOutputBytes?: number
}

/**
 * The ego-browser defaults one deployment resolved: every field filled, from
 * the Config the schema defaulted or from the seam's own default when the
 * service is constructed without one.
 */
type ResolvedEgoDefaults = Required<Pick<EgoSessionOptions, 'commandName' | 'probeTimeoutMs' | 'defaultTimeoutMs' | 'maxTimeoutMs' | 'maxOutputBytes'>>

/**
 * PatentData service: the patent data seam (ctx.patentData). It exposes the nuo
 * search provider factory and the ego-browser session runner over the injected
 * subprocess service.
 */
export class PatentData extends Service {
  static inject = ['subprocess']

  /** Schemastery configuration for the sessions and runners this service builds. */
  static Config: z<Config> = z.object({
    commandName: z.string().default(DEFAULT_EGO_COMMAND_NAME),
    probeTimeoutMs: z.natural().default(DEFAULT_EGO_PROBE_TIMEOUT_MS),
    defaultTimeoutMs: z.natural().default(DEFAULT_EGO_TIMEOUT_MS),
    maxTimeoutMs: z.natural().default(DEFAULT_EGO_MAX_TIMEOUT_MS),
    maxOutputBytes: z.natural().default(DEFAULT_EGO_MAX_OUTPUT_BYTES),
  })

  private readonly egoDefaults: ResolvedEgoDefaults

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'patentData')
    this.egoDefaults = resolveEgoDefaults(config)
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
   * @param options - session options; each one overrides the same-named Config field, and a runner overrides the subprocess-backed default.
   * @returns the ego-browser session.
   */
  createEgoSession(options?: EgoSessionOptions): EgoBrowserSession {
    return new EgoBrowserSession({
      ...this.egoDefaults,
      ...options,
      runner: options?.runner ?? new SubprocessEgoSpawnRunner(this.ctx.subprocess, {
        maxOutputBytes: this.egoDefaults.maxOutputBytes,
      }),
    })
  }
}

/**
 * Resolve the ego-browser defaults: the validated Config fields, each falling
 * back to the value the seam shipped before it was configurable.
 * @param config - the service's validated configuration.
 * @returns the ego-browser defaults the service builds every session over.
 */
function resolveEgoDefaults(config: Config): ResolvedEgoDefaults {
  return {
    commandName: config.commandName ?? DEFAULT_EGO_COMMAND_NAME,
    probeTimeoutMs: config.probeTimeoutMs ?? DEFAULT_EGO_PROBE_TIMEOUT_MS,
    defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_EGO_TIMEOUT_MS,
    maxTimeoutMs: config.maxTimeoutMs ?? DEFAULT_EGO_MAX_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_EGO_MAX_OUTPUT_BYTES,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    patentData: PatentData
  }
}

export default PatentData
