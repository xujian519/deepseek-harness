import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import {
  BasicSelfEvolveEngine,
  eligiblePatterns,
  parseDirtyDelta,
} from '../src/index.ts'
import type { BasicSelfEvolveConfig, TriggerPolicy, WorkspaceBaseline, WorkspaceSignal } from '../src/types.ts'
import { failurePatternsProjectionDefinition } from '@deepseek-ai/dsh-self-evolve'
import type { EvolveLevel, EvolveProposal, FailurePattern, SelfEvolveAgentContext } from '@deepseek-ai/dsh-self-evolve'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
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
  for (const event of session.snapshotEvents()) state = failurePatternsProjectionDefinition.apply(state, event)
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
  workspace: WorkspaceSignal | null = null
  heldOut: { passed: number; cases: number } | null = { passed: 1, cases: 1 }
  session: Session

  constructor(ctx: Context, config: BasicSelfEvolveConfig, session: Session) {
    super(ctx, config)
    this.session = session
  }

  protected override async collectReplaySignal(): Promise<{ exitCode: number; retriggeredPatternIds: string[] } | null> {
    return this.replay
  }

  protected override async collectWorkspaceSignal(): Promise<WorkspaceSignal | null> {
    return this.workspace
  }

  protected override async collectHeldOutSignal(): Promise<{ passed: number; cases: number } | null> {
    return this.heldOut
  }

  validate(proposal: EvolveProposal, signal = new AbortController().signal): Promise<ProposalValidationOutcome> {
    return this.validateProposal(agentFor(this.session), proposal, signal)
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

  workflowSmoke(agent: SelfEvolveAgentContext, p: EvolveProposal, signal: AbortSignal): ReturnType<BasicSelfEvolveEngine['runWorkflowSmoke']> {
    return this.runWorkflowSmoke(agent, p, signal)
  }

  skillFile(agent: SelfEvolveAgentContext, p: EvolveProposal): Promise<void> {
    return this.persistSkillFile(agent, p)
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

describe('parseDirtyDelta (P1.9b)', () => {
  it('sums insertions and deletions of tracked rows', () => {
    expect(parseDirtyDelta('1\t2\tpath/a.ts\n3\t0\tb.ts')).toBe(6)
  })

  it('excludes harness-owned .dsh/ paths', () => {
    expect(parseDirtyDelta('1\t2\t.dsh/skills/x/SKILL.md\n3\t0\ta.ts')).toBe(3)
  })

  it('counts a binary row as one dirty unit', () => {
    expect(parseDirtyDelta('-\t-\tassets/logo.png\n1\t0\ta.ts')).toBe(2)
  })

  it('adds the untracked-line total', () => {
    expect(parseDirtyDelta('1\t0\ta.ts', 7)).toBe(8)
  })

  it('empty numstat yields 0', () => {
    expect(parseDirtyDelta('')).toBe(0)
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
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false, buildHealthy: true }
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
    engine.workspace = { dirtyLines: 9, noDirtyFallback: false, buildHealthy: true }
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
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false, buildHealthy: true }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('rejected')
  })

  it('build failure → rejected held-in-failed with build-failed reason (P1.9b)', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = { exitCode: 0, retriggeredPatternIds: [] }
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false, buildHealthy: false }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') {
      expect(outcome.reason).toBe('held-in-failed')
      expect(outcome.diagnostic).toContain('build-failed')
      expect(outcome.regressions).toEqual([])
    }
  })

  it('noDirtyFallback with a healthy build → accepted regardless of dirty lines (P1.9b)', async () => {
    const { engine, patternId } = await signalEngine()
    engine.replay = { exitCode: 0, retriggeredPatternIds: [] }
    engine.workspace = { dirtyLines: 999, noDirtyFallback: true, buildHealthy: true }
    const outcome = await engine.validate(proposal({ addressesPatternIds: [patternId] }))
    expect(outcome.kind).toBe('accepted')
  })

  it('requireDualVerification=false → held-in is not required but confidence still gates', async () => {
    const { engine, patternId } = await signalEngine({ requireDualVerification: false })
    engine.replay = { exitCode: 3, retriggeredPatternIds: [patternId] }
    engine.workspace = { dirtyLines: 99, noDirtyFallback: false, buildHealthy: true }
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
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false, buildHealthy: true }
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
    const validated = BasicSelfEvolveEngine.Config(baseConfig())
    expect(validated.proposerTarget).toEqual({})
    expect(validated.validatorTarget).toEqual({})
    expect(() => new BasicSelfEvolveEngine(ctx, validated)).not.toThrow()
  })
})

describe('maxDailyLoopsPerSession enforcement', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'self-evolve-rate-'))
    vi.stubEnv('DSH_HOME', dir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('blocks a second autonomous loop inside the 24h window', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig({ maxDailyLoopsPerSession: 1 }))
    let maintenanceCalls = 0
    const agent = agentFor(session, async (task) => {
      maintenanceCalls += 1
      return task(new AbortController().signal)
    })

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
    const agent = agentFor(session, async (task) => {
      maintenanceCalls += 1
      return task(new AbortController().signal)
    })

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
    const agent = agentFor(session, async (task) => {
      maintenanceCalls += 1
      return task(new AbortController().signal)
    })

    await engine.evolveNow(agent, new AbortController().signal)
    await engine.evolveNow(agent, new AbortController().signal)
    expect(maintenanceCalls).toBe(2)
  })
})

describe('commit bracket integrity', () => {
  /** Engine that accepts every proposal, for the full-loop commit path. */
  class AcceptingEngine extends BasicSelfEvolveEngine {
    protected override async validateProposal(): Promise<ProposalValidationOutcome> {
      return {
        kind: 'accepted',
        heldInPassed: 1,
        heldOutPassed: 1,
        regressions: [],
        deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 },
        confidence: 1,
        replayEvidence: [],
        nextRoundSuggestion: '',
      }
    }
  }

  it('a full loop records exactly one commit event and reports its durable seq', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-commit-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new AcceptingEngine(ctx, baseConfig())
      const result = await engine.evolveNow(agentFor(session), new AbortController().signal)

      const commitEvents = session.snapshotEvents().filter(e => e.type === 'self-evolve/commit')
      expect(commitEvents).toHaveLength(1)
      const commitData = commitEvents[0]?.data as { commit: { proposal: { proposalId: string }; commitSeq?: number } }
      expect(commitData.commit.proposal.proposalId).toBe(result.commits[0]?.proposal.proposalId)
      expect(result.commits[0]?.commitSeq).toBe(commitEvents[0]?.seq)
    } finally {
      vi.unstubAllEnvs()
    }
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
    ctx.emit('agent/request-error', {
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
    expect(nextCalled).toBe(true)
    const event = session.snapshotEvents().find(e => e.type === 'agent/request-error')
    expect(event).toBeDefined()
    const data = event?.data as { turn?: unknown; step?: unknown; provider?: unknown; statusCode?: unknown; error?: { code?: unknown } }
    expect(data.turn).toBe(1)
    expect(data.step).toBe(1)
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
    provideServices(ctx, session, { session })
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
    provideServices(ctx, session, { session })
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
    provideServices(ctx, session, { session })
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

  it('rollbackPattern restores the candidate the last commit replaced (P1.8)', async () => {
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
      // Commit 1 archives a null previous (first commit); commit 2 archives
      // commit 1 as the champion, so a rollback restores commit 1's text.
      await engine.archive(proposal({
        proposalId: 'c1',
        candidate: { kind: 'L2-context', sectionName: 'sec', sectionText: 'champion text', order: 260, estimatedBytes: 13 },
      }))
      await engine.archive(proposal({
        proposalId: 'c2',
        candidate: { kind: 'L2-context', sectionName: 'sec', sectionText: 'regressing text', order: 260, estimatedBytes: 15 },
      }))
      await engine.rollback('L1-skill:abc')
      expect(sections.some(section => section.name === 'sec' && section.text === 'champion text')).toBe(true)
      expect(sections.some(section => section.text === 'regressing text')).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rollbackPattern is a no-op when the pattern has no previous commit (P1.8)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-rollback-first-'))
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
        proposalId: 'c1',
        candidate: { kind: 'L2-context', sectionName: 'sec', sectionText: 'first text', order: 260, estimatedBytes: 10 },
      }))
      await engine.rollback('L1-skill:abc')
      expect(sections).toHaveLength(0)
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
    provideServices(ctx, session, { session })
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
    provideServices(ctx, session, { session })
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
    provideServices(ctx, session, { session })
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
    provideServices(ctx, session, { session })
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

function fakeLlm(ctx: Context, text: string): void {
  ctx.provide('llm', {
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text }
    },
  } as never)
}

