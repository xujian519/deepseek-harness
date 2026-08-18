import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  BasicSelfEvolveEngine,
  eligiblePatterns,
} from '../src/index.ts'
import type { BasicSelfEvolveConfig } from '../src/types.ts'
import { failurePatternsProjectionDefinition } from '@deepseek-ai/dsh-self-evolve'
import type { EvolveLevel, EvolveProposal, FailurePattern, SelfEvolveAgentContext } from '@deepseek-ai/dsh-self-evolve'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ProposalValidationOutcome, ReplayEvidence } from '@deepseek-ai/dsh-self-evolve/types'

function sessionFactory(): Session {
  return Session.create(SessionId(`test-${Math.random().toString(36).slice(2, 10)}`))
}

function appendShellResult(session: Session, callId: string, text: string): void {
  const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: callId as never, name: 'bash', arguments: '{}' }).seq
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] } as never,
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}

function pattern(text: string, tier: FailurePattern['verifierTier'], occurrences: number): FailurePattern {
  return {
    patternId: `${tier}:${text}`,
    verifierTier: tier,
    causalSignature: text,
    level: 'L1-skill',
    summary: text,
    supportingSeqs: [1, 2],
    occurrences,
    verifierMeta: {},
  }
}

/** Project a session's events into the failure-patterns state (as the registry would). */
function projectedState(session: Session): Record<string, unknown> {
  let state = failurePatternsProjectionDefinition.init()
  for (const event of session.events) state = failurePatternsProjectionDefinition.apply(state, event)
  return { values: { 'failure-patterns': state } }
}

function agentFor(session: Session, runMaintenance?: SelfEvolveAgentContext['runMaintenance']): SelfEvolveAgentContext {
  return {
    sessionId: session.id,
    options: {},
    runMaintenance: runMaintenance ?? (async task => task(new AbortController().signal)),
  }
}

/** A fake services bundle so the engine can run without the full composition. */
function provideServices(ctx: Context, session: Session, parent?: unknown, systemPrompt?: unknown): void {
  ctx.provide('sessionProjections', {
    register: () => () => {},
    snapshot: () => projectedState(session),
  })
  ctx.provide('sessions', { get: (id: string) => (id === session.id ? session : undefined) })
  ctx.provide('agents', { get: () => parent })
  ctx.provide('skills', { register: () => () => {} })
  ctx.provide('systemPrompt', systemPrompt ?? { section: () => () => {} })
}

function baseConfig(overrides: Partial<BasicSelfEvolveConfig> = {}): BasicSelfEvolveConfig {
  return {
    maxDailyLoopsPerSession: 4,
    triggers: {
      'idle-maintenance': { enabled: true, minIntervalMs: 0 },
      pressure: { enabled: true, minIntervalMs: 0 },
      'user-command': { enabled: true, minIntervalMs: 0 },
      'validation-retry': { enabled: true, minIntervalMs: 0 },
    },
    defaultLevels: ['L1-skill', 'L2-context'],
    minPatternOccurrences: 2,
    maxProposalsPerLoop: 2,
    requireDualVerification: true,
    maxDirtyLinesAddedPerCommit: 2,
    ...overrides,
  }
}

/** Subclass exposing protected hooks and injecting verifier signals. */
class SignalEngine extends BasicSelfEvolveEngine {
  replay: { exitCode: number; retriggeredPatternIds: string[] } | null = null
  workspace: { dirtyLines: number; noDirtyFallback: boolean } | null = null
  heldOut: { passed: number; cases: number } | null = { passed: 1, cases: 1 }
  session: Session

  constructor(ctx: Context, config: BasicSelfEvolveConfig, session: Session) {
    super(ctx, config)
    this.session = session
  }

  protected override async collectReplaySignal(): Promise<{ exitCode: number; retriggeredPatternIds: string[] } | null> {
    return this.replay
  }

  protected override async collectWorkspaceSignal(): Promise<{ dirtyLines: number; noDirtyFallback: boolean } | null> {
    return this.workspace
  }

  protected override async collectHeldOutSignal(): Promise<{ passed: number; cases: number } | null> {
    return this.heldOut
  }

  validate(proposal: EvolveProposal): Promise<ProposalValidationOutcome> {
    return this.validateProposal(agentFor(this.session), proposal, new AbortController().signal)
  }
}

