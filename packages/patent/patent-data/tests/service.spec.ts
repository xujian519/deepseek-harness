// Real-service test: mounts the patent-data plugin on a real Context (over the
// real subprocess provider) and drives the search provider/cache with an
// injected search function; only the external search seam is mocked.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PatentData, {
  cachedSearchPatents,
  DEFAULT_EGO_COMMAND_NAME,
  DEFAULT_EGO_MAX_OUTPUT_BYTES,
  DEFAULT_EGO_MAX_TIMEOUT_MS,
  DEFAULT_EGO_PROBE_TIMEOUT_MS,
  DEFAULT_EGO_TIMEOUT_MS,
  EgoBrowserSession,
} from '@deepseek-ai/dsh-patent-data'
import type { EgoSpawnRunner, EgoSpawnSpec } from '@deepseek-ai/dsh-patent-data'
import type { PatentSearchResult } from '@deepseek-ai/nuo-patent'

/** A capture-only spawn runner: records each spec and answers with a fixed result. */
function recordingRunner(specs: EgoSpawnSpec[]): EgoSpawnRunner {
  return {
    spawn: async (spec) => {
      specs.push(spec)
      // The probe marker plus padding, so one runner serves both the probe and a
      // run whose merged output exceeds a small configured cap.
      return { exitCode: 0, stdout: `EGO_DOCTOR_OK\n${'y'.repeat(64)}`, stderr: '', timedOut: false, durationMs: 1 }
    },
  }
}

function makeSearchResult(): PatentSearchResult {
  return {
    query: 'thermal',
    total: 1,
    hits: [
      {
        patent: 'US11452699B2',
        title: 'Thermal management system',
        assignee: 'Apple Inc.',
        publication_date: '2022-09-27',
        priority_date: '2019-12-31',
        abstract: 'A thermal management system.',
        url: 'https://patents.google.com/patent/US11452699B2',
      },
    ],
    warnings: [],
  }
}

describe('PatentData service', () => {
  it('serves a search provider that caches repeated queries', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData)
    try {
      expect(ctx.patentData).toBeInstanceOf(PatentData)

      const underlying = vi.fn(async () => makeSearchResult())
      const provider = ctx.patentData.createSearchProvider({ search: cachedSearchPatents(underlying) })
      const first = await provider.search!('thermal')
      const second = await provider.search!('thermal')

      expect(underlying).toHaveBeenCalledTimes(1)
      expect(first).toEqual(second)
      expect(first[0]).toEqual({
        title: 'Thermal management system',
        snippet: 'A thermal management system.',
        url: 'https://patents.google.com/patent/US11452699B2',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('builds an ego-browser session over the injected subprocess service', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData)
    try {
      const session = ctx.patentData.createEgoSession({ platform: 'darwin' })
      expect(session).toBeInstanceOf(EgoBrowserSession)
      expect(session.taskSpaceName('patent-download', 'abc')).toBe('sati-patent-download-abc')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes ctx.patentData when its fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const fiber = ctx.plugin(PatentData)
    await fiber
    expect(ctx.patentData).toBeInstanceOf(PatentData)
    await fiber.dispose()
    expect(ctx.get('patentData')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('defaults every Config field to the shipped seam default', () => {
    expect(PatentData.Config({})).toEqual({
      commandName: DEFAULT_EGO_COMMAND_NAME,
      probeTimeoutMs: DEFAULT_EGO_PROBE_TIMEOUT_MS,
      defaultTimeoutMs: DEFAULT_EGO_TIMEOUT_MS,
      maxTimeoutMs: DEFAULT_EGO_MAX_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_EGO_MAX_OUTPUT_BYTES,
      nuoRequestChannel: 'auto',
    })
  })

  it('builds sessions over the configured command, deadlines, and output cap', async () => {
    const specs: EgoSpawnSpec[] = []
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData, {
      commandName: 'ego-lite',
      probeTimeoutMs: 1_234,
      defaultTimeoutMs: 4_321,
      maxTimeoutMs: 5_000,
      maxOutputBytes: 8,
    })
    try {
      const session = ctx.patentData.createEgoSession({ runner: recordingRunner(specs), homeDir: '/tmp' })
      expect(await session.runConnectionProbe()).toBe(true)
      const run = await session.runScript('cliLog("x")', { cwd: '/tmp' })
      // A per-run timeout above the configured cap is clamped to it.
      await session.runScript('cliLog("x")', { cwd: '/tmp', timeoutMs: 999_999 })

      expect(specs.map(spec => spec.argv[0])).toEqual(['ego-lite', 'ego-lite', 'ego-lite'])
      expect(specs.map(spec => spec.timeoutMs)).toEqual([1_234, 4_321, 5_000])
      expect(run.output).toContain('[output truncated]')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('lets a per-call option override the configured default', async () => {
    const specs: EgoSpawnSpec[] = []
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(PatentData, { commandName: 'ego-lite' })
    try {
      const session = ctx.patentData.createEgoSession({ runner: recordingRunner(specs), commandName: 'ego-per-call', homeDir: '/tmp' })
      expect(await session.runConnectionProbe()).toBe(true)
      expect(specs[0]?.argv[0]).toBe('ego-per-call')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('falls back to the seam defaults when the service is constructed without a Config', async () => {
    const specs: EgoSpawnSpec[] = []
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    try {
      const session = new PatentData(ctx).createEgoSession({ runner: recordingRunner(specs), homeDir: '/tmp' })
      expect(await session.runConnectionProbe()).toBe(true)
      await session.runScript('cliLog("x")', { cwd: '/tmp' })
      expect(specs.map(spec => spec.argv[0])).toEqual([DEFAULT_EGO_COMMAND_NAME, DEFAULT_EGO_COMMAND_NAME])
      expect(specs.map(spec => spec.timeoutMs)).toEqual([DEFAULT_EGO_PROBE_TIMEOUT_MS, DEFAULT_EGO_TIMEOUT_MS])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