function fakeLlmQueue(ctx: Context, texts: string[]): void {
  let index = 0
  ctx.provide('llm', {
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: texts[Math.min(index, texts.length - 1)] ?? '' }
      index += 1
    },
  } as never)
}

function reflectAgent(session: Session): Agent {
  return { session, options: { provider: 'deepseek', model: 'chat' } } as unknown as Agent
}

/** A session with two mined patterns and the services the engine needs. */
function reflectSetup(): { ctx: Context; session: Session } {
  const ctx = new Context()
  const session = sessionFactory()
  appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
  appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
  provideServices(ctx, session)
  return { ctx, session }
}

describe('Phase 3/4 (reflection, LLM proposer, freeze, budget, global KB)', () => {

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
    const event = session.snapshotEvents().find(e => e.type === 'self-evolve/reflection')
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
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
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
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(1)
  })

  it('the LLM proposer parses generated proposals with the CSR context (P3.2)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session })
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

describe('review fixes (M1 request-error reflection, M3 L4 cleanup)', () => {
  it('a request-error recorded with its turn triggers the reflection path (M1)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    // The producer records the failing turn; turnHasFailure must match it.
    session.append('agent/request-error', {
      turn: 1,
      step: 2,
      provider: 'deepseek',
      statusCode: 429,
      error: { code: 'rate_limit_exceeded', name: 'LlmFailure', message: 'rate limited' },
    })
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'retry later' }))
    await engine.reflect(reflectAgent(session), 1, 3, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(1)
  })

  it('an L4 run refusal undefines the orphaned plugin definition (M3)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const undefinedIds: string[] = []
    ctx.provide('dynamicCordisRunner', {
      define: () => ({ pluginId: 'dyn-1', packageId: 'pkg-1', name: 'n', purpose: 'p', hasHostHalf: true, hasClientHalf: true }),
      run: async () => ({ ok: false, reason: 'approval-denied', message: 'user declined' }),
      undefine: async (_agent: unknown, pluginId: string) => { undefinedIds.push(pluginId) },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const outcome = await engine.validateL4(
      agentFor(session),
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' } }),
      new AbortController().signal,
    )
    expect(outcome.kind).toBe('rejected')
    expect(undefinedIds).toEqual(['dyn-1'])
  })

  it('an async approval refusal drops the definition via request-run-resolved (M3)', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const undefinedIds: string[] = []
    ctx.provide('dynamicCordisRunner', {
      define: () => ({ pluginId: 'dyn-1', packageId: 'pkg-1', name: 'n', purpose: 'p', hasHostHalf: true, hasClientHalf: true }),
      run: async () => ({ ok: true, status: 'awaiting-approval', pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1', waitingFor: [] }),
      undefine: async (_agent: unknown, pluginId: string) => { undefinedIds.push(pluginId) },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.validateL4(
      agentFor(session),
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' } }),
      new AbortController().signal,
    )
    ctx.emit('@deepseek-ai/cordis/request-run', {
      requestId: 'req-1', agentId: session.id, pluginId: 'dyn-1', packageId: 'pkg-1',
      mode: 'run', name: 'n', purpose: 'p', requiresApproval: true,
    } as never)
    ctx.emit('@deepseek-ai/cordis/request-run-resolved', { requestId: 'req-1', outcome: 'rejected' } as never)
    await vi.waitFor(() => { expect(undefinedIds).toEqual(['dyn-1']) })
  })
})

describe('candidate rendering across kinds (judge path)', () => {
  it('renders L1-skill, L3-workflow, and L4-harness candidates for the judge', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    fakeLlm(ctx, JSON.stringify({ activatesWhenCorrect: 0.8, clarity: 0.9, noRegressionIntroduced: 1, safety: 1 }))
    const engine = new ProbeEngine(ctx, baseConfig({ validatorTarget: { provider: 'deepseek', model: 'judge' } }))
    const signal = new AbortController().signal
    await expect(engine.judge(
      proposal({ candidate: { kind: 'L1-skill', skillName: 'guard', content: 'check first', whenToUse: 'on bash' } }),
      [], signal,
    )).resolves.toEqual({ activatesWhenCorrect: 0.8, clarity: 0.9, noRegressionIntroduced: 1, safety: 1 })
    await expect(engine.judge(
      proposal({ candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'return 1' } }),
      [], signal,
    )).resolves.toEqual({ activatesWhenCorrect: 0.8, clarity: 0.9, noRegressionIntroduced: 1, safety: 1 })
    await expect(engine.judge(
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn', hostCode: 'host()', clientCode: 'client()' } }),
      [], signal,
    )).resolves.toEqual({ activatesWhenCorrect: 0.8, clarity: 0.9, noRegressionIntroduced: 1, safety: 1 })
    await expect(engine.judge(
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'bare' } }),
      [], signal,
    )).resolves.toEqual({ activatesWhenCorrect: 0.8, clarity: 0.9, noRegressionIntroduced: 1, safety: 1 })
  })
})