/** Subclass rejecting every proposal, for negative-results coverage. */
class RejectingEngine extends BasicSelfEvolveEngine {
  protected override async validateProposal(): Promise<ProposalValidationOutcome> {
    return {
      kind: 'rejected',
      reason: 'held-in-failed',
      regressions: [],
      diagnostic: 'test rejection',
      nextRoundSuggestion: 'try something else',
    }
  }

  persist(proposal: EvolveProposal, outcome: Extract<ProposalValidationOutcome, { kind: 'rejected' }>): Promise<void> {
    return this.persistNegativeResult(proposal, outcome)
  }
}

/** Subclass exposing Phase 1 protected hooks for direct testing. */
class ProbeEngine extends BasicSelfEvolveEngine {
  replay(agent: SelfEvolveAgentContext, p: EvolveProposal, caseText: string, signal: AbortSignal): ReturnType<BasicSelfEvolveEngine['replayCase']> {
    return this.replayCase(agent, p, caseText, signal)
  }

  replaySignal(agent: SelfEvolveAgentContext, p: EvolveProposal, pattern: FailurePattern, signal: AbortSignal): ReturnType<BasicSelfEvolveEngine['collectReplaySignal']> {
    return this.collectReplaySignal(agent, p, pattern, signal)
  }

  validateL4(agent: SelfEvolveAgentContext, p: EvolveProposal, signal: AbortSignal): ReturnType<BasicSelfEvolveEngine['validateL4Proposal']> {
    return this.validateL4Proposal(agent, p, signal)
  }

  reflect(agent: Agent, turn: number, step: number, signal: AbortSignal): Promise<void> {
    return this.maybeReflect(agent, turn, step, signal)
  }

  propose(patterns: FailurePattern[], levels: readonly EvolveLevel[], signal: AbortSignal, sessionId: string): ReturnType<BasicSelfEvolveEngine['proposeForPatterns']> {
    return this.proposeForPatterns(patterns, levels, {}, signal, sessionId)
  }

  persistGlobal(agent: SelfEvolveAgentContext, patterns: FailurePattern[]): Promise<void> {
    return this.persistGlobalPatterns(agent, patterns)
  }

  readGlobal(sessionId: string): Promise<Map<string, number>> {
    return this.readGlobalPatternOccurrences(sessionId)
  }

  heldOut(agent: SelfEvolveAgentContext, p: EvolveProposal, pattern: FailurePattern, signal: AbortSignal): ReturnType<BasicSelfEvolveEngine['collectHeldOutSignal']> {
    return this.collectHeldOutSignal(agent, p, pattern, signal)
  }

  judge(p: EvolveProposal, evidence: ReplayEvidence[], signal: AbortSignal): ReturnType<BasicSelfEvolveEngine['_judge']> {
    return this._judge(p, evidence, signal)
  }

  prune(): Promise<void> {
    return this.pruneInflatedSections()
  }

  archive(p: EvolveProposal): Promise<void> {
    return this.archiveChampion(p)
  }

  rollback(patternId: string): Promise<void> {
    return this.rollbackPattern(patternId)
  }

  commit(agent: SelfEvolveAgentContext, p: EvolveProposal): Promise<{ commitSeq: number }> {
    return this.applyCommit(agent, p, {
      kind: 'accepted',
      heldInPassed: 1,
      heldOutPassed: 1,
      regressions: [],
      deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 },
      confidence: 1,
      replayEvidence: [],
      nextRoundSuggestion: '',
    })
  }
}

function proposal(overrides: Partial<EvolveProposal> = {}): EvolveProposal {
  return {
    proposalId: 'prop-1',
    runId: 'run-1' as never,
    level: 'L2-context',
    name: 'patch',
    purpose: 'test',
    addressesPatternIds: ['L1-skill:abc'],
    candidate: { kind: 'L2-context', sectionName: 's', sectionText: 't', order: 260, estimatedBytes: 1 },
    ...overrides,
  }
}

describe('eligiblePatterns (SIG-2 weak-tier threshold lift)', () => {
  it('tool-runtime occurrences=2 with default min=2 → NOT eligible (threshold +1 lift)', () => {
    expect(eligiblePatterns([pattern('x', 'tool-runtime', 2)], 2)).toHaveLength(0)
  })

  it('tool-runtime occurrences=3 with default min=2 → eligible', () => {
    expect(eligiblePatterns([pattern('x', 'tool-runtime', 3)], 2)).toHaveLength(1)
  })

  it('subprocess-exit occurrences=2 with default min=2 → eligible (no lift for strong tier)', () => {
    expect(eligiblePatterns([pattern('x', 'subprocess-exit', 2)], 2)).toHaveLength(1)
  })
})

