import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { EvolveRequestReceipt, FailurePattern } from '@deepseek-ai/dsh-self-evolve'
import { FailurePatternId } from '@deepseek-ai/dsh-self-evolve'
import { apply } from '../src/index.ts'

type RegisteredTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render: (args: Record<string, unknown>, value: unknown) => unknown }
  execute: (args: Record<string, unknown>, exec: { agent?: Agent; signal: AbortSignal }) => Promise<unknown>
}

interface FakeEngine {
  readPatterns: ReturnType<typeof vi.fn>
  requestEvolve: ReturnType<typeof vi.fn>
}

function receipt(overrides: Partial<EvolveRequestReceipt> = {}): EvolveRequestReceipt {
  return { requestId: 'req-1', status: 'queued', queuePosition: 1, ...overrides }
}

function setup(engine: FakeEngine): { ctx: Context; tools: RegisteredTool[]; sections: { name: string; text: string; order: number }[] } {
  const tools: RegisteredTool[] = []
  const sections: { name: string; text: string; order: number }[] = []
  const ctx = new Context()
  ctx.provide('tools', { register: (tool: RegisteredTool) => { tools.push(tool) } } as never)
  ctx.provide('systemPrompt', { section: (section: { name: string; text: string; order: number }) => { sections.push(section) } } as never)
  ctx.provide('selfEvolve', engine as never)
  ctx.provide('agents', { get: () => undefined } as never)
  apply(ctx)
  return { ctx, tools, sections }
}

function fakeAgent(): Agent {
  return {
    session: { id: 'session-1' },
    options: {},
    runMaintenance: (async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)) as never,
  } as unknown as Agent
}

function pattern(index: number): FailurePattern {
  return {
    patternId: FailurePatternId(`L1-skill:${index}`),
    verifierTier: 'subprocess-exit',
    causalSignature: `exit=1:${index}`,
    level: 'L1-skill',
    summary: `boom-${index}`,
    supportingSeqs: Array.from({ length: 30 }, (_, offset) => offset + index),
    occurrences: 2,
    verifierMeta: { tool: 'bash', exitCode: 1 },
  }
}

describe('tool-self-evolve registration', () => {
  it('registers the prompt section with the honest capability wording', () => {
    const { sections } = setup({ readPatterns: vi.fn(), requestEvolve: vi.fn() })
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('tool:self-evolve')
    expect(sections[0]?.text).toContain('The base provider targets L1-skill and L2-context only')
    expect(sections[0]?.text).toContain('any dimension left without a signal rejects the proposal')
    expect(sections[0]?.text).toContain('follow-up message')
    expect(sections[0]?.text).not.toContain('bracket smoke')
    expect(sections[0]?.text).not.toContain('dry-run by default')
  })

  it('registers both tools with honest descriptions', () => {
    const { tools } = setup({ readPatterns: vi.fn(), requestEvolve: vi.fn() })
    expect(tools.map(t => t.name).sort()).toEqual(['self_evolve_inspect_patterns', 'self_evolve_now'])
    const now = tools.find(t => t.name === 'self_evolve_now')
    expect(now?.description).toContain('L1-skill, L2-context')
    expect(now?.description).toContain('idle boundary')
    expect(now?.description).not.toContain('human approval')
  })
})

