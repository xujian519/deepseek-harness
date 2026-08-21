import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { decide, readDecision, recordDecision } from '../src/decision.ts'
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
})