describe('Phase 1 validation pipeline (P1.1b/P1.3/P1.4)', () => {
  async function signalEngine(overrides: Partial<BasicSelfEvolveConfig> = {}): Promise<{ engine: SignalEngine; patternId: string }> {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new SignalEngine(ctx, baseConfig(overrides), session)
    const [pattern] = await engine.readPatterns(session.id)
    return { engine, patternId: pattern!.patternId }
  }

  it('both verifiers pass + held-out passes → accepted with heldInPassed=1', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = { exitCode: 0, retriggeredPatternIds: [] }
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind === 'accepted') {
      expect(outcome.heldInPassed).toBe(1)
      expect(outcome.confidence).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('mixed T+F → rejected with no counted regressions (conservative)', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = { exitCode: 0, retriggeredPatternIds: [] }
    engine.workspace = { dirtyLines: 9, noDirtyFallback: false }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.reason).toBe('held-in-failed')
      expect(outcome.regressions).toEqual([])
    }
  })

  it('F+T → rejected', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = { exitCode: 3, retriggeredPatternIds: [patternId] }
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('rejected')
  })

  it('requireDualVerification=false → held-in is not required but confidence still gates', async () => {
    const { engine, patternId } = await signalEngine({ requireDualVerification: false })
    engine.replay = { exitCode: 3, retriggeredPatternIds: [patternId] }
    engine.workspace = { dirtyLines: 99, noDirtyFallback: false }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind === 'accepted') expect(outcome.heldInPassed).toBe(0)
  })

  it('verifier signals unavailable → conservative low-confidence rejection (weak path 0.3)', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = null
    engine.workspace = null
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.reason).toBe('low-confidence')
      expect(outcome.diagnostic).toContain('低于阈值')
      expect(outcome.replayEvidence?.some(row => row.note?.includes('弱路径'))).toBe(true)
      expect(outcome.regressions).toEqual([])
    }
  })

  it('held-out pass rate below 0.6 lowers confidence below the gate', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = { exitCode: 0, retriggeredPatternIds: [] }
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false }
    engine.heldOut = { passed: 1, cases: 3 }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    // confidence = 1 × 1 × (1/3) = 0.333 < 0.5
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') expect(outcome.reason).toBe('low-confidence')
  })

  it('validatorTarget equal to proposerTarget fails load-time validation', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    expect(() => new BasicSelfEvolveEngine(ctx, baseConfig({
      proposerTarget: { provider: 'deepseek', model: 'proposer' },
      validatorTarget: { provider: 'deepseek', model: 'proposer' },
    }))).toThrow(/validatorTarget must differ from proposerTarget/)
  })

  it('schema-normalized empty targets do not trip the drift guard', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const validated = BasicSelfEvolveEngine.Config(baseConfig()) as unknown as BasicSelfEvolveConfig
    expect(validated.proposerTarget).toEqual({})
    expect(validated.validatorTarget).toEqual({})
    expect(() => new BasicSelfEvolveEngine(ctx, validated)).not.toThrow()
  })
})

