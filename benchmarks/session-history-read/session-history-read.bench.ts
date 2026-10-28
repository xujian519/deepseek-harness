/** Required performance budgets for reading stored Session history. */

import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  runBuiltBenchmarkWorker,
  type BuiltBenchmarkWorkerRun,
} from '../support/built-worker.ts'
import { PERFORMANCE_BUDGET_HEADROOM } from '../support/calibration.ts'
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

/** Reference-machine medians measured while the corpus copied every stored event into each read. */
const PRE_CHANGE_MS = {
  readEvent: 313.3,
  readSurface: 458.5,
} as const

/** Measured wall-time ratio from the arm64 reference machine to the slower hosted class: 725.7/175 and 1,365.9/310. */
const SLOW_HOSTED_TIME_RATIO = 4.4

/** Reference-machine transient heap growth of one read while every stored event was copied. */
const PRE_CHANGE_TRANSIENT_HEAP_MB = {
  'read-event': 128.6,
  'read-surface': 190.8,
} as const

/**
 * Transient heap growth of one read after the copy was removed, in MB. The probe samples heap in use
 * before V8 collects the read's garbage, so a sample lands on either side of that collection and the
 * hosted spread is wider than a retained measurement. `read-event` keeps its 72 MB reference median
 * but is budgeted from the 91 MB hosted ceiling, which hosted samples spanning 52.9–90.9 MB set;
 * `read-surface` hosted samples span 111–121.8 MB and stay under the 128 MB reference median.
 */
const EXPECTED_TRANSIENT_HEAP_MB = {
  'read-event': 91,
  'read-surface': 128,
} as const

/**
 * Standard two-CPU hosted CI runs come from two CPU classes: `read-event` medians are 447.9 and 419.9 ms on
 * AMD EPYC 9V45 and 725.7 ms on AMD EPYC 7763, and `read-surface` medians are 828.2 and 756.8 ms there and
 * 1,365.9 ms on the 7763. Each expectation is the higher recorded median rounded up, so the shared headroom
 * absorbs the sample spread inside one class; a budget calibrated on the faster class alone fails both
 * endpoints on the slower one.
 */
const EXPECTED_READ_EVENT_CI_MS = 750
const READ_EVENT_BUDGET_MS = Math.ceil(EXPECTED_READ_EVENT_CI_MS * PERFORMANCE_BUDGET_HEADROOM)
const READ_EVENT_TRANSIENT_BUDGET_MB = Math.ceil(EXPECTED_TRANSIENT_HEAP_MB['read-event'] * PERFORMANCE_BUDGET_HEADROOM)
const EXPECTED_READ_SURFACE_CI_MS = 1_400
const READ_SURFACE_BUDGET_MS = Math.ceil(EXPECTED_READ_SURFACE_CI_MS * PERFORMANCE_BUDGET_HEADROOM)
const READ_SURFACE_TRANSIENT_BUDGET_MB = Math.ceil(EXPECTED_TRANSIENT_HEAP_MB['read-surface'] * PERFORMANCE_BUDGET_HEADROOM)
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
    transientHeapBudgetMb: READ_EVENT_TRANSIENT_BUDGET_MB,
  },
  {
    scenario: 'read-surface',
    label: 'the current model surface',
    budgetMs: READ_SURFACE_BUDGET_MS,
    transientHeapBudgetMb: READ_SURFACE_TRANSIENT_BUDGET_MB,
  },
]

function rounded(value: number): number {
  return Math.round(value * 10) / 10
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] as number
}

function expectWithinBudget(value: number, budget: number): void {
  expect(value).toBeLessThanOrEqual(budget)
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

  it('accepts every recorded hosted runner class and rejects the pre-change read cost', () => {
    const readEvent = median([432.7, 455.8, 440.1, 426.3, 444.5])
    const readSurface = median([764, 770.9, 752.7, 773.5, 778.1])
    const slowerReadEvent = median([725.7, 757.5, 682.1, 654.6, 770.4])
    const slowerReadSurface = median([1_419.6, 1_037.1, 1_365.9, 1_431.7, 1_007.5])

    expect(readEvent).toBe(440.1)
    expect(readSurface).toBe(770.9)
    expect(slowerReadEvent).toBe(725.7)
    expect(slowerReadSurface).toBe(1_365.9)
    expect(() => expectWithinBudget(readEvent, 438)).toThrow()
    expectWithinBudget(readEvent, READ_EVENT_BUDGET_MS)
    expectWithinBudget(slowerReadEvent, READ_EVENT_BUDGET_MS)
    expectWithinBudget(readSurface, READ_SURFACE_BUDGET_MS)
    expectWithinBudget(slowerReadSurface, READ_SURFACE_BUDGET_MS)
    expect(READ_EVENT_BUDGET_MS).toBe(938)
    expect(READ_SURFACE_BUDGET_MS).toBe(1_750)
    expect(PRE_CHANGE_MS.readEvent * SLOW_HOSTED_TIME_RATIO).toBeGreaterThan(READ_EVENT_BUDGET_MS)
    expect(PRE_CHANGE_MS.readSurface * SLOW_HOSTED_TIME_RATIO).toBeGreaterThan(READ_SURFACE_BUDGET_MS)
  })

  it('rejects a synthetic material history-read regression', () => {
    expect(() => expectWithinBudget(1_200, READ_EVENT_BUDGET_MS)).toThrow()
    expect(() => expectWithinBudget(2_200, READ_SURFACE_BUDGET_MS)).toThrow()
  })

  it('accepts the recorded hosted transient samples on both endpoints', () => {
    const readEvent = median([52.9, 75.5, 75.2, 75, 74.6])
    const slowerReadEvent = median([84.8, 90.7, 90.7, 84.5, 90.9])
    const readSurface = median([113.2, 113.6, 113.7, 121.8, 113.5])

    expect(slowerReadEvent).toBe(90.7)
    expectWithinBudget(readEvent, READ_EVENT_TRANSIENT_BUDGET_MB)
    expectWithinBudget(slowerReadEvent, READ_EVENT_TRANSIENT_BUDGET_MB)
    expectWithinBudget(readSurface, READ_SURFACE_TRANSIENT_BUDGET_MB)
    expect(READ_EVENT_TRANSIENT_BUDGET_MB).toBe(114)
  })

  it('rejects the pre-change transient allocation on both endpoints', () => {
    for (const endpoint of READ_ENDPOINTS) {
      const budget = endpoint.transientHeapBudgetMb
      expect(EXPECTED_TRANSIENT_HEAP_MB[endpoint.scenario] * PERFORMANCE_BUDGET_HEADROOM).toBeLessThanOrEqual(budget)
      expect(PRE_CHANGE_TRANSIENT_HEAP_MB[endpoint.scenario]).toBeGreaterThan(budget)
      expect(() => expectWithinBudget(PRE_CHANGE_TRANSIENT_HEAP_MB[endpoint.scenario], budget)).toThrow()
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
