import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FailurePattern, SelfEvolveResult } from '@deepseek-ai/dsh-self-evolve'
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
  evolveNow: ReturnType<typeof vi.fn>
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

function result(): SelfEvolveResult {
  return {
    runId: 'run-1' as never,
    trigger: 'user-command',
    patterns: [],
    proposals: [],
    commits: [],
    startSeq: 1,
    endSeq: 2,
  }
}

describe('tool-self-evolve registration', () => {
  it('registers the prompt section with the honest capability wording', () => {
    const { sections } = setup({ readPatterns: vi.fn(), evolveNow: vi.fn() })
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('tool:self-evolve')
    expect(sections[0]?.text).toContain('The base provider targets L1-skill and L2-context only')
    expect(sections[0]?.text).toContain('the loop degrades to the conservative weak path and no commits occur')
    expect(sections[0]?.text).not.toContain('bracket smoke')
    expect(sections[0]?.text).not.toContain('regression acceptance')
    expect(sections[0]?.text).not.toContain('dry-run by default')
  })

  it('registers both tools with honest descriptions', () => {
    const { tools } = setup({ readPatterns: vi.fn(), evolveNow: vi.fn() })
    expect(tools.map(t => t.name).sort()).toEqual(['self_evolve_inspect_patterns', 'self_evolve_now'])
    const now = tools.find(t => t.name === 'self_evolve_now')
    expect(now?.description).toContain('L1-skill, L2-context')
    expect(now?.description).not.toContain('human approval')
  })
})

describe('self_evolve_inspect_patterns', () => {
  it('returns a task-relevant view and drops the verifierMeta payload', async () => {
    const patterns: FailurePattern[] = [{
      patternId: 'L1-skill:abc',
      verifierTier: 'subprocess-exit',
      causalSignature: 'exit=1:x',
      level: 'L1-skill',
      summary: 'boom',
      supportingSeqs: [3],
      occurrences: 2,
      verifierMeta: { tool: 'bash', exitCode: 1, text: 'sensitive-stderr', error: { name: 'E' } },
    }]
    const engine = { readPatterns: vi.fn(async () => patterns), evolveNow: vi.fn() }
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
    })
  })

  it('throws without an Agent-backed session', async () => {
    const engine = { readPatterns: vi.fn(), evolveNow: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_inspect_patterns')!
    await expect(tool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/Agent-backed session/)
  })
})

describe('self_evolve_now', () => {
  it('defaults to L1+L2 levels and maps the loop result', async () => {
    const engine = { readPatterns: vi.fn(), evolveNow: vi.fn(async () => result()) }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    const value = await tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal })
    expect(engine.evolveNow).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      expect.any(AbortSignal),
      ['L1-skill', 'L2-context'],
    )
    expect(value).toMatchObject({ runId: 'run-1', trigger: 'user-command' })
  })

  it('passes explicit levels through', async () => {
    const engine = { readPatterns: vi.fn(), evolveNow: vi.fn(async () => result()) }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await tool.execute({ levels: ['L2-context'] }, { agent: fakeAgent(), signal: new AbortController().signal })
    expect(engine.evolveNow).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(AbortSignal),
      ['L2-context'],
    )
  })

  it('rejects unknown levels', async () => {
    const engine = { readPatterns: vi.fn(), evolveNow: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    // The tool's parameter schema rejects out-of-enum values before execute.
    await expect(tool.execute({ levels: ['L5-magic'] }, { agent: fakeAgent(), signal: new AbortController().signal }))
      .rejects.toThrow(/invalid arguments/)
    expect(engine.evolveNow).not.toHaveBeenCalled()
  })

  it('rejects a non-array levels argument', async () => {
    const engine = { readPatterns: vi.fn(), evolveNow: vi.fn() }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await expect(tool.execute({ levels: 'L1-skill' }, { agent: fakeAgent(), signal: new AbortController().signal }))
      .rejects.toThrow(/must be an array/)
    expect(engine.evolveNow).not.toHaveBeenCalled()
  })

  it('maps proposals and commits into the model-facing result', async () => {
    const mapped: SelfEvolveResult = {
      runId: 'run-1' as never,
      trigger: 'user-command',
      patterns: [],
      proposals: [{
        proposalId: 'p-1',
        level: 'L1-skill',
        name: 'guard',
        addressesPatternIds: ['L1-skill:abc'],
        purpose: 'p',
        runId: 'run-1' as never,
        candidate: { kind: 'L1-skill', skillName: 'guard', content: 'c' },
      }],
      commits: [{
        proposal: { proposalId: 'p-1', level: 'L1-skill', name: 'guard', addressesPatternIds: [], purpose: 'p', runId: 'run-1' as never, candidate: { kind: 'L1-skill', skillName: 'guard', content: 'c' } },
        validation: { kind: 'accepted', heldInPassed: 1, heldOutPassed: 1, regressions: [], deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 }, confidence: 1, replayEvidence: [], nextRoundSuggestion: '' },
        commitSeq: 5,
      }],
      startSeq: 1,
      endSeq: 6,
    }
    const engine = { readPatterns: vi.fn(), evolveNow: vi.fn(async () => mapped) }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    const value = await tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal }) as Record<string, unknown>
    expect(value.proposals).toEqual([{
      proposalId: 'p-1', level: 'L1-skill', name: 'guard', addressesPatternIds: ['L1-skill:abc'],
    }])
    expect(value.commits).toEqual([{ proposalId: 'p-1', regressions: 0 }])
    expect(value.patternsMined).toBe(0)
  })

  it('translates a busy-agent guard error into a model-facing message', async () => {
    const engine = {
      readPatterns: vi.fn(),
      evolveNow: vi.fn(async () => { throw new Error('agent already has active work') }),
    }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await expect(tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal }))
      .rejects.toThrow(/already running for this agent/)
  })

  it('rethrows errors that are not busy-agent guards', async () => {
    const engine = {
      readPatterns: vi.fn(),
      evolveNow: vi.fn(async () => { throw new Error('provider unavailable') }),
    }
    const { tools } = setup(engine)
    const tool = tools.find(t => t.name === 'self_evolve_now')!
    await expect(tool.execute({}, { agent: fakeAgent(), signal: new AbortController().signal }))
      .rejects.toThrow(/provider unavailable/)
  })

  it('renders both tool outputs as indented JSON', () => {
    const { tools } = setup({ readPatterns: vi.fn(), evolveNow: vi.fn() })
    const inspect = tools.find(t => t.name === 'self_evolve_inspect_patterns')!
    const inspectRender = inspect.output.render({}, { patterns: [] })
    expect(inspectRender).toEqual([{ type: 'text', text: JSON.stringify({ patterns: [] }, null, 2) }])
    const now = tools.find(t => t.name === 'self_evolve_now')!
    const nowRender = now.output.render({}, { runId: 'r' })
    expect(nowRender).toEqual([{ type: 'text', text: JSON.stringify({ runId: 'r' }, null, 2) }])
  })
})
