/** Isolated worker for the Session history-read performance gate. */

import { performance } from 'node:perf_hooks'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import { assertBuiltBenchmarkRuntime } from '../support/built-worker.ts'
import {
  collectGarbage,
  memorySnapshot,
  type BenchmarkMemorySnapshot,
} from '../support/process-memory.ts'
import {
  HISTORY_READ_APPEND_BATCH,
  HISTORY_READ_CWD,
  HISTORY_READ_EVENTS,
  HISTORY_READ_EVENTS_PER_TURN,
  HISTORY_READ_SESSION_ID,
  HISTORY_READ_TURNS,
  historyReadText,
} from './session-history-read.constants.ts'

/** Worker scenario selected by the parent benchmark. */
export type HistoryReadBenchmarkScenario = 'fixture' | 'read-event' | 'read-surface'

/** Timings and memory emitted by one isolated scenario. */
export interface HistoryReadWorkerReport {
  readonly scenario: HistoryReadBenchmarkScenario
  readonly events: number
  readonly totalMs: number
  readonly cpuUserMs: number
  readonly cpuSystemMs: number
  readonly beforeGc: BenchmarkMemorySnapshot
  /** Observation taken immediately after the read, before garbage collection, so a transient whole-log copy stays visible. */
  readonly afterRead: BenchmarkMemorySnapshot
  readonly afterGc: BenchmarkMemorySnapshot
  /** Growth of the operating-system peak RSS across the read. */
  readonly peakRssGrowthMb: number
}

async function mountHost(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
  await ctx.plugin(SqliteSessionQueryEngine, { path: `${root}/session-query.sqlite` })
  return ctx
}

const historyHeader = (): SessionHeader => ({
  version: SESSION_FORMAT_VERSION,
  id: SessionId(HISTORY_READ_SESSION_ID),
  createdAt: 1,
  isSeeded: false,
  cwd: HISTORY_READ_CWD,
})

/** Write the synthetic history through the production durable write path. */
async function writeFixture(root: string): Promise<void> {
  const ctx = await mountHost(root)
  try {
    const handle = await ctx.sessionPersistence.create(historyHeader())
    const batch: SessionEvent[] = []
    for (let turn = 1; turn <= HISTORY_READ_TURNS; turn++) {
      const start = SessionSeq((turn - 1) * HISTORY_READ_EVENTS_PER_TURN)
      batch.push({ type: 'turn/start', seq: start, time: turn * 10, data: { turn } })
      batch.push({
        type: 'user/message',
        seq: SessionSeq(start + 1),
        time: turn * 10 + 1,
        data: createUserMessage({
          content: [{ type: 'text', text: historyReadText(turn) }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      })
      if (batch.length >= HISTORY_READ_APPEND_BATCH) {
        await handle.append(batch)
        batch.length = 0
      }
    }
    if (batch.length > 0) await handle.append(batch)
    await handle.flush()
    await handle.close()
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Owns one mounted Host over the synthetic log and the read it measures. */
class HistoryReadBenchmarkHost {
  private retained: unknown

  private constructor(private readonly ctx: Context) {}

  static async create(root: string): Promise<HistoryReadBenchmarkHost> {
    return new HistoryReadBenchmarkHost(await mountHost(root))
  }

  async measure(scenario: HistoryReadBenchmarkScenario): Promise<HistoryReadWorkerReport> {
    const beforeGc = await collectGarbage()
    const rssBefore = beforeGc.peakRssMb
    const started = performance.now()
    const cpuStarted = process.cpuUsage()
    const events = await this.runRead(scenario)
    const totalMs = performance.now() - started
    const cpu = process.cpuUsage(cpuStarted)
    if (this.retained === undefined) throw new Error(`${scenario} did not retain its measured result`)
    const afterRead = memorySnapshot()
    const afterGc = await collectGarbage()
    return {
      scenario,
      events,
      totalMs,
      cpuUserMs: cpu.user / 1_000,
      cpuSystemMs: cpu.system / 1_000,
      beforeGc,
      afterRead,
      afterGc,
      peakRssGrowthMb: Math.round((afterGc.peakRssMb - rssBefore) * 10) / 10,
    }
  }

  async dispose(): Promise<void> {
    this.retained = undefined
    await this.ctx.fiber.dispose()
  }

  private async runRead(scenario: HistoryReadBenchmarkScenario): Promise<number> {
    const sessionId = SessionId(HISTORY_READ_SESSION_ID)
    if (scenario === 'fixture') {
      // Setup scenario: prove the stored log is readable and balanced without timing a user read.
      const snapshot = await this.ctx.sessionQuery.readSession(sessionId)
      this.retained = snapshot
      return snapshot.events.length
    }
    if (scenario === 'read-event') {
      const window = await this.ctx.sessionQuery.readEvent({
        sessionId,
        seq: SessionSeq(HISTORY_READ_EVENTS - 1),
        before: 1,
        after: 1,
      })
      this.retained = window
      return window.events.length
    }
    const surface = await this.ctx.sessionQuery.readSurface(sessionId)
    this.retained = surface
    return surface.events.length
  }
}

assertBuiltBenchmarkRuntime(import.meta.url, {
  '@deepseek-ai/dsh-session-query-sqlite': import.meta.resolve('@deepseek-ai/dsh-session-query-sqlite'),
  '@deepseek-ai/dsh-session-persistence-jsonl': import.meta.resolve('@deepseek-ai/dsh-session-persistence-jsonl'),
})

const [root, scenarioValue] = process.argv.slice(2)
const scenarios: readonly HistoryReadBenchmarkScenario[] = ['fixture', 'read-event', 'read-surface']
if (root === undefined || !scenarios.includes(scenarioValue as HistoryReadBenchmarkScenario)) {
  throw new Error(`usage: session-history-read.worker.js <root> <${scenarios.join('|')}>`)
}
const scenario = scenarioValue as HistoryReadBenchmarkScenario
if (scenario === 'fixture') {
  await writeFixture(root)
  process.stdout.write(`${JSON.stringify({ scenario, events: HISTORY_READ_EVENTS })}\n`)
} else {
  const host = await HistoryReadBenchmarkHost.create(root)
  try {
    const report = await host.measure(scenario)
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } finally {
    await host.dispose()
  }
}
