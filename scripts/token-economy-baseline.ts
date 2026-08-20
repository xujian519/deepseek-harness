/**
 * Token-economy baseline: read one or more session logs and report the
 * provider-reported cache hit rate per turn and in total, from the usage each
 * model request reports. The numbers are the Phase-1 baseline for
 * prompt-prefix cache reuse (see
 * `.agents/notes/proposed/architecture/2026-08-20-prompt-prefix-cache-reuse.md`).
 *
 * Input is a plaintext JSONL session artifact. Zstandard-compressed logs
 * (`.jsonl.zstd`) are rejected with a clear error; decompress first or
 * re-run the session with `compression: none`.
 *
 * Usage: `tsx scripts/token-economy-baseline.ts <log>... [--json <out.json>]`
 *
 * @module token-economy-baseline
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { scanLog } from '../packages/session/session-persistence-jsonl/src/format.ts'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'

/** One step's usage sample: the last usage a (turn, step) reports wins. */
export interface StepUsageSample {
  turn: number
  step: number
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

/** One turn's cache economy. */
export interface TurnUsageBaseline {
  turn: number
  steps: StepUsageSample[]
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** cacheRead / (cacheRead + uncached) over the turn's requests. */
  hitRate: number
}

/** The whole-log cache economy. */
export interface UsageBaseline {
  turns: TurnUsageBaseline[]
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  /** cacheRead / (cacheRead + uncached) over all requests. */
  hitRate: number
}

/** The usage a chunk or finalized message reports for its step, if any. */
function usageOf(event: SessionEvent): { turn: number; step: number; usage: TokenUsage } | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/**
 * Fold a session's events into per-turn and total cache-economy numbers.
 * Each (turn, step) contributes its last reported usage (an `assistant/message`
 * sample replaces the earlier usage chunk for the same step), matching
 * token-meter's replacement rule.
 * @param events - the decoded session events in log order.
 * @returns per-turn and whole-log buckets plus hit rates.
 */
export function analyzeUsage(events: readonly SessionEvent[]): UsageBaseline {
  const lastByStep = new Map<string, { turn: number; step: number; usage: TokenUsage }>()
  for (const event of events) {
    const sample = usageOf(event)
    if (sample === undefined) continue
    lastByStep.set(`${sample.turn}:${sample.step}`, sample)
  }

  const byTurn = new Map<number, StepUsageSample[]>()
  for (const { turn, step, usage } of lastByStep.values()) {
    const list = byTurn.get(turn) ?? []
    list.push({
      turn,
      step,
      uncachedInputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      outputTokens: usage.outputTokens,
    })
    byTurn.set(turn, list)
  }

  const turns: TurnUsageBaseline[] = []
  for (const [turn, steps] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = steps.sort((a, b) => a.step - b.step)
    const uncached = sum(ordered, s => s.uncachedInputTokens)
    const cached = sum(ordered, s => s.cacheReadTokens)
    const written = sum(ordered, s => s.cacheWriteTokens)
    turns.push({
      turn,
      steps: ordered,
      uncachedInputTokens: uncached,
      cacheReadTokens: cached,
      cacheWriteTokens: written,
      hitRate: hitRateOf(cached, uncached),
    })
  }

  const uncachedInputTokens = sum(turns, t => t.uncachedInputTokens)
  const cacheReadTokens = sum(turns, t => t.cacheReadTokens)
  const cacheWriteTokens = sum(turns, t => t.cacheWriteTokens)
  const outputTokens = sum(turns, t => sum(t.steps, s => s.outputTokens))
  return {
    turns,
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    hitRate: hitRateOf(cacheReadTokens, uncachedInputTokens),
  }
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0)
}

/** Guarded division: no requests → no hit rate, not NaN. */
function hitRateOf(cached: number, uncached: number): number {
  const total = cached + uncached
  return total === 0 ? 0 : cached / total
}

/**
 * Parse a plaintext JSONL session artifact into its header and preserved
 * event prefix.
 * @param buffer - the raw log bytes (header line first).
 * @returns the session header and decoded events.
 */
export function parseLog(buffer: Buffer): { meta: SessionHeader; events: SessionEvent[] } {
  const { meta, events } = scanLog(buffer)
  return { meta, events }
}

/** Format one log's baseline as a human-readable report. */
export function formatReport(meta: SessionHeader, baseline: UsageBaseline): string {
  const lines = [
    `Session ${meta.id}${meta.cwd === undefined ? '' : ` (cwd: ${meta.cwd})`}`,
    ...baseline.turns.map((turn) => {
      const steps = turn.steps.map(s => `step ${s.step} cached ${s.cacheReadTokens} uncached ${s.uncachedInputTokens}`).join(', ')
      return `Turn ${turn.turn}: hit ${pct(turn.hitRate)} (${turn.steps.length} step${turn.steps.length === 1 ? '' : 's'}${turn.steps.length > 0 ? `: ${steps}` : ''})`
    }),
    `Total: hit ${pct(baseline.hitRate)} (cached ${baseline.cacheReadTokens} / total ${baseline.cacheReadTokens + baseline.uncachedInputTokens}), cache writes ${baseline.cacheWriteTokens}, output ${baseline.outputTokens}`,
  ]
  return lines.join('\n')
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`
}

/**
 * Load, parse, and analyze one session log.
 * @param path - a plaintext `.jsonl` session artifact.
 * @returns the header and usage baseline.
 */
export async function loadBaseline(path: string): Promise<{ meta: SessionHeader; baseline: UsageBaseline }> {
  if (path.endsWith('.zstd')) {
    throw new Error(`zstd-compressed session logs are not supported yet: ${path} (decompress first)`)
  }
  const buffer = await readFile(path)
  const { meta, events } = parseLog(buffer)
  return { meta, baseline: analyzeUsage(events) }
}

async function main(argv: string[]): Promise<number> {
  const jsonOut = argv.indexOf('--json')
  const jsonPath = jsonOut >= 0 ? argv[jsonOut + 1] : undefined
  const logs = (jsonOut >= 0 ? [...argv.slice(0, jsonOut), ...argv.slice(jsonOut + 2)] : argv).filter(arg => !arg.startsWith('--'))
  if (logs.length === 0) {
    process.stderr.write('usage: tsx scripts/token-economy-baseline.ts <log>... [--json <out.json>]\n')
    return 1
  }
  const reports: Array<{ path: string; meta: SessionHeader; baseline: UsageBaseline }> = []
  for (const path of logs) {
    const { meta, baseline } = await loadBaseline(path)
    reports.push({ path, meta, baseline })
    process.stdout.write(`${formatReport(meta, baseline)}\n`)
  }
  if (jsonPath !== undefined) {
    await writeFile(jsonPath, JSON.stringify(reports.map(({ path, meta, baseline }) => ({ path, meta, baseline })), null, 2))
  }
  return 0
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    },
  )
}