describe('maxDailyLoopsPerSession enforcement', () => {
  it('blocks a second autonomous loop inside the 24h window', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig({ maxDailyLoopsPerSession: 1 }))
    let maintenanceCalls = 0
    const agent = agentFor(session, (async () => {
      maintenanceCalls += 1
      return { runId: 'r' } as never
    }) as never)

    const first = await engine.evolveIfNeeded(agent, 'idle-maintenance', new AbortController().signal)
    expect(first).not.toBeNull()
    const second = await engine.evolveIfNeeded(agent, 'idle-maintenance', new AbortController().signal)
    expect(second).toBeNull()
    expect(maintenanceCalls).toBe(1)
  })

  it('respects the per-trigger minIntervalMs gate once a loop has started', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig({
      maxDailyLoopsPerSession: 4,
      triggers: {
        'idle-maintenance': { enabled: true, minIntervalMs: 60_000 },
        pressure: { enabled: true, minIntervalMs: 0 },
        'user-command': { enabled: true, minIntervalMs: 0 },
        'validation-retry': { enabled: true, minIntervalMs: 0 },
      },
    }))
    let maintenanceCalls = 0
    const agent = agentFor(session, (async () => {
      maintenanceCalls += 1
      return { runId: 'r' } as never
    }) as never)

    await engine.evolveIfNeeded(agent, 'idle-maintenance', new AbortController().signal)
    // A second idle attempt inside the 60s window is gated before mining.
    const second = await engine.evolveIfNeeded(agent, 'idle-maintenance', new AbortController().signal)
    expect(second).toBeNull()
    expect(maintenanceCalls).toBe(1)
  })

  it('explicit user-command loops bypass the autonomous cap', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig({ maxDailyLoopsPerSession: 1 }))
    let maintenanceCalls = 0
    const agent = agentFor(session, (async () => {
      maintenanceCalls += 1
      return { runId: 'r' } as never
    }) as never)

    await engine.evolveNow(agent, new AbortController().signal)
    await engine.evolveNow(agent, new AbortController().signal)
    expect(maintenanceCalls).toBe(2)
  })
})

describe('negative results (P1.7b)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'self-evolve-test-'))
    vi.stubEnv('DSH_HOME', dir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejected proposals append one JSON line per rejection to the negative-results log', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new RejectingEngine(ctx, baseConfig())
    const result = await engine.evolveNow(agentFor(session), new AbortController().signal)
    expect(result.proposals.length).toBeGreaterThan(0)

    const raw = await readFile(join(dir, 'self-evolve', 'negative-results.jsonl'), 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(result.proposals.length)
    const row = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(row.reason).toBe('held-in-failed')
    expect(row.diagnostic).toBe('test rejection')
    expect(row.nextRoundSuggestion).toBe('try something else')
    expect(typeof row.patternId).toBe('string')
    expect(row.proposalId).toBe(result.proposals[0]?.proposalId)
  })

  it('readNegativeResults filters by pattern and caps the limit', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new RejectingEngine(ctx, baseConfig())
    // Seed the log through the protected path, then read through the public API.
    for (let i = 0; i < 2; i += 1) {
      await engine.persist(proposal({ proposalId: `p-a-${i}` }), {
        kind: 'rejected',
        reason: 'held-in-failed',
        regressions: [],
        diagnostic: 'a',
        nextRoundSuggestion: 'x',
      })
    }
    await engine.persist(proposal({ proposalId: 'p-b', addressesPatternIds: ['L1-skill:other'] }), {
      kind: 'rejected',
      reason: 'rate-limited',
      regressions: [],
      diagnostic: 'b',
      nextRoundSuggestion: 'y',
    })
    const rows = await engine.readNegativeResults('L1-skill:abc')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.proposalId).toBe('p-a-1')
    const others = await engine.readNegativeResults('L1-skill:other')
    expect(others).toHaveLength(1)
    expect(await engine.readNegativeResults('L1-skill:abc', 1)).toHaveLength(1)
    expect(await engine.readNegativeResults('L1-skill:none')).toHaveLength(0)
  })

  it('the template proposer summarizes recent rejections into its section text (P1.8 prefix)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new RejectingEngine(ctx, baseConfig())
    const [target] = await engine.readPatterns(session.id)
    expect(target).toBeDefined()
    await engine.persist(proposal({ proposalId: 'p-old', addressesPatternIds: [target!.patternId] }), {
      kind: 'rejected',
      reason: 'held-in-failed',
      regressions: [],
      diagnostic: 'still failing',
      nextRoundSuggestion: 'different approach',
    })
    const result = await engine.evolveNow(agentFor(session), new AbortController().signal)
    const section = result.proposals[0]?.candidate
    expect(section?.kind).toBe('L2-context')
    if (section?.kind === 'L2-context') {
      expect(section.sectionText).toContain('1 次提案均被拒绝')
      expect(section.sectionText).toContain('held-in-failed')
      expect(section.sectionText).toContain('不要重复同样方案')
    }
  })
})