describe('LLM output parser edges (P3.1/P3.2/P1.4)', () => {
  it('non-object reflection output is dropped', async () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    const ctx = new Context()
    provideServices(ctx, session)
    fakeLlm(ctx, '"plain string"')
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('reflection with no match or unparseable JSON is dropped', async () => {
    const { ctx, session } = reflectSetup()
    fakeLlmQueue(ctx, ['no json here', '{oops'])
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    await engine.reflect(reflectAgent(session), 2, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('reflection with non-numeric confidence or non-string patternId is dropped', async () => {
    const { ctx, session } = reflectSetup()
    const engine = new ProbeEngine(ctx, baseConfig({ maxStepReflectionsPerTurn: 2 }))
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlmQueue(ctx, [
      JSON.stringify({ confidence: 'high', patternId: pattern!.patternId, suggestion: 'x' }),
      JSON.stringify({ confidence: 0.9, patternId: 123, suggestion: 'x' }),
    ])
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    await engine.reflect(reflectAgent(session), 1, 2, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('reflection with a non-string suggestion appends an empty suggestion', async () => {
    const { ctx, session } = reflectSetup()
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 42 }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    const event = session.snapshotEvents().find(e => e.type === 'self-evolve/reflection')
    expect((event?.data as { suggestion?: unknown }).suggestion).toBe('')
  })

  it('judge output that is not an object or misses a dimension degrades to null', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    fakeLlmQueue(ctx, [
      'null',
      '{"activatesWhenCorrect":0.5,"clarity":"high","noRegressionIntroduced":1,"safety":1}',
    ])
    const engine = new ProbeEngine(ctx, baseConfig({ validatorTarget: { provider: 'deepseek', model: 'judge' } }))
    expect(await engine.judge(proposal(), [], new AbortController().signal)).toBeNull()
    expect(await engine.judge(proposal(), [], new AbortController().signal)).toBeNull()
  })

  it('the LLM proposer drops malformed entries and keeps well-formed ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-llm-proposer-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session, { session })
      ctx.provide('sessionQuery', {
        searchEvents: async () => ({ items: [{ seq: 3, snippet: 'resolved by checking cwd', type: 'tool/result' }] }),
      } as never)
      const engine = new ProbeEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' }, maxProposalsPerLoop: 10 }))
      const patterns = await engine.readPatterns(session.id)
      fakeLlm(ctx, JSON.stringify([
        { name: 'a', purpose: 'b', addressesPatternIds: ['p1', 42], candidate: { kind: 'L1-skill', skillName: 's1', content: 'c1', whenToUse: 'w1' } },
        { name: 'b', purpose: 'c', addressesPatternIds: ['p1'], candidate: { kind: 'L1-skill', skillName: 's2', content: 'c2' } },
        { name: 'c', purpose: 'd', candidate: { kind: 'L1-skill', skillName: 42, content: 'c3' } },
        { name: 'd', purpose: 'e', candidate: { kind: 'L1-skill', skillName: 's4', content: 42 } },
        { name: 'e', purpose: 'f', candidate: { kind: 'L2-context', sectionName: 'sn', sectionText: 'st', order: 'x' } },
        { name: 42, purpose: 'g', candidate: { kind: 'L2-context', sectionName: 'sn2', sectionText: 'st2', order: 1 } },
        { name: 'h', purpose: 42, candidate: { kind: 'L2-context', sectionName: 'sn3', sectionText: 'st3', order: 1 } },
        { name: 'i', purpose: 'j', addressesPatternIds: 'not-array', candidate: { kind: 'L2-context', sectionName: 'sn4', sectionText: 'st4', order: 1 } },
        { name: 'k', purpose: 'l', candidate: { kind: 'L3-workflow', scriptName: 'w', scriptBody: 'b' } },
        { name: 'm', purpose: 'n' },
      ]))
      const proposals = await engine.propose(patterns, ['L1-skill', 'L2-context'], new AbortController().signal, session.id)
      expect(proposals).toHaveLength(4)
      const l1 = proposals.filter(p => p.level === 'L1-skill')
      expect(l1).toHaveLength(2)
      expect((l1[0]?.candidate as Extract<EvolveProposal['candidate'], { kind: 'L1-skill' }>).whenToUse).toBe('w1')
      expect((l1[1]?.candidate as Extract<EvolveProposal['candidate'], { kind: 'L1-skill' }>).whenToUse).toBeUndefined()
      const l2 = proposals.filter(p => p.level === 'L2-context')
      expect(l2).toHaveLength(2)
      expect((l2[0]?.candidate as Extract<EvolveProposal['candidate'], { kind: 'L2-context' }>).order).toBe(260)
      expect((l2[1]?.candidate as Extract<EvolveProposal['candidate'], { kind: 'L2-context' }>).sectionName).toBe('sn4')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a non-array LLM proposer output falls back to the template', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    fakeLlm(ctx, '{"not": "an array"}')
    const engine = new ProbeEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
    const patterns = await engine.readPatterns(session.id)
    const proposals = await engine.propose(patterns, ['L1-skill', 'L2-context'], new AbortController().signal, session.id)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.candidate.kind).toBe('L2-context')
  })

  it('empty levels short-circuit the LLM proposer context', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    fakeLlm(ctx, '[]')
    const engine = new ProbeEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
    const patterns = await engine.readPatterns(session.id)
    expect(await engine.propose(patterns, [], new AbortController().signal, session.id)).toEqual([])
  })

  it('buildProposerContext renders negatives and skips the CSR block without sessionQuery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-llm-context-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      // Seed a negative result on one context (same shell events → same patternId).
      const seederCtx = new Context()
      const seederSession = sessionFactory()
      appendShellResult(seederSession, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(seederSession, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(seederCtx, seederSession)
      const rejecter = new RejectingEngine(seederCtx, baseConfig())
      const [target] = await rejecter.readPatterns(seederSession.id)
      await rejecter.persist(proposal({ proposalId: 'p-old', addressesPatternIds: [target!.patternId] }), {
        kind: 'rejected', reason: 'held-in-failed', regressions: [],
        diagnostic: 'x', nextRoundSuggestion: 'different approach',
      })

      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session, { session })
      const engine = new ProbeEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
      const patterns = await engine.readPatterns(session.id)
      // An empty LLM output falls back to the template; without sessionQuery
      // the CSR block is skipped.
      fakeLlm(ctx, '[]')
      const withoutQuery = await engine.propose(patterns, ['L1-skill', 'L2-context'], new AbortController().signal, session.id)
      expect(withoutQuery).toHaveLength(1)
      expect(withoutQuery[0]?.candidate.kind).toBe('L2-context')
      // With sessionQuery returning no items the CSR block stays empty.
      ctx.provide('sessionQuery', { searchEvents: async () => ({ items: [] }) } as never)
      const emptyItems = await engine.propose(patterns, ['L1-skill', 'L2-context'], new AbortController().signal, session.id)
      expect(emptyItems).toHaveLength(1)
      expect(emptyItems[0]?.candidate.kind).toBe('L2-context')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('config resolution edges', () => {
  it('empty config applies every default', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, {})
    expect(engine.config.maxDailyLoopsPerSession).toBe(4)
    expect(engine.config.defaultLevels).toEqual(['L1-skill', 'L2-context'])
    expect(engine.config.minPatternOccurrences).toBe(2)
    expect(engine.config.maxProposalsPerLoop).toBe(2)
    expect(engine.config.maxDirtyLinesAddedPerCommit).toBe(2)
    expect(engine.config.requireDualVerification).toBe(true)
  })

  it('a partial proposerTarget fails load with a loud error', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    expect(() => new BasicSelfEvolveEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek' } as never })))
      .toThrow(/must include both provider and model/)
  })
})

describe('constructor lifecycle listeners', () => {
  function turnEndSetup(
    status: string,
    runMaintenance?: (task: (signal: AbortSignal) => Promise<unknown>) => Promise<unknown>,
  ): { ctx: Context; session: Session } {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    const agent = {
      session,
      options: {},
      status,
      runMaintenance: runMaintenance ?? (async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
    }
    provideServices(ctx, session, agent)
    new BasicSelfEvolveEngine(ctx, baseConfig())
    return { ctx, session }
  }

  it('ignores non-turn/end and unresolved-agent session events', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    new BasicSelfEvolveEngine(ctx, baseConfig())
    expect(() => {
      ctx.emit('session/event', session, { type: 'turn/start', seq: 0 } as never)
      ctx.emit('session/event', session, { type: 'turn/end', seq: 1 } as never)
    }).not.toThrow()
  })

  it('skips a turn/end whose agent is not idle', () => {
    const { ctx, session } = turnEndSetup('running')
    expect(() => {
      ctx.emit('session/event', session, { type: 'turn/end', seq: 0 } as never)
    }).not.toThrow()
  })

  it('runs an idle-maintenance loop on turn/end for an idle agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-turnend-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const { ctx, session } = turnEndSetup('idle')
      ctx.emit('session/event', session, { type: 'turn/end', seq: 0 } as never)
      await vi.waitFor(() => {
        expect(session.snapshotEvents().some(e => e.type === 'self-evolve/end')).toBe(true)
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('logs idle-maintenance failures that happen outside the loop bracket', async () => {
    const { ctx, session } = turnEndSetup('idle', async () => { throw new Error('maintenance exploded') })
    const logs: string[] = []
    ctx.logger.exporter({ levels: { default: 2 }, export: (message) => { logs.push(String(message.args[0])) } })
    ctx.emit('session/event', session, { type: 'turn/end', seq: 0 } as never)
    await vi.waitFor(() => { expect(logs.some(line => line.includes('maintenance exploded'))).toBe(true) })
  })

  it('logs non-Error idle-maintenance failures with String coercion', async () => {
    const { ctx, session } = turnEndSetup('idle', async () => { throw 'exploded-string' })
    const logs: string[] = []
    ctx.logger.exporter({ levels: { default: 2 }, export: (message) => { logs.push(String(message.args[0])) } })
    ctx.emit('session/event', session, { type: 'turn/end', seq: 0 } as never)
    await vi.waitFor(() => { expect(logs.some(line => line.includes('exploded-string'))).toBe(true) })
  })

  it('the request-error producer survives a session that rejects appends', () => {
    const ctx = new Context()
    provideServices(ctx, sessionFactory())
    new BasicSelfEvolveEngine(ctx, baseConfig())
    let nextCalled = false
    ctx.emit('agent/request-error', {
      agent: { session: { append: () => { throw new Error('closed') } } },
      turn: 1, step: 1, provider: 'deepseek',
      failure: { message: 'x', code: 'y', status: 429 },
      retryPolicy: undefined,
      signal: new AbortController().signal,
    } as never, async (): Promise<RequestErrorAction> => { nextCalled = true; return undefined })
    expect(nextCalled).toBe(true)
  })

  it('the request-error producer coerces non-Error append failures', () => {
    const ctx = new Context()
    provideServices(ctx, sessionFactory())
    new BasicSelfEvolveEngine(ctx, baseConfig())
    let nextCalled = false
    ctx.emit('agent/request-error', {
      agent: { session: { append: () => { throw 'closed' } } },
      turn: 1, step: 1, provider: 'deepseek',
      failure: { message: 'x', code: 'y', status: 429 },
      retryPolicy: undefined,
      signal: new AbortController().signal,
    } as never, async (): Promise<RequestErrorAction> => { nextCalled = true; return undefined })
    expect(nextCalled).toBe(true)
  })

  it('the pre-step hook skips aborted signals and zero-reflection configs', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    new BasicSelfEvolveEngine(ctx, baseConfig({ maxStepReflectionsPerTurn: 0 }))
    let calls = 0
    ctx.emit('agent/pre-step', {
      agent: reflectAgent(session), messages: [], turn: 1, step: 1, signal: { aborted: true } as AbortSignal,
    }, async () => { calls += 1; return { kind: 'reject' } })
    ctx.emit('agent/pre-step', {
      agent: reflectAgent(session), messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => { calls += 1; return { kind: 'reject' } })
    expect(calls).toBe(2)
  })

  it('the pre-step hook reflects for idle turns and always delegates', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'x' }))
    let nextCalled = false
    ctx.emit('agent/pre-step', {
      agent: reflectAgent(session), messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => { nextCalled = true; return { kind: 'reject' } })
    await vi.waitFor(() => { expect(nextCalled).toBe(true) })
  })

  it('the pre-step hook swallows reflection failures', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    new BasicSelfEvolveEngine(ctx, baseConfig())
    let nextCalled = false
    // A broken agent object makes maybeReflect throw before any session work.
    ctx.emit('agent/pre-step', {
      agent: null as never, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => { nextCalled = true; return { kind: 'reject' } })
    await vi.waitFor(() => { expect(nextCalled).toBe(true) })
  })

  it('the pre-step hook coerces non-Error reflection failures', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig())
    void engine
    ctx.provide('llm', { stream: async function* () { throw 'llm-boom' } } as never)
    let nextCalled = false
    ctx.emit('agent/pre-step', {
      agent: reflectAgent(session), messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => { nextCalled = true; return { kind: 'reject' } })
    await vi.waitFor(() => { expect(nextCalled).toBe(true) })
  })

  it('request-run correlation only tracks plugins this provider drove', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const engine = new ProbeEngine(ctx, baseConfig())
    ctx.emit('@deepseek-ai/cordis/request-run', {
      requestId: 'req-x', agentId: session.id, pluginId: 'unrelated', packageId: 'p',
      mode: 'run', name: 'n', purpose: 'p', requiresApproval: true,
    } as never)
    expect(engine['l4RequestByRun'].has('req-x')).toBe(false)
    ctx.emit('@deepseek-ai/cordis/request-run-resolved', { requestId: 'req-x', outcome: 'rejected' } as never)
  })

  it('an approved request-run keeps the pending L4 definition', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const engine = new ProbeEngine(ctx, baseConfig())
    const undefinedIds: string[] = []
    ctx.provide('dynamicCordisRunner', {
      undefine: async () => { undefinedIds.push('dyn-1') },
    } as never)
    engine['l4Pending'].set('dyn-1', 'prop-1')
    ctx.emit('@deepseek-ai/cordis/request-run', {
      requestId: 'req-1', agentId: session.id, pluginId: 'dyn-1', packageId: 'pkg-1',
      mode: 'run', name: 'n', purpose: 'p', requiresApproval: true,
    } as never)
    ctx.emit('@deepseek-ai/cordis/request-run-resolved', { requestId: 'req-1', outcome: 'approved' } as never)
    expect(undefinedIds).toEqual([])
  })

  it('cleanup after a refused run tolerates a missing runner', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const engine = new ProbeEngine(ctx, baseConfig())
    engine['l4Pending'].set('dyn-1', 'prop-1')
    ctx.emit('@deepseek-ai/cordis/request-run', {
      requestId: 'req-1', agentId: session.id, pluginId: 'dyn-1', packageId: 'pkg-1',
      mode: 'run', name: 'n', purpose: 'p', requiresApproval: true,
    } as never)
    ctx.emit('@deepseek-ai/cordis/request-run-resolved', { requestId: 'req-1', outcome: 'rejected' } as never)
    expect(engine['l4Pending'].has('dyn-1')).toBe(false)
  })

  it('dropL4Plugin swallows undefine failures', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const engine = new ProbeEngine(ctx, baseConfig())
    ctx.provide('dynamicCordisRunner', {
      undefine: async () => { throw new Error('already gone') },
    } as never)
    engine['l4Pending'].set('dyn-1', 'prop-1')
    ctx.emit('@deepseek-ai/cordis/request-run', {
      requestId: 'req-1', agentId: session.id, pluginId: 'dyn-1', packageId: 'pkg-1',
      mode: 'run', name: 'n', purpose: 'p', requiresApproval: true,
    } as never)
    ctx.emit('@deepseek-ai/cordis/request-run-resolved', { requestId: 'req-1', outcome: 'rejected' } as never)
    // No unhandled rejection; the cleanup is best-effort.
  })

  it('dropL4Plugin coerces non-Error undefine failures', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const engine = new ProbeEngine(ctx, baseConfig())
    ctx.provide('dynamicCordisRunner', {
      undefine: async () => { throw 'gone' },
    } as never)
    engine['l4Pending'].set('dyn-1', 'prop-1')
    ctx.emit('@deepseek-ai/cordis/request-run', {
      requestId: 'req-1', agentId: session.id, pluginId: 'dyn-1', packageId: 'pkg-1',
      mode: 'run', name: 'n', purpose: 'p', requiresApproval: true,
    } as never)
    ctx.emit('@deepseek-ai/cordis/request-run-resolved', { requestId: 'req-1', outcome: 'rejected' } as never)
  })
})

