/** Required performance budgets for reading stored Session history. */

import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  runBuiltBenchmarkWorker,
  type BuiltBenchmarkWorkerRun,
} from '../support/built-worker.ts'
import { CI_TIME_SCALE, ciTimeBudget, PERFORMANCE_BUDGET_HEADROOM } from '../support/calibration.ts'
import { HISTORY_READ_EVENTS, HISTORY_READ_TEXT_BYTES, HISTORY_READ_TURNS, historyReadText } from './session-history-read.constants.ts'
import type {
  HistoryReadBenchmarkScenario,
  HistoryReadWorkerReport,
} from './session-history-read.worker.ts'

/** Fresh processes per normal-heap endpoint; the median enforces each timing budget. */
const ATTEMPTS = 5
/** A stuck child is reaped well before the outer test and hook deadlines. */
const WORKER_TIMEOUT_MS = 120_000
/** Transient-allocation check, kept independent from normal-heap timing samples. */
const CONSTRAINED_HEAP_MB = 128

/** Expected durations on the reference machine before CI scaling and variance headroom. */
const EXPECTED_MS = {
  readEvent: 175,
  readSurface: 310,
} as const

/** Reference-machine medians measured while the corpus copied every stored event into each read. */
const PRE_CHANGE_MS = {
  readEvent: 313.3,
  readSurface: 458.5,
} as const

/** Reference-machine transient heap growth of one read while every stored event was copied. */
const PRE_CHANGE_TRANSIENT_HEAP_MB = {
  'read-event': 128.6,
  'read-surface': 190.8,
} as const

/** Reference-machine transient heap growth of one read after the copy was removed. */
const EXPECTED_TRANSIENT_HEAP_MB = {
  'read-event': 72,
  'read-surface': 128,
} as const

const READ_EVENT_BUDGET_MS = ciTimeBudget(EXPECTED_MS.readEvent)
const READ_SURFACE_BUDGET_MS = ciTimeBudget(EXPECTED_MS.readSurface)
/** Heap in use immediately after the constrained point read, before collection. */
const CURRENT_PEAK_HEAP_MB = 75.5
/** Heap still holding the parsed log after that read's collection, which one more copy would double. */
const CURRENT_RESIDENT_LOG_MB = 61.5

const WORKER = join(import.meta.dirname, '..', '.dsh-build', 'session-history-read', 'session-history-read.worker.js')

type WorkerRun = BuiltBenchmarkWorkerRun<HistoryReadWorkerReport>

const READ_ENDPOINTS: readonly {
  readonly scenario: Exclude<HistoryReadBenchmarkScenario, 'fixture'>
  readonly label: string
  readonly budgetMs: number
  readonly transientHeapBudgetMb: number
}[] = [
  {
    scenario: 'read-event',
    label: 'one event with a one-event context window',
    budgetMs: READ_EVENT_BUDGET_MS,
    transientHeapBudgetMb: Math.ceil(EXPECTED_TRANSIENT_HEAP_MB['read-event'] * PERFORMANCE_BUDGET_HEADROOM),
  },
  {
    scenario: 'read-surface',
    label: 'the current model surface',
    budgetMs: READ_SURFACE_BUDGET_MS,
    transientHeapBudgetMb: Math.ceil(EXPECTED_TRANSIENT_HEAP_MB['read-surface'] * PERFORMANCE_BUDGET_HEADROOM),
  },
]

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] as number
}

function metric(
  reports: readonly HistoryReadWorkerReport[],
  read: (report: HistoryReadWorkerReport) => number,
): { readonly min: number; readonly median: number; readonly max: number; readonly samples: readonly number[] } {
  const samples = reports.map(read)
  return {
    min: rounded(Math.min(...samples)),
    median: rounded(median(samples)),
    max: rounded(Math.max(...samples)),
    samples: samples.map(rounded),
  }
}

function summarize(reports: readonly HistoryReadWorkerReport[]) {
  return {
    totalMs: metric(reports, report => report.totalMs),
    cpuUserMs: metric(reports, report => report.cpuUserMs),
    cpuSystemMs: metric(reports, report => report.cpuSystemMs),
    transientHeapMb: metric(reports, report => report.afterRead.heapUsedMb - report.beforeGc.heapUsedMb),
    retainedHeapMb: metric(reports, report => report.afterGc.heapUsedMb - report.beforeGc.heapUsedMb),
    peakRssGrowthMb: metric(reports, report => report.peakRssGrowthMb),
    peakRssMb: metric(reports, report => report.afterGc.peakRssMb),
  }
}

function runWorker(
  root: string,
  scenario: HistoryReadBenchmarkScenario,
  heapLimitMb?: number,
): Promise<WorkerRun> {
  return runBuiltBenchmarkWorker({
    worker: WORKER,
    args: [root, scenario],
    timeoutMs: WORKER_TIMEOUT_MS,
    exposeGc: true,
    ...(heapLimitMb === undefined ? {} : { heapLimitMb }),
  })
}

function requireReport(
  run: WorkerRun,
  scenario: HistoryReadBenchmarkScenario,
  heapLimitMb?: number,
): HistoryReadWorkerReport {
  if (run.report !== undefined) return run.report
  const stderrLines = run.stderr.trim().split('\n')
  const fatal = stderrLines.filter(line => /FATAL ERROR|heap limit|out of memory/i.test(line))
  const context = stderrLines.length <= 20
    ? stderrLines
    : [...stderrLines.slice(0, 10), '... stderr middle omitted ...', ...stderrLines.slice(-10)]
  const detail = (fatal.length > 0 ? fatal : context).join('\n')
  const limit = heapLimitMb === undefined ? 'normal heap' : `${String(heapLimitMb)} MB old space`
  throw new Error(
    `${scenario} failed under ${limit}: exit=${String(run.exitCode)}, signal=${String(run.signal)}, `
    + `timedOut=${String(run.timedOut)}\n${detail}`,
  )
}

