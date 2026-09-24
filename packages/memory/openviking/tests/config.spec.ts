
import { describe, expect, it } from 'vitest'

import { Config, assertValidEndpoint } from '../src/config.ts'

describe('openviking Config schema', () => {
  it('fills every group with documented defaults', () => {
    const config = Config({})
    expect(config.repoContext.get()).toEqual({ enabled: true, cacheTtlMs: 60000 })
    expect(config.autoRecall.get()).toEqual({
      enabled: true,
      limit: 6,
      scoreThreshold: 0.15,
      maxContentChars: 500,
      tokenBudget: 2000,
      agentSpaces: true,
      refreshSteps: 10,
      startupMapEveryTurns: 5,
      searchLimit: 20,
      branchLimit: 16,
      branchDeadlineMs: 3000,
      branchCacheTtlMs: 300_000,
    })
    expect(config.autoCommit.get()).toEqual({ enabled: true, turns: 3, intervalMinutes: 10 })
  })

  it('refuses an endpoint the service could not be reached at', () => {
    expect(Config({}).endpoint.get()).toBe('http://localhost:1933')
    expect(() => Config({ endpoint: 'ftp://example.com' })).toThrow()
    expect(() => Config({ endpoint: '127.0.0.1:1933' })).toThrow()
  })

  it('rejects out-of-range recall bounds', () => {
    expect(() => Config({ autoRecall: { limit: 0 } })).toThrow()
    expect(() => Config({ autoRecall: { scoreThreshold: 1.5 } })).toThrow()
    expect(() => Config({ autoRecall: { maxContentChars: 10 } })).toThrow()
    expect(() => Config({ autoRecall: { tokenBudget: 20000 } })).toThrow()
    expect(() => Config({ autoRecall: { searchLimit: 0 } })).toThrow()
    expect(() => Config({ autoRecall: { branchLimit: 101 } })).toThrow()
    expect(() => Config({ autoRecall: { branchDeadlineMs: 0 } })).toThrow()
    expect(() => Config({ autoRecall: { branchCacheTtlMs: 999 } })).toThrow()
  })

  it('rejects out-of-range commit and context bounds', () => {
    expect(() => Config({ autoCommit: { intervalMinutes: 0 } })).toThrow()
    expect(() => Config({ repoContext: { cacheTtlMs: 100 } })).toThrow()
    expect(() => Config({ repoContext: { cacheTtlMs: 99999999 } })).toThrow()
  })

  it('shadows groups with partial configs', () => {
    const config = Config({ autoRecall: { enabled: false } })
    expect(config.autoRecall.get().enabled).toBe(false)
    expect(config.autoRecall.get().limit).toBe(6)
  })
})

describe('assertValidEndpoint', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(() => { assertValidEndpoint('http://127.0.0.1:1934')  }).not.toThrow()
    expect(() => { assertValidEndpoint('https://openviking.example.com/v1/path')  }).not.toThrow()
  })

  it('rejects non-URLs and non-http protocols', () => {
    expect(() => { assertValidEndpoint('')  }).toThrow()
    expect(() => { assertValidEndpoint('127.0.0.1:1934')  }).toThrow()
    expect(() => { assertValidEndpoint('file:///etc/passwd')  }).toThrow()
    expect(() => { assertValidEndpoint('ftp://example.com')  }).toThrow()
  })
})
