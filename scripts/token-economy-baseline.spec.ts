import { describe, expect, it } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { analyzeUsage, formatReport, loadBaseline, parseLog } from './token-economy-baseline.ts'

const usage = (over: Partial<TokenUsage>): TokenUsage => ({
  inputTokens: 100,
  outputTokens: 20,
  ...over,
})

let seq = 0
const resetSeq = (): void => { seq = 0 }
const time = (): number => 1728000000000 + seq
const chunk = (turn: number, step: number, u: TokenUsage): SessionEvent<'assistant/chunk'> => ({
  type: 'assistant/chunk',
  seq: SessionSeq(seq++),
  time: time(),
  data: { turn, step, chunk: { type: 'usage', usage: u } },
})
const message = (turn: number, step: number, u: TokenUsage): SessionEvent<'assistant/message'> => ({
  type: 'assistant/message',
  seq: SessionSeq(seq++),
  time: time(),
  data: {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
    usage: u,
  },
})
const turnStart = (turn: number): SessionEvent<'turn/start'> => ({
  type: 'turn/start',
  seq: SessionSeq(seq++),
  time: time(),
  data: { turn },
})

const headerLine = (id: string): string => JSON.stringify({
  type: 'session',
  version: 0,
  id,
  createdAt: 1728000000000,
  cwd: '/tmp/proj',
  delegationDepth: 0,
})

describe('analyzeUsage', () => {
  it('aggregates per-turn and total buckets with hit rates', () => {
    resetSeq()
    const events = [
      turnStart(1),
      chunk(1, 1, usage({ inputTokens: 90, cacheReadTokens: 810 })),
      chunk(1, 2, usage({ inputTokens: 100, cacheReadTokens: 900 })),
      turnStart(2),
      chunk(2, 1, usage({ inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 1800 })),
    ]
    const baseline = analyzeUsage(events)
    expect(baseline.turns).toHaveLength(2)
    expect(baseline.turns[0]!.hitRate).toBeCloseTo(0.9)
    expect(baseline.turns[0]!.cacheReadTokens).toBe(1710)
    expect(baseline.turns[1]!.hitRate).toBe(0)
    expect(baseline.hitRate).toBeCloseTo(1710 / (1710 + 390))
    expect(baseline.cacheWriteTokens).toBe(1800)
    expect(baseline.outputTokens).toBe(60)
  })

  it('lets the assistant/message sample replace the earlier chunk sample of the same step', () => {
    resetSeq()
    const events = [
      turnStart(1),
      chunk(1, 1, usage({ inputTokens: 90, cacheReadTokens: 810 })),
      message(1, 1, usage({ inputTokens: 100, cacheReadTokens: 800 })),
    ]
    const baseline = analyzeUsage(events)
    expect(baseline.turns[0]!.steps).toHaveLength(1)
    expect(baseline.turns[0]!.steps[0]!.uncachedInputTokens).toBe(100)
    expect(baseline.turns[0]!.cacheReadTokens).toBe(800)
  })

  it('returns zero hit rate for an event stream with no usage', () => {
    resetSeq()
    const baseline = analyzeUsage([turnStart(1)])
    expect(baseline.hitRate).toBe(0)
    expect(baseline.turns).toHaveLength(0)
    expect(baseline.uncachedInputTokens).toBe(0)
  })
})

describe('parseLog', () => {
  it('parses a plaintext header plus event lines', () => {
    const lines = [headerLine('s1')]
    resetSeq()
    const events = [turnStart(1), chunk(1, 1, usage({ inputTokens: 90, cacheReadTokens: 810 }))]
    lines.push(...events.map(event => JSON.stringify(event)))
    const { meta, events: parsed } = parseLog(Buffer.from(`${lines.join('\n')}\n`, 'utf8'))
    expect(meta.id).toBe('s1')
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.type).toBe('turn/start')
  })

  it('rejects a log whose committed region contains a seq gap before a turn boundary', () => {
    const lines = [headerLine('s2')]
    resetSeq()
    lines.push(JSON.stringify({ type: 'turn/start', seq: 5, time: time(), data: { turn: 1 } }))
    lines.push(JSON.stringify({ type: 'turn/end', seq: 6, time: time(), data: { turn: 1, reason: { kind: 'completed' } } }))
    expect(() => parseLog(Buffer.from(`${lines.join('\n')}\n`, 'utf8'))).toThrow(/seq gap/)
  })
})

describe('loadBaseline', () => {
  it('rejects zstd-compressed logs with a clear error', async () => {
    await expect(loadBaseline('/tmp/nonexistent.jsonl.zstd')).rejects.toThrow(/zstd-compressed/)
  })
})

describe('formatReport', () => {
  it('prints per-turn and total lines', () => {
    resetSeq()
    const baseline = analyzeUsage([turnStart(1), chunk(1, 1, usage({ inputTokens: 90, cacheReadTokens: 810 }))])
    const report = formatReport({ id: 's1' as never, createdAt: 0, version: 0, delegationDepth: 0, isSeeded: false }, baseline)
    expect(report).toContain('Session s1')
    expect(report).toContain('Turn 1: hit 90.00%')
    expect(report).toContain('Total: hit 90.00%')
  })
})