/** Owns one synthetic stored history and the private sample roots copied from it. */
class HistoryReadBenchmarkSuite {
  private scratch = ''
  private template = ''
  private rootIndex = 0

  async prepare(): Promise<void> {
    this.scratch = await mkdtemp(join(tmpdir(), 'dsh-session-history-read-bench-'))
    this.template = join(this.scratch, 'template')
    await mkdir(this.template, { recursive: true })
    const report = requireReport(await runWorker(this.template, 'fixture'), 'fixture')
    if (report.events !== HISTORY_READ_EVENTS) {
      throw new Error(`synthetic history wrote ${String(report.events)} events, expected ${String(HISTORY_READ_EVENTS)}`)
    }
  }

  async dispose(): Promise<void> {
    await rm(this.scratch, { recursive: true, force: true })
  }

  async run(
    scenario: Exclude<HistoryReadBenchmarkScenario, 'fixture'>,
    heapLimitMb?: number,
  ): Promise<HistoryReadWorkerReport> {
    // A private root per sample keeps the durable log identical and no process-local cache shared.
    const root = join(this.scratch, `${scenario}-${String(this.rootIndex++)}`)
    await cp(this.template, root, { recursive: true })
    return requireReport(await runWorker(root, scenario, heapLimitMb), scenario, heapLimitMb)
  }

  async sample(scenario: Exclude<HistoryReadBenchmarkScenario, 'fixture'>): Promise<HistoryReadWorkerReport[]> {
    const reports: HistoryReadWorkerReport[] = []
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) reports.push(await this.run(scenario))
    return reports
  }
}

describe('Session history-read calibration', () => {
  it('carries the declared user-text size in every turn', () => {
    for (const turn of [1, HISTORY_READ_TURNS / 2, HISTORY_READ_TURNS]) {
      expect(Buffer.byteLength(historyReadText(turn))).toBe(HISTORY_READ_TEXT_BYTES)
    }
  })

  it('rejects the pre-change read cost in CI time on both endpoints', () => {
    expect(READ_EVENT_BUDGET_MS).toBe(438)
    expect(READ_SURFACE_BUDGET_MS).toBe(775)
    for (const expectedMs of Object.values(EXPECTED_MS)) {
      expect(expectedMs * CI_TIME_SCALE).toBeLessThanOrEqual(ciTimeBudget(expectedMs))
    }
    expect(PRE_CHANGE_MS.readEvent * CI_TIME_SCALE).toBeGreaterThan(READ_EVENT_BUDGET_MS)
    expect(PRE_CHANGE_MS.readSurface * CI_TIME_SCALE).toBeGreaterThan(READ_SURFACE_BUDGET_MS)
  })

  it('rejects the pre-change transient allocation on both endpoints', () => {
    for (const endpoint of READ_ENDPOINTS) {
      const budget = endpoint.transientHeapBudgetMb
      expect(EXPECTED_TRANSIENT_HEAP_MB[endpoint.scenario] * PERFORMANCE_BUDGET_HEADROOM).toBeLessThanOrEqual(budget)
      expect(PRE_CHANGE_TRANSIENT_HEAP_MB[endpoint.scenario]).toBeGreaterThan(budget)
    }
  })

  it('leaves less constrained-heap headroom than one more copy of the parsed log', () => {
    const headroomMb = CONSTRAINED_HEAP_MB - CURRENT_PEAK_HEAP_MB

    expect(headroomMb).toBeLessThan(CURRENT_RESIDENT_LOG_MB)
  })
})

describe('reading one event out of a stored Session history', () => {
  const suite = new HistoryReadBenchmarkSuite()

  beforeAll(async () => { await suite.prepare() })
  afterAll(async () => { await suite.dispose() })

  for (const endpoint of READ_ENDPOINTS) {
    describe(endpoint.label, () => {
      it(`returns within ${String(endpoint.budgetMs)} ms`, async () => {
        const result = summarize(await suite.sample(endpoint.scenario))
        console.log(JSON.stringify({
          benchmark: `session-history-read/${endpoint.scenario}`,
          events: HISTORY_READ_EVENTS,
          result,
          budgetsMs: { total: endpoint.budgetMs },
          transientHeapBudgetMb: endpoint.transientHeapBudgetMb,
        }))
        expect(result.totalMs.median).toBeLessThanOrEqual(endpoint.budgetMs)
        expect(result.transientHeapMb.median).toBeLessThanOrEqual(endpoint.transientHeapBudgetMb)
      })

      it(`completes under a ${String(CONSTRAINED_HEAP_MB)} MB old-space limit`, async () => {
        const report = await suite.run(endpoint.scenario, CONSTRAINED_HEAP_MB)
        console.log(JSON.stringify({
          benchmark: `session-history-read/${endpoint.scenario}-constrained`,
          events: HISTORY_READ_EVENTS,
          heapLimitMb: CONSTRAINED_HEAP_MB,
          report,
        }))
        expect(report.events).toBeGreaterThan(0)
      })
    })
  }
})