describe('agent/request-error producer (G1)', () => {
  it('appends a durable session event on the request-error waterfall and delegates', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig())
    void engine

    let nextCalled = false
    const result = await ctx.emit('agent/request-error', {
      agent: { session },
      turn: 1,
      step: 1,
      provider: 'deepseek',
      failure: { message: 'rate limited', code: 'rate_limit_exceeded', status: 429 },
      retryPolicy: undefined,
      signal: new AbortController().signal,
    } as never, async () => {
      nextCalled = true
      return undefined
    })
    expect(result).toBeUndefined()
    expect(nextCalled).toBe(true)
    const event = session.events.find(e => e.type === 'agent/request-error')
    expect(event).toBeDefined()
    const data = event?.data as { provider?: unknown; statusCode?: unknown; error?: { code?: unknown } }
    expect(data.provider).toBe('deepseek')
    expect(data.statusCode).toBe(429)
    expect(data.error?.code).toBe('rate_limit_exceeded')
  })
})

describe('Phase 1 replay, judge, and long-horizon guards', () => {
  function childSession(): Session {
    const child = Session.create(SessionId('child-replay'), [])
    const callSeq = child.append('tool/call', { turn: 1, step: 1, callId: 'rc1' as never, name: 'bash', arguments: '{}' }).seq
    child.append('tool/result', {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'rc1', content: [{ type: 'text', text: '[stderr]\nboom\n[exit code: 1]' }] } as never,
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    return child
  }

  function forkSubagents(ctx: Context, child: Session): void {
    ctx.provide('subagents', {
      getProvider: () => ({}),
      start: async () => ({
        result: Promise.resolve({ stopReason: 'completed', output: [] }),
        localAgent: { session: child },
        dispose: async () => {},
      }),
    } as never)
  }

  it('replayCase forks a child and folds only its own events after the end-seed (P1.2)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session } as never)
    forkSubagents(ctx, childSession())
    const engine = new ProbeEngine(ctx, baseConfig())
    const replay = await engine.replay(agentFor(session), proposal(), 'case', new AbortController().signal)
    expect(replay).not.toBeNull()
    expect(replay?.exitCode).toBe(0)
    expect(replay?.retriggeredPatternIds).toHaveLength(1)
    expect(replay?.retriggeredPatternIds[0]).toMatch(/^L1-skill:/)
  })

  it('replayCase returns null when the fork infrastructure is absent', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    expect(await engine.replay(agentFor(session), proposal(), 'case', new AbortController().signal)).toBeNull()
  })

  it('collectHeldOutSignal replays similar history hits and reports the pass rate (P1.3)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session } as never)
    // Replays succeed when the fork child completes without new failures.
    forkSubagents(ctx, Session.create(SessionId('child-clean'), []))
    ctx.provide('sessionQuery', {
      searchEvents: async () => ({
        items: [
          { seq: 5, snippet: 'old failure one', type: 'tool/result' },
          { seq: 9, snippet: 'old failure two', type: 'tool/result' },
        ],
      }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig({ maxHeldOutCases: 5 }))
    const [pattern] = await engine.readPatterns(session.id)
    expect(pattern).toBeDefined()
    const target = proposal({ addressesPatternIds: [pattern!.patternId] })
    const signal = await engine.heldOut(agentFor(session), target, pattern!, new AbortController().signal)
    expect(signal).toEqual({ passed: 2, cases: 2 })
  })

  it('collectHeldOutSignal returns null without sessionQuery or similar hits', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    expect(await engine.heldOut(agentFor(session), proposal(), pattern!, new AbortController().signal)).toBeNull()
  })

  it('_judge parses the four-dimension scores from the validator LLM (P1.4)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text: '{"activatesWhenCorrect":0.8,"clarity":0.9,"noRegressionIntroduced":1,"safety":1}' }
      },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig({ validatorTarget: { provider: 'deepseek', model: 'judge' } }))
    const scores = await engine.judge(proposal(), [], new AbortController().signal)
    expect(scores).toEqual({ activatesWhenCorrect: 0.8, clarity: 0.9, noRegressionIntroduced: 1, safety: 1 })
  })

  it('_judge returns null without a validatorTarget and clamps out-of-range scores', async () => {
    const bare = new Context()
    const bareSession = sessionFactory()
    provideServices(bare, bareSession)
    const engine = new ProbeEngine(bare, baseConfig())
    expect(await engine.judge(proposal(), [], new AbortController().signal)).toBeNull()

    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text: '{"activatesWhenCorrect":7,"clarity":-1,"noRegressionIntroduced":0.5,"safety":1}' }
      },
    } as never)
    const clamped = new ProbeEngine(ctx, baseConfig({ validatorTarget: { provider: 'deepseek', model: 'judge' } }))
    const scores = await clamped.judge(proposal(), [], new AbortController().signal)
    expect(scores).toEqual({ activatesWhenCorrect: 1, clarity: 0, noRegressionIntroduced: 0.5, safety: 1 })
  })

  it('pruneInflatedSections archives and disposes sections over the byte budget (P1.9)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-prune-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      const disposed: string[] = []
      const systemPrompt = {
        section: (section: { name: string }) => {
          return () => { disposed.push(section.name) }
        },
      }
      provideServices(ctx, session, undefined, systemPrompt)
      const engine = new ProbeEngine(ctx, baseConfig({ maxPromptInflationBytesPerWeek: 10 }))
      const agent = agentFor(session)
      await engine.commit(agent, proposal({
        proposalId: 'p-old',
        candidate: { kind: 'L2-context', sectionName: 'old-section', sectionText: 'x'.repeat(20), order: 260, estimatedBytes: 20 },
      }))
      await engine.commit(agent, proposal({
        proposalId: 'p-new',
        candidate: { kind: 'L2-context', sectionName: 'new-section', sectionText: 'y'.repeat(20), order: 260, estimatedBytes: 20 },
      }))
      await engine.prune()
      expect(disposed).toContain('old-section')
      const archived = await readFile(join(dir, 'self-evolve', 'l2-archive', 'old-section.md'), 'utf8')
      expect(archived).toContain('xxxx')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rollbackPattern restores the latest archived champion through the owning seam (P1.8)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-rollback-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      const sections: { name: string; text: string }[] = []
      const systemPrompt = {
        section: (section: { name: string; text: string }) => {
          sections.push(section)
          return () => {}
        },
      }
      provideServices(ctx, session, undefined, systemPrompt)
      const engine = new ProbeEngine(ctx, baseConfig())
      await engine.archive(proposal({
        proposalId: 'champ-1',
        candidate: { kind: 'L2-context', sectionName: 'sec', sectionText: 'champion text', order: 260, estimatedBytes: 13 },
      }))
      await engine.rollback('L1-skill:abc')
      expect(sections.some(section => section.name === 'sec' && section.text === 'champion text')).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('two consecutive same-pattern rejections trigger one champion rollback in the loop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-rollback-loop-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new (class extends BasicSelfEvolveEngine {
        rollbacks = 0
        protected override async validateProposal(): Promise<ProposalValidationOutcome> {
          return {
            kind: 'rejected',
            reason: 'held-out-regression',
            regressions: ['L1-skill:abc'],
            diagnostic: 'still failing',
            nextRoundSuggestion: 'nope',
          }
        }

        protected override async rollbackPattern(): Promise<void> {
          this.rollbacks += 1
        }
      })(ctx, baseConfig())
      const agent = agentFor(session)
      await engine.evolveNow(agent, new AbortController().signal)
      await engine.evolveNow(agent, new AbortController().signal)
      expect(engine.rollbacks).toBe(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('Phase 2 L3/L4 (workflow smoke + dynamic runner approval)', () => {
  it('L3 candidates validate through the workflow smoke run (P2.1)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session } as never)
    ctx.provide('workflowEngine', {
      start: () => ({
        result: Promise.resolve({ value: null, stopReason: 'completed', agentsStarted: 2 }),
        dispose: async () => {},
      }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const l3 = proposal({ candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'return 1' } })
    const signal = await engine.replaySignal(agentFor(session), l3, pattern('x', 'subprocess-exit', 2), new AbortController().signal)
    expect(signal).toEqual({ exitCode: 0, retriggeredPatternIds: [] })
  })

  it('a failing L3 smoke run rejects the proposal through held-in verification', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session } as never)
    ctx.provide('workflowEngine', {
      start: () => ({
        result: Promise.resolve({ value: null, stopReason: 'error', error: 'script threw', agentsStarted: 0 }),
        dispose: async () => {},
      }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const l3 = proposal({ candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'throw new Error()' } })
    const signal = await engine.replaySignal(agentFor(session), l3, pattern('x', 'subprocess-exit', 2), new AbortController().signal)
    expect(signal?.exitCode).toBe(1)
  })

  it('L3 candidates report the smoke unavailable without a workflow engine', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const l3 = proposal({ candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'return 1' } })
    expect(await engine.replaySignal(agentFor(session), l3, pattern('x', 'subprocess-exit', 2), new AbortController().signal)).toBeNull()
  })

  it('L4 candidates define and run through the dynamic runner, entering approval (P2.2)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session } as never)
    const runs: string[] = []
    ctx.provide('dynamicCordisRunner', {
      define: () => ({
        pluginId: 'dyn-1', packageId: 'pkg-1', name: 'n', purpose: 'p', hasHostHalf: true, hasClientHalf: true,
      }),
      run: async (_agent: unknown, pluginId: string) => {
        runs.push(pluginId)
        return { ok: true, status: 'awaiting-approval', pluginId, packageId: 'pkg-1', pluginRunId: 'run-1', waitingFor: [] }
      },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const outcome = await engine.validateL4(
      agentFor(session),
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' } }),
      new AbortController().signal,
    )
    expect(outcome.kind).toBe('accepted')
    expect(runs).toEqual(['dyn-1'])
  })

  it('an L4 run refusal rejects the proposal as approval-denied', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session } as never)
    ctx.provide('dynamicCordisRunner', {
      define: () => ({ pluginId: 'dyn-1', packageId: 'pkg-1', name: 'n', purpose: 'p', hasHostHalf: true, hasClientHalf: true }),
      run: async () => ({ ok: false, reason: 'approval-denied', message: 'user declined' }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const outcome = await engine.validateL4(
      agentFor(session),
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' } }),
      new AbortController().signal,
    )
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') expect(outcome.reason).toBe('approval-denied')
  })

  it('L4 candidates reject without the dynamic runner service', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const outcome = await engine.validateL4(
      agentFor(session),
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' } }),
      new AbortController().signal,
    )
    expect(outcome.kind).toBe('rejected')
  })

  it('the before-approval wrapper forces re-approval for stale or cross-proposal L4 runs (P2.3)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig({ l4ReapprovalHours: 24 }))
    const base = false
    const info = (pluginId: string, requiresApproval: boolean) => ({
      requestId: 'req-1', agentId: session.id, pluginId, packageId: 'pkg-2', mode: 'run', name: 'n', purpose: 'p', requiresApproval,
    }) as never

    // Stale approval (>24h) and a different proposal id both force approval.
    engine['l4Pending'].set('dyn-1', 'prop-2')
    engine['l4Ledger'].set('dyn-1', { proposalId: 'prop-1', approvedAt: Date.now() - 25 * 3_600_000 })
    expect(await ctx.events.waterfall('cordis/before-approval', info('dyn-1', base), () => Promise.resolve(base))).toBe(true)
    engine['l4Ledger'].set('dyn-1', { proposalId: 'prop-1', approvedAt: Date.now() - 1000 })
    expect(await ctx.events.waterfall('cordis/before-approval', info('dyn-1', base), () => Promise.resolve(base))).toBe(true)

    // A fresh same-proposal run within the window keeps the base requirement.
    engine['l4Pending'].set('dyn-1', 'prop-1')
    engine['l4Ledger'].set('dyn-1', { proposalId: 'prop-1', approvedAt: Date.now() - 1000 })
    expect(await ctx.events.waterfall('cordis/before-approval', info('dyn-1', base), () => Promise.resolve(base))).toBe(false)

    // A plugin this provider never drove is left to the runner's own grants.
    expect(await ctx.events.waterfall('cordis/before-approval', info('other-1', base), () => Promise.resolve(base))).toBe(false)
  })
})