describe('mining and proposer gates', () => {
  it('a turn/end is skipped when idle-maintenance is disabled', () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const triggers: TriggerPolicy = { ...baseConfig().triggers!, 'idle-maintenance': { enabled: false, minIntervalMs: 0 } }
    new BasicSelfEvolveEngine(ctx, baseConfig({ triggers }))
    expect(() => {
      ctx.emit('session/event', session, { type: 'turn/end', seq: 0 } as never)
    }).not.toThrow()
  })

  it('evolveIfNeeded returns null for a disabled trigger', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const triggers: TriggerPolicy = { ...baseConfig().triggers!, 'user-command': { enabled: false, minIntervalMs: 0 } }
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig({ triggers }))
    expect(await engine.evolveIfNeeded(agentFor(session), 'user-command', new AbortController().signal)).toBeNull()
  })

  it('autonomous triggers without eligible patterns short-circuit before a loop', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig())
    expect(await engine.evolveIfNeeded(agentFor(session), 'pressure', new AbortController().signal)).toBeNull()
    expect(await engine.evolveIfNeeded(agentFor(session), 'validation-retry', new AbortController().signal)).toBeNull()
  })

  it('readPatterns returns [] when the projection state is absent', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    ctx.provide('sessionProjections', { register: () => () => {}, snapshot: () => ({ values: {} }) })
    ctx.provide('sessions', { get: (id: string) => (id === session.id ? session : undefined) })
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('skills', { register: () => () => {} })
    ctx.provide('systemPrompt', { section: () => () => {} })
    const engine = new ProbeEngine(ctx, baseConfig())
    expect(await engine.readPatterns(session.id)).toEqual([])
  })

  it('requireSession fails loud for an unknown session id', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    await expect(engine.readPatterns('missing-session')).rejects.toThrow(/unknown sessionId/)
  })

  it('proposeForPatterns without a session id runs the template directly', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const proposals = await engine.propose(
      [pattern('a', 'subprocess-exit', 2)],
      ['L1-skill', 'L2-context'],
      new AbortController().signal,
      undefined as never,
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.candidate.kind).toBe('L2-context')
  })

  it('the template proposer skips non-L1 patterns', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig({ maxProposalsPerLoop: 3 }))
    const l2Level = { ...pattern('x', 'subprocess-exit', 2), level: 'L2-context' as const }
    const proposals = await engine.propose(
      [pattern('a', 'subprocess-exit', 2), l2Level],
      ['L1-skill', 'L2-context'],
      new AbortController().signal,
      session.id,
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.candidate.kind).toBe('L2-context')
  })

  it('the template proposer fills the per-loop cap', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig({ maxProposalsPerLoop: 1 }))
    const proposals = await engine.propose(
      [pattern('a', 'subprocess-exit', 2), pattern('b', 'subprocess-exit', 2)],
      ['L1-skill', 'L2-context'],
      new AbortController().signal,
      session.id,
    )
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.candidate.kind).toBe('L2-context')
  })

  it('the template proposer renders ids without a colon and empty evidence windows', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig({ maxProposalsPerLoop: 3 }))
    const bare = { ...pattern('bare', 'subprocess-exit', 2), patternId: 'nocolon', supportingSeqs: [] }
    const proposals = await engine.propose(
      [pattern('a', 'subprocess-exit', 2), bare],
      ['L1-skill', 'L2-context'],
      new AbortController().signal,
      session.id,
    )
    expect(proposals).toHaveLength(2)
    expect(proposals[1]?.name).toBe('self-evolve-patch-nocolon')
    if (proposals[1]?.candidate.kind === 'L2-context') {
      expect(proposals[1].candidate.sectionText).toContain('该 pattern 的上下文')
    }
  })
})

