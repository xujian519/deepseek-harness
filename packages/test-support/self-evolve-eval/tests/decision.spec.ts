import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DECISION_CRITERION_VERSION, decide, readDecision, recordDecision } from '../src/decision.ts'
import type { EvalResults, TaskOutcome } from '../src/types.ts'

function results(tasks: TaskOutcome[]): EvalResults {
  return { seed: 1, subsetSize: tasks.length, generatedAt: 0, tasks }
}

function outcome(taskId: string, baselinePassed: boolean, evolvedPassed: boolean): TaskOutcome {
  return { taskId, baselinePassed, evolvedPassed }
}

describe('decide', () => {
  it('zero-effect evidence is recorded as rollback (CI crosses zero)', () => {
    const decision = decide(results([outcome('a', true, true), outcome('b', false, false)]), { seed: 1 })
    expect(decision.crossesZero).toBe(true)
    expect(decision.recommended).toBe('rollback')
  })

  it('strictly positive evidence is recorded as continue', () => {
    const decision = decide(results(Array.from({ length: 30 }, (_, index) => outcome(`w${index}`, false, true))), { seed: 1 })
    expect(decision.ci.low).toBeGreaterThan(0)
    expect(decision.recommended).toBe('continue')
  })

  it('harm evidence (self-evolve worse) is recorded as rollback', () => {
    const decision = decide(results(Array.from({ length: 30 }, (_, index) => outcome(`l${index}`, true, false))), { seed: 1 })
    expect(decision.ci.high).toBeLessThan(0)
    expect(decision.recommended).toBe('rollback')
  })

  it('records summary, interval, and decision together (auditable record)', () => {
    const decision = decide(results([outcome('a', false, true)]), { seed: 1 })
    expect(decision.summary.netWin).toBe(1)
    expect(decision.ci.resamples).toBeGreaterThan(0)
    expect(decision.settledAt).toBeGreaterThan(0)
  })

  it('records the applied criterion, thresholds, and test result', () => {
    const decision = decide(results([outcome('a', false, true)]), { seed: 1 })
    expect(decision.criterionVersion).toBe(DECISION_CRITERION_VERSION)
    expect(decision.alpha).toBe(0.05)
    expect(decision.minEffect).toBe(0.05)
    expect(decision.priorReuses).toBe(0)
    expect(decision.mcnemar.discordant).toBe(1)
  })

  it('an effect that is significant but below the pre-registered minimum is rolled back', () => {
    // 1000 tasks with 40 wins: delta = 0.04 while the p-value is ~1e-12.
    const tasks = Array.from({ length: 1000 }, (_, index) => outcome(`w${index}`, false, index < 40))
    const decision = decide(results(tasks), { seed: 1 })
    expect(decision.mcnemar.pValue).toBeLessThan(0.05)
    expect(decision.summary.winRateDelta).toBeLessThan(0.05)
    expect(decision.recommended).toBe('rollback')
  })

  it('an effect above the minimum but not significant is rolled back', () => {
    // 3 wins, 0 losses: delta = 1.0 but p = 2 × 0.5³ = 0.25.
    const tasks = Array.from({ length: 3 }, (_, index) => outcome(`w${index}`, false, true))
    const decision = decide(results(tasks), { seed: 1 })
    expect(decision.summary.winRateDelta).toBeGreaterThanOrEqual(0.05)
    expect(decision.mcnemar.pValue).toBeGreaterThan(0.05)
    expect(decision.recommended).toBe('rollback')
  })

  it('a declared reuse tightens the significance level', () => {
    // 6 wins, 0 losses: p = 2 × 0.5⁶ = 0.03125. Significant at 0.05, not at 0.05/3.
    const tasks = Array.from({ length: 6 }, (_, index) => outcome(`w${index}`, false, true))
    expect(decide(results(tasks), { seed: 1 }).recommended).toBe('continue')
    const reused = decide(results(tasks), { seed: 1, priorReuses: 2 })
    expect(reused.alpha).toBeCloseTo(0.05 / 3, 12)
    expect(reused.recommended).toBe('rollback')
  })

  it('carries the subset digest from the results, and accepts an override', () => {
    const withDigest: EvalResults = { ...results([outcome('a', false, true)]), subsetDigest: 'digest-a' }
    expect(decide(withDigest, { seed: 1 }).subsetDigest).toBe('digest-a')
    expect(decide(withDigest, { seed: 1, subsetDigest: 'digest-b' }).subsetDigest).toBe('digest-b')
  })
})

describe('decision record I/O', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  it('recordDecision → readDecision roundtrip preserves the decision', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    const path = join(dir, 'eval-decision.json')
    const decision = decide(results([outcome('a', false, true)]), { seed: 1 })
    await recordDecision(path, decision)
    expect(await readDecision(path)).toEqual(decision)
  })

  it('readDecision returns null when no decision was recorded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    expect(await readDecision(join(dir, 'missing.json'))).toBeNull()
  })

  it('a malformed record fails loud', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    const path = join(dir, 'bad.json')
    await writeFile(path, JSON.stringify({ recommended: 'continue' }))
    await expect(readDecision(path)).rejects.toThrow(/malformed decision record/)
  })

  it('a non-string recommendation fails loud', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    const path = join(dir, 'bad2.json')
    await writeFile(path, JSON.stringify({ recommended: 5, ci: {} }))
    await expect(readDecision(path)).rejects.toThrow(/malformed decision record/)
  })

  it('a null confidence interval fails loud', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    const path = join(dir, 'bad3.json')
    await writeFile(path, JSON.stringify({ recommended: 'continue', ci: null }))
    await expect(readDecision(path)).rejects.toThrow(/malformed decision record/)
  })

  it('a read failure that is not ENOENT fails loud', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    await expect(readDecision(dir)).rejects.toThrow()
  })

  it('refuses a record written under another criterion version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-decision-'))
    tempDirs.push(dir)
    const path = join(dir, 'stale.json')
    const decision = decide(results([outcome('a', false, true)]), { seed: 1 })
    await writeFile(path, JSON.stringify({ ...decision, criterionVersion: DECISION_CRITERION_VERSION - 1 }))
    await expect(readDecision(path)).rejects.toThrow(/criterion version/)
  })
})
