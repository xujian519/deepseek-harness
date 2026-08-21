import { describe, expect, it } from 'vitest'
import { bootstrapCi, summarize, validateResults, wilsonCi } from '../src/score.ts'
import type { EvalResults, TaskOutcome } from '../src/types.ts'

function results(tasks: TaskOutcome[]): EvalResults {
  return { seed: 20260821, subsetSize: tasks.length, generatedAt: 0, tasks }
}

function outcome(taskId: string, baselinePassed: boolean, evolvedPassed: boolean): TaskOutcome {
  return { taskId, baselinePassed, evolvedPassed }
}

/** `wins` tasks flipped from baseline-fail to evolve-pass, `losses` the reverse, `ties` unchanged. */
function campaign(wins: number, losses: number, ties: number): EvalResults {
  const tasks: TaskOutcome[] = []
  for (let index = 0; index < wins; index += 1) tasks.push(outcome(`win-${index}`, false, true))
  for (let index = 0; index < losses; index += 1) tasks.push(outcome(`loss-${index}`, true, false))
  for (let index = 0; index < ties; index += 1) tasks.push(outcome(`tie-${index}`, true, true))
  return results(tasks)
}

describe('summarize', () => {
  it('computes wins, losses, netWin, and the paired rate delta', () => {
    const summary = summarize(campaign(3, 1, 6))
    expect(summary.n).toBe(10)
    expect(summary.wins).toBe(3)
    expect(summary.losses).toBe(1)
    expect(summary.netWin).toBe(2)
    expect(summary.baselineRate).toBe(0.7)
    expect(summary.evolvedRate).toBe(0.9)
    expect(summary.winRateDelta).toBeCloseTo(0.2)
  })

  it('zero tasks → zero summary', () => {
    const summary = summarize(results([]))
    expect(summary).toMatchObject({ n: 0, netWin: 0, winRateDelta: 0 })
  })
})

describe('bootstrapCi', () => {
  it('full positive flip → degenerate interval at 1 (ciLow strictly positive)', () => {
    const ci = bootstrapCi(campaign(40, 0, 0), { seed: 1 })
    expect(ci.low).toBeCloseTo(1)
    expect(ci.high).toBeCloseTo(1)
  })

  it('zero-effect campaign → interval at 0, crossing zero', () => {
    const ci = bootstrapCi(campaign(0, 0, 10), { seed: 1 })
    expect(ci.low).toBeCloseTo(0)
    expect(ci.high).toBeCloseTo(0)
  })

  it('is reproducible for the same seed and sensitive to the data', () => {
    const data = campaign(3, 0, 7)
    const first = bootstrapCi(data, { seed: 99 })
    const second = bootstrapCi(data, { seed: 99 })
    expect(first).toEqual(second)
    expect(first.low < first.high).toBe(true)
    expect(first).not.toEqual(bootstrapCi(campaign(5, 0, 5), { seed: 99 }))
  })

  it('a weak mixed campaign yields an interval wide enough to cross zero', () => {
    const ci = bootstrapCi(campaign(3, 0, 27), { seed: 7 })
    expect(ci.low).toBeLessThanOrEqual(0)
    expect(ci.high).toBeGreaterThanOrEqual(ci.low)
  })
})

describe('wilsonCi', () => {
  it('zero successes → low bound 0', () => {
    const ci = wilsonCi(0, 20)
    expect(ci.low).toBe(0)
    expect(ci.high).toBeCloseTo(0.161, 2)
  })

  it('all successes → high bound 1', () => {
    const ci = wilsonCi(20, 20)
    expect(ci.high).toBe(1)
    expect(ci.low).toBeCloseTo(0.839, 2)
  })

  it('rejects a non-positive n', () => {
    expect(() => wilsonCi(0, 0)).toThrow(/positive n/)
  })
})

describe('validateResults', () => {
  it('accepts a well-formed report and normalizes optional fields', () => {
    const raw = { seed: 1, subsetSize: 2, generatedAt: 2, tasks: [{ taskId: 'a', baselinePassed: true, evolvedPassed: false, evolvedError: 'boom' }] }
    const parsed = validateResults(raw)
    expect(parsed.tasks[0]).toMatchObject({ taskId: 'a', baselinePassed: true, evolvedPassed: false, evolvedError: 'boom' })
  })

  it('rejects malformed task entries with a precise message', () => {
    expect(() => validateResults({ tasks: [{ taskId: 'a' }] })).toThrow(/baselinePassed and evolvedPassed/)
    expect(() => validateResults({ tasks: 'nope' })).toThrow(/must be an array/)
  })
})