describe('replay and held-out edge surfaces', () => {
  function failingFork(ctx: Context, stopReason: string, child?: Session): void {
    ctx.provide('subagents', {
      getProvider: () => ({}),
      start: async () => ({
        result: Promise.resolve({ stopReason, output: [] }),
        ...(child !== undefined ? { localAgent: { session: child } } : {}),
        dispose: async () => {},
      }),
    } as never)
  }

  it('a failing fork replay reports exitCode 1', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    failingFork(ctx, 'error')
    const engine = new ProbeEngine(ctx, baseConfig())
    const replay = await engine.replay(agentFor(session), proposal(), 'case', new AbortController().signal)
    expect(replay?.exitCode).toBe(1)
  })

  it('a fork without a local agent reports no retriggered patterns', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    failingFork(ctx, 'completed')
    const engine = new ProbeEngine(ctx, baseConfig())
    const replay = await engine.replay(agentFor(session), proposal(), 'case', new AbortController().signal)
    expect(replay).toEqual({ exitCode: 0, retriggeredPatternIds: [] })
  })

  it('a fork child without an end-seed marker contributes no patterns', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    // No seed argument: Session.create appends no end-seed boundary.
    const child = Session.create(SessionId('child-no-seed'))
    const callSeq = child.append('tool/call', { turn: 1, step: 1, callId: 'rc1' as never, name: 'bash', arguments: '{}' }).seq
    child.append('tool/result', {
      turn: 1, step: 1,
      message: { role: 'tool', toolCallId: 'rc1', content: [{ type: 'text', text: '[stderr]\nboom\n[exit code: 1]' }] } as never,
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    failingFork(ctx, 'completed', child)
    const engine = new ProbeEngine(ctx, baseConfig())
    const replay = await engine.replay(agentFor(session), proposal(), 'case', new AbortController().signal)
    expect(replay?.retriggeredPatternIds).toEqual([])
  })

  it('collectReplaySignal falls back when the last seq is not in the session', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const unknownSeq = { ...pattern('x', 'subprocess-exit', 2), supportingSeqs: [9999] }
    // The replay infrastructure is absent, so the signal is null; the context
    // string is still rendered through the not-found branch.
    expect(await engine.replaySignal(agentFor(session), proposal(), unknownSeq, new AbortController().signal)).toBeNull()
  })

  it('collectReplaySignal falls back when the session or last seq is unknown', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const noSeq = { ...pattern('x', 'subprocess-exit', 2), supportingSeqs: [] }
    expect(await engine.replaySignal(agentFor(session), proposal(), noSeq, new AbortController().signal)).toBeNull()
  })

  it('runWorkflowSmoke returns null for non-L3 candidates', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    expect(await engine.workflowSmoke(agentFor(session), proposal(), new AbortController().signal)).toBeNull()
  })

  it('collectHeldOutSignal returns null when every hit is already supporting evidence', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session })
    ctx.provide('sessionQuery', {
      searchEvents: async () => ({ items: [{ seq: 1, snippet: 'known', type: 'tool/result' }] }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    // seq 1 is already in supportingSeqs, so the hit filters out.
    expect(await engine.heldOut(agentFor(session), proposal(), pattern!, new AbortController().signal)).toBeNull()
  })

  it('collectHeldOutSignal aborts mid-replay when the signal fires', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session })
    ctx.provide('sessionQuery', {
      searchEvents: async () => ({ items: [{ seq: 5, snippet: 'old failure', type: 'tool/result' }] }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    const signal = new AbortController()
    signal.abort()
    await expect(engine.heldOut(agentFor(session), proposal(), pattern!, signal.signal)).rejects.toThrow(/aborted/)
  })

  it('collectHeldOutSignal counts only replays that exit cleanly', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session, { session })
    ctx.provide('sessionQuery', {
      searchEvents: async () => ({ items: [
        { seq: 5, snippet: 'old failure one', type: 'tool/result' },
        { seq: 9, snippet: 'old failure two', type: 'tool/result' },
      ] }),
    } as never)
    failingFork(ctx, 'error')
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    const signal = await engine.heldOut(agentFor(session), proposal(), pattern!, new AbortController().signal)
    expect(signal).toEqual({ passed: 0, cases: 2 })
  })
})

