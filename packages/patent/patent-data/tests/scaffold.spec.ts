import { describe, expect, it } from 'vitest'
import * as Pkg from '@deepseek-ai/dsh-patent-data'

describe('@deepseek-ai/dsh-patent-data surface', () => {
  it('default-exports its service class with the subprocess injection', () => {
    expect(typeof Pkg.default).toBe('function')
    expect((Pkg.default as unknown as { inject: string[] }).inject).toEqual(['subprocess'])
  })

  it('exports the data-layer API surface for consumers', () => {
    expect(typeof Pkg.createNuoSearchProvider).toBe('function')
    expect(typeof Pkg.AsyncResultCache).toBe('function')
    expect(typeof Pkg.cachedSearchPatents).toBe('function')
    expect(typeof Pkg.cachedScrapePatent).toBe('function')
    expect(typeof Pkg.isSearchResultCacheable).toBe('function')
    expect(typeof Pkg.isScrapeResultCacheable).toBe('function')
    expect(typeof Pkg.searchCacheKey).toBe('function')
    expect(typeof Pkg.scrapeCacheKey).toBe('function')
    expect(typeof Pkg.mapPatentData).toBe('function')
    expect(typeof Pkg.parseJsonArray).toBe('function')
    expect(typeof Pkg.EgoBrowserSession).toBe('function')
    expect(typeof Pkg.SubprocessEgoSpawnRunner).toBe('function')
    expect(typeof Pkg.normalizePatentNumber).toBe('function')
    expect(typeof Pkg.JsonFileStore).toBe('function')
    expect(typeof Pkg.assertSafeId).toBe('function')
    expect(typeof Pkg.atomicWriteJson).toBe('function')
    expect(Pkg.SAFE_ID_PATTERN).toBeInstanceOf(RegExp)
    expect(Pkg.EGO_HEREDOC_MARKER).toBe('EGO_SCRIPT_EOF')
    expect(Pkg.CASE_ROOT_REL).toBe('data/cases')
    expect(Pkg.CASE_OUTPUTS_REL).toBe('outputs')
    expect(Pkg.CASE_WORKFLOW_RUNS_REL).toBe('workflow-runs')
    expect(typeof Pkg.caseOutputsDir).toBe('function')
    expect(typeof Pkg.caseWorkflowRunsDir).toBe('function')
  })
})
