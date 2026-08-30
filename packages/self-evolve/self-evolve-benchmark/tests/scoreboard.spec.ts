import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { BenchmarkId } from '../src/brand.ts'
import {
  BENCHMARK_ROOT,
  SCOREBOARD_FILENAME,
  aggregateRuns,
  appendScoreboard,
  mean,
  readScoreboard,
  roundCost,
  roundScore,
  scoreboardPath,
} from '../src/scoreboard.ts'
import type { ScoreboardEntry } from '../src/types.ts'

describe('scoreboard path and rounding helpers', () => {
  it('builds the scoreboard path from the data root and benchmark id', () => {
    expect(scoreboardPath('/root', BenchmarkId('b1'))).toBe(join('/root', BENCHMARK_ROOT, 'b1', SCOREBOARD_FILENAME))
  })

  it('rounds scores to two decimals and costs to six', () => {
    expect(roundScore(0.1234)).toBe(0.12)
    expect(roundScore(2.999)).toBe(3)
    expect(roundCost(0.12345678)).toBe(0.123457)
    expect(roundCost(1)).toBe(1)
  })

  it('averages numbers and yields NaN for an empty list', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([0.5, 0.25])).toBe(0.375)
    expect(mean([])).toBeNaN()
  })

  it('aggregates run means with the rounding rules', () => {
    expect(
      aggregateRuns([
        { score: 60, cost: 0.5, durationMs: 100 },
        { score: 70, cost: 0.3, durationMs: 200 },
      ]),
    ).toEqual({ score: 65, cost: 0.4, durationMs: 150 })
  })

  it('omits cost and duration when no run reported them', () => {
    expect(aggregateRuns([{ score: 60 }, { score: 70 }])).toEqual({ score: 65 })
  })
})

describe('scoreboard persistence', () => {
  let dir: string
  let benchmarkId: BenchmarkId

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-scoreboard-'))
    benchmarkId = BenchmarkId('summarizer')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a missing scoreboard as an empty list', async () => {
    await expect(readScoreboard(dir, benchmarkId)).resolves.toEqual([])
  })

  it('reads an empty scoreboard file as an empty list', async () => {
    await mkdir(join(dir, BENCHMARK_ROOT, benchmarkId), { recursive: true })
    await writeFile(scoreboardPath(dir, benchmarkId), '', 'utf8')
    await expect(readScoreboard(dir, benchmarkId)).resolves.toEqual([])
  })

  it('fails loud when the scoreboard cannot be read for a non-missing reason', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, BENCHMARK_ROOT), 'not a directory', 'utf8')
    await expect(readScoreboard(dir, benchmarkId)).rejects.toThrow()
  })

  it('fails loud on a malformed or non-list scoreboard instead of silently resetting', async () => {
    await mkdir(join(dir, BENCHMARK_ROOT, benchmarkId), { recursive: true })
    await writeFile(scoreboardPath(dir, benchmarkId), 'not: a list', 'utf8')
    await expect(readScoreboard(dir, benchmarkId)).rejects.toThrow(/expected a YAML list/)

    await writeFile(scoreboardPath(dir, benchmarkId), '[broken', 'utf8')
    await expect(readScoreboard(dir, benchmarkId)).rejects.toThrow()
  })

  it('appends entries preserving history', async () => {
    await mkdir(join(dir, BENCHMARK_ROOT, benchmarkId), { recursive: true })
    const first: ScoreboardEntry = { version: 0, score: 80, cases: [] }
    const second: ScoreboardEntry = { version: 1, score: 90, cases: [] }
    await appendScoreboard(dir, benchmarkId, first)
    await appendScoreboard(dir, benchmarkId, second)

    const raw = await readFile(scoreboardPath(dir, benchmarkId), 'utf8')
    expect(parseYaml(raw)).toEqual([first, second])
    await expect(readScoreboard(dir, benchmarkId)).resolves.toEqual([first, second])
  })

  it('creates the scoreboard file in an empty existing benchmark directory', async () => {
    await mkdir(join(dir, BENCHMARK_ROOT, benchmarkId), { recursive: true })
    await appendScoreboard(dir, benchmarkId, { version: 3, score: 100, cases: [] })
    await expect(readScoreboard(dir, benchmarkId)).resolves.toEqual([{ version: 3, score: 100, cases: [] }])
  })
})