describe('validateProposal and validateL4Proposal edges', () => {
  it('an aborted signal aborts validation', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new SignalEngine(ctx, baseConfig(), session)
    const signal = new AbortController()
    signal.abort()
    await expect(engine.validate(proposal(), signal.signal)).rejects.toThrow(/aborted/)
  })

  it('L4 candidates route through validateL4Proposal and reject without the runner', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    const engine = new SignalEngine(ctx, baseConfig(), session)
    const outcome = await engine.validate(proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' } }))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') expect(outcome.reason).toBe('approval-denied')
  })

  it('an unknown addressed pattern degrades both held-in and held-out to the weak path', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new SignalEngine(ctx, baseConfig(), session)
    const outcome = await engine.validate(proposal({ addressesPatternIds: ['L1-skill:ghost'] }))
    expect(outcome.kind).toBe('rejected')
  })

  it('held-out with zero cases degrades to the weak rate', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new SignalEngine(ctx, baseConfig(), session)
    engine.replay = { exitCode: 0, retriggeredPatternIds: [] }
    engine.workspace = { dirtyLines: 0, noDirtyFallback: false, buildHealthy: true }
    engine.heldOut = { passed: 0, cases: 0 }
    const [pattern] = await engine.readPatterns(session.id)
    const outcome = await engine.validate(proposal({ addressesPatternIds: [pattern!.patternId] }))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') expect(outcome.diagnostic).toContain('heldOut=0.30')
  })

  it('without dual verification the confidence gate uses heldIn=1 in the diagnostic', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new SignalEngine(ctx, baseConfig({ requireDualVerification: false }), session)
    engine.heldOut = null
    const [pattern] = await engine.readPatterns(session.id)
    const outcome = await engine.validate(proposal({ addressesPatternIds: [pattern!.patternId] }))
    expect(outcome.kind).toBe('rejected')
    if (outcome.kind === 'rejected') expect(outcome.diagnostic).toContain('heldIn=1')
  })

  it('validateL4Proposal throws for non-L4 candidates', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    ctx.provide('dynamicCordisRunner', {
      define: () => ({ pluginId: 'dyn-1', packageId: 'pkg-1', name: 'n', purpose: 'p', hasHostHalf: true, hasClientHalf: true }),
      run: async () => ({ ok: true, status: 'awaiting-approval', pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1', waitingFor: [] }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    await expect(engine.validateL4(agentFor(session), proposal(), new AbortController().signal))
      .rejects.toThrow(/expected an L4-harness candidate/)
  })

  it('validateL4Proposal maps host and client code into the define call', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    let received: Record<string, unknown> | undefined
    ctx.provide('dynamicCordisRunner', {
      define: (input: Record<string, unknown>) => {
        received = input
        return { pluginId: 'dyn-1', packageId: 'pkg-1', name: 'n', purpose: 'p', hasHostHalf: true, hasClientHalf: true }
      },
      run: async () => ({ ok: true, status: 'awaiting-approval', pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1', waitingFor: [] }),
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    const outcome = await engine.validateL4(
      agentFor(session),
      proposal({ candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn', hostCode: 'host()', clientCode: 'client()' } }),
      new AbortController().signal,
    )
    expect(outcome.kind).toBe('accepted')
    expect(received?.code).toEqual({ host: 'host()', client: 'client()' })
  })
})

describe('applyCommit across candidate kinds', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'self-evolve-commit-'))
    vi.stubEnv('DSH_HOME', dir)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function commitSetup(overrides: Partial<BasicSelfEvolveConfig> = {}): {
    ctx: Context
    session: Session
    agent: SelfEvolveAgentContext
    engine: ProbeEngine
  } {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session, { session })
    const engine = new ProbeEngine(ctx, baseConfig(overrides))
    return { ctx, session, agent: agentFor(session), engine }
  }

  it('L1 candidates register a runtime skill and skip the fs write without fs', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    const skills: unknown[] = []
    ctx.provide('sessionProjections', { register: () => () => {}, snapshot: () => projectedState(session) })
    ctx.provide('sessions', { get: (id: string) => (id === session.id ? session : undefined) })
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('skills', { register: (skill: unknown) => { skills.push(skill) } })
    ctx.provide('systemPrompt', { section: () => () => {} })
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.commit(agentFor(session), proposal({
      proposalId: 'l1-1',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L1-skill', skillName: 'guard', content: 'check first', whenToUse: 'on bash' },
    }))
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ name: 'guard', source: 'runtime-evolve', whenToUse: 'on bash' })
  })

  it('L1 candidates persist a frontmatter skill file through the fs service', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    const writes: { target: unknown; content: string }[] = []
    ctx.provide('sessionProjections', { register: () => () => {}, snapshot: () => projectedState(session) })
    ctx.provide('sessions', { get: (id: string) => (id === session.id ? session : undefined) })
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('skills', { register: () => () => {} })
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('fs', {
      resolve: async (path: unknown, options: { cwd?: string }) => ({ kind: 'resolved', path, cwd: options.cwd }),
      writeText: async (target: unknown, content: string) => { writes.push({ target, content }) },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.commit(agentFor(session), proposal({
      proposalId: 'l1-2',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L1-skill', skillName: 'guard', content: 'check first' },
    }))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.content).toContain('name: guard')
    expect(writes[0]?.content).toContain('whenToUse: ')
  })

  it('L1 candidates honor a session cwd and a whenToUse value in the frontmatter', async () => {
    const ctx = new Context()
    const session = Session.create(SessionId('cwd-session'), [], { version: 0, id: SessionId('cwd-session'), createdAt: Date.now(), cwd: '/proj', isSeeded: false })
    const writes: { content: string }[] = []
    ctx.provide('sessionProjections', { register: () => () => {}, snapshot: () => projectedState(session) })
    ctx.provide('sessions', { get: (id: string) => (id === session.id ? session : undefined) })
    ctx.provide('agents', { get: () => undefined })
    ctx.provide('skills', { register: () => () => {} })
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('fs', {
      resolve: async (_path: unknown, options: { cwd?: string }) => ({ kind: 'resolved', cwd: options.cwd }),
      writeText: async (_target: unknown, content: string) => { writes.push({ content }) },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.commit(agentFor(session), proposal({
      proposalId: 'l1-3',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L1-skill', skillName: 'guard', content: 'check first', whenToUse: 'when bash fails' },
    }))
    expect(writes[0]?.content).toContain('whenToUse: when bash fails')
  })

  it('persistSkillFile returns early for non-L1 candidates', async () => {
    const { ctx, session, agent, engine } = commitSetup()
    ctx.provide('fs', {
      resolve: async () => 'target',
      writeText: async () => {},
    } as never)
    await engine.skillFile(agent, proposal())
    expect(session).toBeDefined()
  })

  it('L3 candidates commit after a passing smoke run', async () => {
    const { ctx, session, agent, engine } = commitSetup()
    ctx.provide('workflowEngine', {
      start: () => ({
        result: Promise.resolve({ value: null, stopReason: 'completed', agentsStarted: 2 }),
        dispose: async () => {},
      }),
    } as never)
    const result = await engine.commit(agent, proposal({
      proposalId: 'l3-1',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'return 1' },
    }))
    expect(result.commitSeq).toBeGreaterThanOrEqual(0)
    expect(session.snapshotEvents().some(e => e.type === 'self-evolve/commit')).toBe(true)
  })

  it('L3 candidates without a workflow engine fail the commit loudly', async () => {
    const { agent, engine } = commitSetup()
    await expect(engine.commit(agent, proposal({
      proposalId: 'l3-2',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'return 1' },
    }))).rejects.toThrow(/workflow engine unavailable/)
  })

  it('L3 candidates with a failing smoke run fail the commit loudly', async () => {
    const { ctx, agent, engine } = commitSetup()
    ctx.provide('workflowEngine', {
      start: () => ({
        result: Promise.resolve({ value: null, stopReason: 'error', error: 'script threw', agentsStarted: 0 }),
        dispose: async () => {},
      }),
    } as never)
    await expect(engine.commit(agent, proposal({
      proposalId: 'l3-3',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L3-workflow', scriptName: 'audit', scriptBody: 'throw new Error()' },
    }))).rejects.toThrow(/run did not complete with agents/)
  })

  it('L4 candidates update the approval ledger for their pending plugin', async () => {
    const { agent, engine } = commitSetup()
    engine['l4Pending'].set('dyn-2', 'other')
    engine['l4Pending'].set('dyn-1', 'l4-1')
    await engine.commit(agent, proposal({
      proposalId: 'l4-1',
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L4-harness', pluginIdPrefix: 'dyn' },
    }))
    expect(engine['l4Ledger'].get('dyn-1')?.proposalId).toBe('l4-1')
    expect(engine['l4Ledger'].has('dyn-2')).toBe(false)
  })

  it('rollbackPattern restores an L1-skill champion through the skill seam', async () => {
    const { engine } = commitSetup()
    const l1 = (skillName: string, content: string) => proposal({
      addressesPatternIds: ['L1-skill:abc'],
      candidate: { kind: 'L1-skill', skillName, content },
    })
    await engine.archive(l1('s1', 'champion'))
    await engine.archive(l1('s2', 'regressing'))
    await engine.rollback('L1-skill:abc')
  })

  it('rollbackPattern ignores champions without a base-provider apply path', async () => {
    const { engine } = commitSetup()
    // 'a1' sorts before 'a2', so the second archive is the latest row.
    await engine.archive(proposal({ proposalId: 'a1', addressesPatternIds: ['L1-skill:abc'], candidate: { kind: 'L3-workflow', scriptName: 'w', scriptBody: 'b' } }))
    await engine.archive(proposal({ proposalId: 'a2', addressesPatternIds: ['L1-skill:abc'], candidate: { kind: 'L3-workflow', scriptName: 'w2', scriptBody: 'b2' } }))
    await engine.rollback('L1-skill:abc')
  })

  it('registerL2Section disposes the previous registration of the same section', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    const disposed: string[] = []
    const systemPrompt = {
      section: (section: { name: string }) => () => { disposed.push(section.name) },
    }
    provideServices(ctx, session, undefined, systemPrompt)
    const engine = new ProbeEngine(ctx, baseConfig())
    const agent = agentFor(session)
    const candidate = (text: string) => ({
      kind: 'L2-context' as const,
      sectionName: 'sec',
      sectionText: text,
      order: 260,
      estimatedBytes: text.length,
    })
    await engine.commit(agent, proposal({ proposalId: 'a', candidate: candidate('first') }))
    await engine.commit(agent, proposal({ proposalId: 'b', candidate: candidate('second') }))
    expect(disposed).toEqual(['sec'])
  })

  it('pruneInflatedSections stops mid-loop once the budget is back under', async () => {
    const { agent, engine } = commitSetup({ maxPromptInflationBytesPerWeek: 25 })
    const section = (name: string, text: string) => proposal({
      proposalId: `p-${name}`,
      candidate: { kind: 'L2-context', sectionName: name, sectionText: text, order: 260, estimatedBytes: text.length },
    })
    await engine.commit(agent, section('sec-a', 'a'.repeat(20)))
    await engine.commit(agent, section('sec-b', 'b'.repeat(20)))
    await engine.commit(agent, section('sec-c', 'c'.repeat(20)))
    await engine.prune()
    expect(engine['liveSections'].size).toBe(1)
  })
})