describe('Phase 3/4 (reflection, LLM proposer, freeze, budget, global KB)', () => {
  function fakeLlm(ctx: Context, text: string): void {
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text }
      },
    } as never)
  }

  function reflectAgent(session: Session): Agent {
    return { session, options: { provider: 'deepseek', model: 'chat' } } as unknown as Agent
  }

  it('a high-confidence reflection reinforces an existing pattern (P3.1)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    const before = pattern!.occurrences
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'check cwd first' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    const event = session.events.find(e => e.type === 'self-evolve/reflection')
    expect(event).toBeDefined()
    const [after] = await engine.readPatterns(session.id)
    expect(after!.occurrences).toBe(before + 1)
  })

  it('a low-confidence reflection is dropped and unknown pattern ids are ignored (P3.1)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    fakeLlm(ctx, JSON.stringify({ confidence: 0.4, patternId: 'L1-skill:nope', suggestion: 'x' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    expect(session.events.filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('the reflection throttle limits reflections to one per turn (P3.1)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig({ maxStepReflectionsPerTurn: 1 }))
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'x' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    await engine.reflect(reflectAgent(session), 1, 2, new AbortController().signal)
    expect(session.events.filter(e => e.type === 'self-evolve/reflection')).toHaveLength(1)
  })

  it('the LLM proposer parses generated proposals with the CSR context (P3.2)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session } as never)
    ctx.provide('sessionQuery', {
      searchEvents: async () => ({ items: [{ seq: 3, snippet: 'resolved by checking cwd', type: 'tool/result' }] }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
    const patterns = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify([{
      name: 'cwd-guard', purpose: 'check cwd before bash', addressesPatternIds: [patterns[0]!.patternId],
      candidate: { kind: 'L2-context', sectionName: 'cwd-guard', sectionText: 'check cwd first', order: 260 },
    }]))
    const proposals = await engine.propose(patterns, ['L1-skill', 'L2-context'], new AbortController().signal, session.id)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.candidate.kind).toBe('L2-context')
    if (proposals[0]?.candidate.kind === 'L2-context') {
      expect(proposals[0].candidate.sectionText).toBe('check cwd first')
      expect(proposals[0].candidate.estimatedBytes).toBe('check cwd first'.length)
    }
  })

  it('without a proposerTarget the template proposer still runs', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const patterns = await engine.readPatterns(session.id)
    const proposals = await engine.propose(patterns, ['L1-skill', 'L2-context'], new AbortController().signal, session.id)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.candidate.kind).toBe('L2-context')
  })

  it('two proposals freeze a pattern for the freeze window (P3.3)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-freeze-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new (class extends BasicSelfEvolveEngine {
        protected override async validateProposal(): Promise<ProposalValidationOutcome> {
          return {
            kind: 'rejected', reason: 'held-in-failed', regressions: [],
            diagnostic: 'frozen-test', nextRoundSuggestion: 'x',
          }
        }
      })(ctx, baseConfig({ patternFreezeHours: 24, maxProposalsPerLoop: 2 }))
      const agent = agentFor(session)
      await engine.evolveNow(agent, new AbortController().signal)
      await engine.evolveNow(agent, new AbortController().signal)
      // Third loop: the pattern is frozen, so no proposals are generated.
      const third = await engine.evolveNow(agent, new AbortController().signal)
      expect(third.proposals).toHaveLength(0)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('the loop budget aborts with budget-exceeded (P3.4)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    fakeLlm(ctx, '{}')
    const engine = new ProbeEngine(ctx, baseConfig({
      validatorTarget: { provider: 'deepseek', model: 'judge' },
      maxBudgetCharsPerLoop: 10,
    }))
    await expect(engine.evolveNow(agentFor(session), new AbortController().signal)).rejects.toThrow(/budget-exceeded/)
  })

  it('global patterns merge across sessions within the 24h window (P4.1/P4.2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-global-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const sessionB = sessionFactory()
      appendShellResult(sessionB, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(sessionB, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, sessionB)
      const engine = new ProbeEngine(ctx, baseConfig())
      const [pattern] = await engine.readPatterns(sessionB.id)
      // Session A (a different session) contributes two occurrences.
      await engine.persistGlobal(agentFor(sessionFactory()), [
        { ...pattern!, occurrences: 2 },
      ])
      const merged = await engine.readGlobal(sessionB.id)
      expect(merged.get(pattern!.patternId)).toBe(2)
      const [enriched] = await engine.readPatterns(sessionB.id)
      expect(enriched!.occurrences).toBe(pattern!.occurrences + 2)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('stale global rows outside the 24h window are ignored (P4.2)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-global-stale-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const sessionB = sessionFactory()
      provideServices(ctx, sessionB)
      const engine = new ProbeEngine(ctx, baseConfig())
      const file = join(dir, 'self-evolve', 'global-patterns.jsonl')
      await mkdtemp(join(dir, 'self-evolve'))
      const { mkdir, appendFile: append } = await import('node:fs/promises')
      await mkdir(join(dir, 'self-evolve'), { recursive: true })
      await append(file, `${JSON.stringify({ ts: Date.now() - 25 * 3_600_000, sessionId: 'other', patternId: 'L1-skill:x', occurrences: 9 })}\n`)
      expect(await engine.readGlobal(sessionB.id)).toEqual(new Map())
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