describe('self_evolve_inspect_patterns', () => {
  it('returns a task-relevant view and drops the verifierMeta payload', async () => {
    const patterns: FailurePattern[] = [{
      patternId: FailurePatternId('L1-skill:abc'),
      verifierTier: 'subprocess-exit',
      causalSignature: 'exit=1:x',
      level: 'L1-skill',
      summary: 'boom',
      supportingSeqs: [3],
      occurrences: 2,
      verifierMeta: { tool: 'bash', exitCode: 1, text: 'sensitive-stderr', error: { name: 'E' } },
    }]
    const engine = { readPatterns: vi.fn(async () => patterns), requestEvolve: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_inspect_patterns')!
    const value = await tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal })
    expect(engine.readPatterns).toHaveBeenCalledWith('session-1')
    // Model-facing only: internal causalSignature and owner-specific
    // verifierMeta (full text, stderr, raw error objects) must not leak.
    expect(value).toEqual({
      patterns: [{
        patternId: 'L1-skill:abc',
        level: 'L1-skill',
        verifierTier: 'subprocess-exit',
        summary: 'boom',
        occurrences: 2,
        supportingSeqs: [3],
      }],
      truncated: false,
    })
  })

  it('caps the pattern list and supporting seqs it returns to the model', async () => {
    const patterns = Array.from({ length: 51 }, (_, index) => pattern(index))
    const engine = { readPatterns: vi.fn(async () => patterns), requestEvolve: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_inspect_patterns')!
    const value = await tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal }) as {
      patterns: { supportingSeqs: number[] }[]
      truncated: boolean
    }
    expect(value.patterns).toHaveLength(50)
    expect(value.truncated).toBe(true)
    expect(value.patterns[0]?.supportingSeqs).toHaveLength(20)
  })

  it('throws without an Agent-backed session', async () => {
    const engine = { readPatterns: vi.fn(), requestEvolve: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_inspect_patterns')!
    await expect(tool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/Agent-backed session/)
  })
})

describe('self_evolve_now', () => {
  it('defaults to L1+L2 levels and returns the queue receipt', async () => {
    const engine = { readPatterns: vi.fn(), requestEvolve: vi.fn(() => receipt()) }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    const value = await tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal })
    expect(engine.requestEvolve).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      ['L1-skill', 'L2-context'],
    )
    expect(value).toMatchObject({ requestId: 'req-1', status: 'queued', queuePosition: 1 })
  })

  it('passes explicit levels through', async () => {
    const engine = { readPatterns: vi.fn(), requestEvolve: vi.fn(() => receipt()) }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await tool.execute({ levels: ['L2-context'] }, { agent: fakeAgent(), signal: new AbortController().signal })
    expect(engine.requestEvolve).toHaveBeenCalledWith(
      expect.anything(),
      ['L2-context'],
    )
  })

  it('reports a coalesced request', async () => {
    const engine = {
      readPatterns: vi.fn(),
      requestEvolve: vi.fn(() => receipt({ status: 'coalesced', queuePosition: 2 })),
    }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    const value = await tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal })
    expect(value).toMatchObject({ status: 'coalesced', queuePosition: 2 })
  })

  it('rejects unknown levels', async () => {
    const engine = { readPatterns: vi.fn(), requestEvolve: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    // The tool's parameter schema rejects out-of-enum values before execute.
    await expect(tool.execute({ levels: ['L5-magic'] }, { agent: fakeAgent(), signal: new AbortController().signal }))
      .rejects.toThrow(/invalid arguments/)
    expect(engine.requestEvolve).not.toHaveBeenCalled()
  })

  it('rejects a non-array levels argument', async () => {
    const engine = { readPatterns: vi.fn(), requestEvolve: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await expect(tool.execute({ levels: 'L1-skill' }, { agent: fakeAgent(), signal: new AbortController().signal }))
      .rejects.toThrow(/must be an array/)
    expect(engine.requestEvolve).not.toHaveBeenCalled()
  })

  it('throws without an Agent-backed session', async () => {
    const engine = { readPatterns: vi.fn(), requestEvolve: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await expect(tool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/Agent-backed session/)
  })

  it('renders both tool outputs as indented JSON', () => {
    const { tools } = setup({ readPatterns: vi.fn(), requestEvolve: vi.fn() })
    const inspect = tools.find(t => t.name === 'self_evolve_inspect_patterns')!
    const inspectRender = inspect.output.render({}, { patterns: [] })
    expect(inspectRender).toEqual([{ type: 'text', text: JSON.stringify({ patterns: [] }, null, 2) }])
    const now = tools.find(t => t.name === 'self_evolve_now')!
    const nowRender = now.output.render({}, { requestId: 'r' })
    expect(nowRender).toEqual([{ type: 'text', text: JSON.stringify({ requestId: 'r' }, null, 2) }])
  })
})