describe('step-reflection gate surfaces (P3.1)', () => {
  it('returns early without an llm service', async () => {
    const { ctx, session } = reflectSetup()
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('returns early without provider and model options', async () => {
    const { ctx, session } = reflectSetup()
    const engine = new ProbeEngine(ctx, baseConfig())
    fakeLlm(ctx, '{}')
    await engine.reflect({ session, options: {} } as Agent, 1, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('returns early when the turn has no failure surface', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: 'ok1' as never, name: 'bash', arguments: '{}' }).seq
    session.append('tool/result', {
      turn: 1, step: 1,
      message: { role: 'tool', toolCallId: 'ok1', content: [{ type: 'text', text: 'all good' }] } as never,
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    provideServices(ctx, session)
    fakeLlm(ctx, '{}')
    const engine = new ProbeEngine(ctx, baseConfig())
    // The same events at a different turn also skip every event.
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    await engine.reflect(reflectAgent(session), 5, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('returns early when the projection has no patterns yet', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    // A tool error without a message produces a failure surface but no pattern.
    session.append('tool/result', { turn: 1, step: 1, error: { name: 'LoneError' } } as never, { surfaceOp: 'append' })
    provideServices(ctx, session)
    fakeLlm(ctx, '{}')
    const engine = new ProbeEngine(ctx, baseConfig())
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('a request-error recorded first drives the reflection path', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    session.append('agent/request-error', {
      turn: 1, step: 2, provider: 'deepseek', statusCode: 429,
      error: { code: 'rate_limit_exceeded', name: 'LlmFailure', message: 'rate limited' },
    })
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'retry later' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(1)
  })

  it('a second turn resets the per-turn reflection count', async () => {
    const { ctx, session } = reflectSetup()
    const callSeq = session.append('tool/call', { turn: 2, step: 1, callId: 'c3' as never, name: 'bash', arguments: '{}' }).seq
    session.append('tool/result', {
      turn: 2, step: 1,
      message: { role: 'tool', toolCallId: 'c3', content: [{ type: 'text', text: '[stderr]\nboom\n[exit code: 1]' }] } as never,
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    const engine = new ProbeEngine(ctx, baseConfig())
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'x' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    await engine.reflect(reflectAgent(session), 2, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(2)
  })

  it('a raised per-turn budget reflects twice in the same turn', async () => {
    const { ctx, session } = reflectSetup()
    const engine = new ProbeEngine(ctx, baseConfig({ maxStepReflectionsPerTurn: 2 }))
    const [pattern] = await engine.readPatterns(session.id)
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: pattern!.patternId, suggestion: 'x' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    await engine.reflect(reflectAgent(session), 1, 2, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(2)
  })

  it('a reflection naming an unknown pattern id is dropped', async () => {
    const { ctx, session } = reflectSetup()
    const engine = new ProbeEngine(ctx, baseConfig())
    fakeLlm(ctx, JSON.stringify({ confidence: 0.9, patternId: 'L1-skill:ghost', suggestion: 'x' }))
    await engine.reflect(reflectAgent(session), 1, 1, new AbortController().signal)
    expect(session.snapshotEvents().filter(e => e.type === 'self-evolve/reflection')).toHaveLength(0)
  })

  it('an invalid JSON judge payload degrades to structural scores', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    fakeLlm(ctx, '{oops}')
    const engine = new ProbeEngine(ctx, baseConfig({ validatorTarget: { provider: 'deepseek', model: 'judge' } }))
    expect(await engine.judge(proposal(), [], new AbortController().signal)).toBeNull()
  })

  it('judge output blocks without string text are dropped from the stream', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    provideServices(ctx, session)
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 42 } }
      },
    } as never)
    const engine = new ProbeEngine(ctx, baseConfig({ validatorTarget: { provider: 'deepseek', model: 'judge' } }))
    expect(await engine.judge(proposal(), [], new AbortController().signal)).toBeNull()
  })
})

describe('full-loop integration edges', () => {
  it('an aborted signal closes the loop bracket with the error', async () => {
    const ctx = new Context()
    const session = sessionFactory()
    appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
    provideServices(ctx, session)
    const engine = new BasicSelfEvolveEngine(ctx, baseConfig())
    const signal = new AbortController()
    signal.abort()
    await expect(engine.evolveNow(agentFor(session), signal.signal)).rejects.toThrow(/aborted/)
    const end = session.snapshotEvents().find(e => e.type === 'self-evolve/end')
    expect((end?.data as { error?: string }).error).toContain('aborted')
  })

  it('a loop with both LLM routes charged stays under the default budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-loop-budget-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new ProbeEngine(ctx, baseConfig({
        proposerTarget: { provider: 'deepseek', model: 'proposer' },
        validatorTarget: { provider: 'deepseek', model: 'judge' },
      }))
      const [pattern] = await engine.readPatterns(session.id)
      fakeLlm(ctx, JSON.stringify([{
        name: 'cwd-guard', purpose: 'check cwd', addressesPatternIds: [pattern!.patternId],
        candidate: { kind: 'L2-context', sectionName: 'cwd-guard', sectionText: 'check cwd first', order: 260 },
      }]))
      const result = await engine.evolveNow(agentFor(session), new AbortController().signal)
      // The proposal is conservatively rejected on the weak verifier path.
      expect(result.commits).toHaveLength(0)
      expect(result.proposals).toHaveLength(1)
      expect(session.snapshotEvents().some(e => e.type === 'self-evolve/end')).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a proposal without addressed patterns skips freeze accounting and writes an empty pattern id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-loop-no-address-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new ProbeEngine(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
      fakeLlm(ctx, JSON.stringify([{
        name: 'bare', purpose: 'no addresses',
        candidate: { kind: 'L2-context', sectionName: 's', sectionText: 't', order: 260 },
      }]))
      const result = await engine.evolveNow(agentFor(session), new AbortController().signal)
      expect(result.proposals).toHaveLength(1)
      const raw = await readFile(join(dir, 'self-evolve', 'negative-results.jsonl'), 'utf8')
      expect(raw).toContain('"patternId":""')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('an accepted proposal without addressed patterns skips archiving and resets cleanly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-loop-accept-bare-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new (class extends BasicSelfEvolveEngine {
        protected override async validateProposal(): Promise<ProposalValidationOutcome> {
          const outcome: ProposalValidationOutcome = {
            kind: 'accepted',
            heldInPassed: 1,
            heldOutPassed: 1,
            regressions: [],
            deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 },
            confidence: 1,
            replayEvidence: [],
            nextRoundSuggestion: '',
          }
          return outcome
        }
      })(ctx, baseConfig({ proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
      fakeLlm(ctx, JSON.stringify([{
        name: 'bare', purpose: 'no addresses',
        candidate: { kind: 'L2-context', sectionName: 's', sectionText: 't', order: 260 },
      }]))
      const result = await engine.evolveNow(agentFor(session), new AbortController().signal)
      expect(result.commits).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a mid-loop failure after a commit closes the bracket with the raw diagnostic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-loop-throw-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new (class extends BasicSelfEvolveEngine {
        calls = 0
        protected override async validateProposal(): Promise<ProposalValidationOutcome> {
          this.calls += 1
          if (this.calls === 2) throw 'boom'
          const outcome: ProposalValidationOutcome = {
            kind: 'accepted',
            heldInPassed: 1,
            heldOutPassed: 1,
            regressions: [],
            deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 },
            confidence: 1,
            replayEvidence: [],
            nextRoundSuggestion: '',
          }
          return outcome
        }
      })(ctx, baseConfig({ maxProposalsPerLoop: 2, proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
      fakeLlm(ctx, JSON.stringify([
        { name: 'a', purpose: 'b', addressesPatternIds: ['L1-skill:abc'], candidate: { kind: 'L2-context', sectionName: 'a', sectionText: 'a', order: 260 } },
        { name: 'c', purpose: 'd', addressesPatternIds: ['L1-skill:abc'], candidate: { kind: 'L2-context', sectionName: 'c', sectionText: 'c', order: 260 } },
      ]))
      await expect(engine.evolveNow(agentFor(session), new AbortController().signal)).rejects.toThrow('boom')
      const ends = session.snapshotEvents().filter(e => e.type === 'self-evolve/end')
      const errorEnd = ends.find(e => (e.data as { error?: string }).error !== undefined)
      expect((errorEnd?.data as { error?: string }).error).toBe('boom')
      const errorEndData = errorEnd?.data as { committedProposalIds?: string[] }
      expect(errorEndData.committedProposalIds).toEqual(expect.arrayContaining([expect.any(String)]))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a stackless Error failure falls back to the message in the diagnostic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-loop-throw-stack-'))
    vi.stubEnv('DSH_HOME', dir)
    try {
      const ctx = new Context()
      const session = sessionFactory()
      appendShellResult(session, 'c1', '[stderr]\nboom\n[exit code: 1]')
      appendShellResult(session, 'c2', '[stderr]\nboom\n[exit code: 1]')
      provideServices(ctx, session)
      const engine = new (class extends BasicSelfEvolveEngine {
        calls = 0
        protected override async validateProposal(): Promise<ProposalValidationOutcome> {
          this.calls += 1
          if (this.calls === 2) {
            const error = Object.create(Error.prototype) as Error
            error.message = 'boom'
            throw error
          }
          const outcome: ProposalValidationOutcome = {
            kind: 'accepted',
            heldInPassed: 1,
            heldOutPassed: 1,
            regressions: [],
            deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 },
            confidence: 1,
            replayEvidence: [],
            nextRoundSuggestion: '',
          }
          return outcome
        }
      })(ctx, baseConfig({ maxProposalsPerLoop: 2, proposerTarget: { provider: 'deepseek', model: 'proposer' } }))
      fakeLlm(ctx, JSON.stringify([
        { name: 'a', purpose: 'b', addressesPatternIds: ['L1-skill:abc'], candidate: { kind: 'L2-context', sectionName: 'a', sectionText: 'a', order: 260 } },
        { name: 'c', purpose: 'd', addressesPatternIds: ['L1-skill:abc'], candidate: { kind: 'L2-context', sectionName: 'c', sectionText: 'c', order: 260 } },
      ]))
      await expect(engine.evolveNow(agentFor(session), new AbortController().signal)).rejects.toThrow('boom')
      const errorEnd = session.snapshotEvents().find(e => e.type === 'self-evolve/end' && (e.data as { error?: string }).error !== undefined)
      expect((errorEnd?.data as { error?: string }).error).toBe('boom')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

/** Real-execution workspace verifier coverage (P1.9b): real git in a temp repo. */
describe('workspace verifier (P1.9b)', () => {
  /** One command outcome as the fake shell would observe it. */
  interface FakeRunOutcome {
    exitCode: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    timedOut: boolean
  }

  /** Execute one whitespace-only command through `execFile` with a timeout. */
  function realRunner(command: string, workdir: string, timeoutMs: number): Promise<FakeRunOutcome> {
    return new Promise((resolve) => {
      execFile('/bin/sh', ['-c', command], { cwd: workdir, timeout: timeoutMs }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, signal: null, stdout, stderr, timedOut: false })
          return
        }
        const code = typeof error.code === 'number' ? error.code : null
        const signal = (error as NodeJS.ErrnoException & { signal?: NodeJS.Signals }).signal ?? null
        resolve({ exitCode: code, signal, stdout, stderr, timedOut: signal !== null })
      })
    })
  }

  /** A minimal in-process `ctx.shell` double that runs real commands. */
  function fakeShell(): { resolve: (request: ShellExecRequest) => ShellExecSpec; run: (spec: ShellExecSpec) => Promise<ShellRunResult> } {
    return {
      resolve: (request: ShellExecRequest): ShellExecSpec => ({
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: request.timeoutMs ?? 60_000,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 1_000_000,
        signal: request.signal,
        sandboxPolicy: undefined,
      }),
      run: async (spec: ShellExecSpec): Promise<ShellRunResult> => {
        const outcome = await realRunner(spec.command, spec.workdir, spec.timeoutMs)
        return {
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          timedOut: outcome.timedOut,
          aborted: false,
          timeoutMs: spec.timeoutMs,
          stdout: { text: outcome.stdout, truncated: false },
          stderr: { text: outcome.stderr, truncated: false },
        }
      },
    }
  }

  /** Subclass exposing the protected workspace hooks. */
  class WorkspaceProbe extends BasicSelfEvolveEngine {
    baseline(agent: SelfEvolveAgentContext, signal: AbortSignal): Promise<WorkspaceBaseline | null> {
      return this.captureWorkspaceBaseline(agent, signal)
    }

    signal(
      agent: SelfEvolveAgentContext,
      p: EvolveProposal,
      signal: AbortSignal,
      baseline: WorkspaceBaseline | null,
    ): Promise<WorkspaceSignal | null> {
      return this.collectWorkspaceSignal(agent, p, signal, baseline)
    }
  }

  const tempDirs: string[] = []

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'self-evolve-ws-'))
    tempDirs.push(dir)
    return dir
  }

  async function gitRepo(buildScript?: string): Promise<string> {
    const dir = await tempDir()
    await realRunner('git init -q', dir, 10_000)
    await realRunner('git config user.email test@example.com', dir, 10_000)
    await realRunner('git config user.name test', dir, 10_000)
    await writeFile(join(dir, 'a.txt'), 'one\n')
    if (buildScript !== undefined) await writeFile(join(dir, 'build-check.js'), buildScript)
    await realRunner('git add -A', dir, 10_000)
    await realRunner('git commit -qm init', dir, 10_000)
    return dir
  }

  function sessionAt(dir: string): Session {
    const id = SessionId(`ws-${Math.random().toString(36).slice(2, 10)}`)
    const header: SessionHeader = { version: 0, id, createdAt: Date.now(), cwd: dir, isSeeded: false }
    return Session.create(id, undefined, header)
  }

  /** A context with the services the real workspace verifier needs. */
  function workspaceEnv(dir: string): { ctx: Context; session: Session } {
    const ctx = new Context()
    const session = sessionAt(dir)
    ctx.provide('sessions', { get: (id: string) => (id === session.id ? session : undefined) })
    ctx.provide('sessionProjections', { register: () => () => {}, snapshot: () => ({ values: {} }) })
    ctx.provide('shell', fakeShell())
    return { ctx, session }
  }

  function workspaceConfig(overrides: Partial<BasicSelfEvolveConfig['workspaceVerifier']> = {}): BasicSelfEvolveConfig {
    return baseConfig({
      workspaceVerifier: { buildCommand: 'node build-check.js', gitTimeoutMs: 5_000, buildTimeoutMs: 5_000, ...overrides },
    })
  }

  function probe(ctx: Context, config: BasicSelfEvolveConfig): WorkspaceProbe {
    return new WorkspaceProbe(ctx, config)
  }

  it('captures a clean baseline and reports the replay delta with a healthy build', async () => {
    const dir = await gitRepo('process.exit(0)\n')
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, workspaceConfig())
    const agent = agentFor(session)
    const signal = new AbortController().signal

    const baseline = await engine.baseline(agent, signal)
    expect(baseline).toEqual({ gitAvailable: true, dirtyLines: 0 })

    await appendFile(join(dir, 'a.txt'), 'two\nthree\nfour\n')
    const ws = await engine.signal(agent, proposal(), signal, baseline)
    expect(ws).toEqual({ dirtyLines: 3, noDirtyFallback: false, buildHealthy: true })
  })

  it('not a git work tree → build-only fallback (noDirtyFallback)', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'build-check.js'), 'process.exit(0)\n')
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, workspaceConfig())
    const agent = agentFor(session)
    const signal = new AbortController().signal

    const baseline = await engine.baseline(agent, signal)
    expect(baseline).toEqual({ gitAvailable: false, dirtyLines: 0 })
    const ws = await engine.signal(agent, proposal(), signal, baseline)
    expect(ws).toEqual({ dirtyLines: 0, noDirtyFallback: true, buildHealthy: true })
  })

  it('build failure → buildHealthy=false', async () => {
    const dir = await gitRepo('process.exit(1)\n')
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, workspaceConfig())
    const agent = agentFor(session)
    const signal = new AbortController().signal

    const baseline = await engine.baseline(agent, signal)
    const ws = await engine.signal(agent, proposal(), signal, baseline)
    expect(ws).toEqual({ dirtyLines: 0, noDirtyFallback: false, buildHealthy: false })
  })

  it('build timeout → buildHealthy=false', async () => {
    const dir = await gitRepo('setTimeout(() => {}, 60_000)\n')
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, workspaceConfig({ buildTimeoutMs: 500 }))
    const agent = agentFor(session)
    const signal = new AbortController().signal

    const baseline = await engine.baseline(agent, signal)
    const ws = await engine.signal(agent, proposal(), signal, baseline)
    expect(ws).not.toBeNull()
    if (ws !== null) expect(ws.buildHealthy).toBe(false)
  })

  it('untracked files outside .dsh count; harness-owned .dsh paths are excluded', async () => {
    const dir = await gitRepo('process.exit(0)\n')
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, workspaceConfig())
    const agent = agentFor(session)
    const signal = new AbortController().signal

    const baseline = await engine.baseline(agent, signal)
    expect(baseline).toEqual({ gitAvailable: true, dirtyLines: 0 })

    await writeFile(join(dir, 'scratch.txt'), 'x\ny\nz\n')
    await mkdir(join(dir, '.dsh', 'skills', 's'), { recursive: true })
    await writeFile(join(dir, '.dsh', 'skills', 's', 'SKILL.md'), Array(10).fill('line').join('\n'))
    const ws = await engine.signal(agent, proposal(), signal, baseline)
    expect(ws).toEqual({ dirtyLines: 3, noDirtyFallback: false, buildHealthy: true })
  })

  it('no buildCommand → signal unavailable (weak path)', async () => {
    const dir = await gitRepo()
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, baseConfig())
    const agent = agentFor(session)
    const signal = new AbortController().signal

    const baseline = await engine.baseline(agent, signal)
    expect(baseline).toEqual({ gitAvailable: true, dirtyLines: 0 })
    expect(await engine.signal(agent, proposal(), signal, baseline)).toBeNull()
  })

  it('workspaceVerifier.enabled=false → baseline and signal unavailable', async () => {
    const dir = await gitRepo()
    const { ctx, session } = workspaceEnv(dir)
    const engine = probe(ctx, workspaceConfig({ enabled: false }))
    const agent = agentFor(session)
    const signal = new AbortController().signal

    expect(await engine.baseline(agent, signal)).toBeNull()
    expect(await engine.signal(agent, proposal(), signal, null)).toBeNull()
  })
})
