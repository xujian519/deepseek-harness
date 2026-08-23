/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'

import { openvikingPreStep, openvikingSessionStart } from '../src/index.ts'
import type { Config } from '../src/config.ts'
import { MemoryRecall } from '../src/memory-recall.ts'
import { RepoContext } from '../src/repo-context.ts'
import { StartupMap } from '../src/startup-map.ts'

const ENTER = { kind: 'enter' as const, messages: [{ id: 'm1' } as never] }
const REJECT = { kind: 'reject' as const, reason: { kind: 'user' as const } }

function fakes(overrides: {
  recall?: Partial<MemoryRecall>
  repo?: Partial<RepoContext>
  map?: Partial<StartupMap>
  config?: Partial<Config>
} = {}) {
  const recall = {
    prepareStep: vi.fn(async () => {}),
    userTurnCount: vi.fn(() => 0),
    renderContext: vi.fn(() => ''),
    ...overrides.recall,
  } as never as MemoryRecall
  const repoContext = { refresh: vi.fn(async () => {}), prompt: vi.fn(() => ''), ...overrides.repo } as never as RepoContext
  const startupMap = {
    refresh: vi.fn(async () => {}),
    prompt: vi.fn(() => ''),
    lastRefreshTurn: 0,
    ...overrides.map,
  } as never as StartupMap
  const config = (() => ({
    autoRecall: { startupMapEveryTurns: 5 } as Config['autoRecall'],
    repoContext: { enabled: true, cacheTtlMs: 60000 },
    autoCommit: { enabled: true, turns: 3, intervalMinutes: 10 },
    ...overrides.config,
  })) as () => Config
  return { recall, repoContext, startupMap, config }
}

const payload = (signal: AbortSignal = new AbortController().signal) => ({
  agent: { id: 'a1' } as Agent, step: 1, messages: [] as never[], signal,
})

describe('openvikingPreStep', () => {
  it('returns a rejected decision untouched', async () => {
    const f = fakes()
    const next = vi.fn(async () => REJECT)
    const decision = await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(), next)
    expect(decision).toBe(REJECT)
    expect(f.recall.prepareStep).not.toHaveBeenCalled()
  })

  it('returns an aborted decision untouched', async () => {
    const f = fakes()
    const controller = new AbortController()
    controller.abort()
    const decision = await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(controller.signal), async () => ENTER)
    expect(decision).toBe(ENTER)
    expect(f.recall.prepareStep).not.toHaveBeenCalled()
  })

  it('stages recall and repository context on an accepted step', async () => {
    const f = fakes()
    const decision = await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(), async () => ENTER)
    expect(decision).toBe(ENTER)
    expect(f.recall.prepareStep).toHaveBeenCalledTimes(1)
    expect(f.repoContext.refresh).toHaveBeenCalledTimes(1)
    expect(f.startupMap.refresh).not.toHaveBeenCalled()
  })

  it('refreshes the startup map on the cadence boundary', async () => {
    const f = fakes({
      recall: { userTurnCount: vi.fn(() => 5) },
      config: { autoRecall: { startupMapEveryTurns: 5 } as never },
    })
    await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(), async () => ENTER)
    expect(f.startupMap.refresh).toHaveBeenCalledTimes(1)
    expect(f.startupMap.lastRefreshTurn).toBe(5)
  })

  it('does not refresh the startup map twice for the same turn', async () => {
    const f = fakes({
      recall: { userTurnCount: vi.fn(() => 5) },
      map: { lastRefreshTurn: 5 },
      config: { autoRecall: { startupMapEveryTurns: 5 } as never },
    })
    await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(), async () => ENTER)
    expect(f.startupMap.refresh).not.toHaveBeenCalled()
  })

  it('returns the decision when the signal aborts mid-stage', async () => {
    const controller = new AbortController()
    const f = fakes({
      recall: {
        prepareStep: vi.fn(async () => {
          controller.abort()
        }),
      },
    })
    const decision = await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(controller.signal), async () => ENTER)
    expect(decision).toBe(ENTER)
  })

  it('swallows a failing cadence refresh', async () => {
    const f = fakes({
      recall: { userTurnCount: vi.fn(() => 5) },
      map: { refresh: vi.fn(async () => { throw new Error('stats down') }) },
      config: { autoRecall: { startupMapEveryTurns: 5 } as never },
    })
    const decision = await openvikingPreStep(f.recall, f.repoContext, f.startupMap, f.config, payload(), async () => ENTER)
    expect(decision).toBe(ENTER)
  })
})

describe('openvikingSessionStart', () => {
  it('swallows refresh failures from both providers', async () => {
    const repo = { refresh: vi.fn(async () => { throw new Error('repo down') }) } as never
    const map = { refresh: vi.fn(async () => { throw new Error('map down') }) } as never
    openvikingSessionStart(repo, map)
    await new Promise(resolve => setTimeout(resolve, 20))
  })
})
