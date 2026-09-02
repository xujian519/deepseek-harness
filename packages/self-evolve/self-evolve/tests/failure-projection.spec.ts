import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  FAILURE_PATTERNS_PROJECTION_KEY,
  extractText,
  failurePatternsProjectionDefinition,
  failurePatternsView,
  failurePatternsViewSchema,
  foldEvent,
  parseShellMarkers,
} from '../src/failure-projection.ts'
import type { FailurePatternsState } from '../src/failure-projection.ts'
import type { FailurePattern } from '../src/types.ts'

function sessionFactory(): Session {
  return Session.create(SessionId(`test-${Math.random().toString(36).slice(2, 10)}`))
}

const VERIFIER_TIERS = ['tool-runtime', 'subprocess-exit', 'llm-provider', 'agent-loop'] as const

const PATTERN_ZOD = z.object({
  patternId: z.string(),
  verifierTier: z.enum(VERIFIER_TIERS),
  causalSignature: z.string(),
  level: z.enum(['L1-skill', 'L2-context', 'L3-workflow', 'L4-harness']),
  summary: z.string(),
  supportingSeqs: z.array(z.number().int().nonnegative()),
  occurrences: z.number().int().positive(),
  verifierMeta: z.record(z.string(), z.unknown()).optional(),
}).strict()

const STATE_ZOD = z.object({
  patterns: z.record(z.string(), PATTERN_ZOD),
  discoveryOrder: z.array(z.string()),
  lastMinedSeq: z.number().int().nonnegative(),
  toolCalls: z.record(z.string(), z.object({ name: z.string(), seq: z.number().int().nonnegative() })),
}).strict()

/** Append one failed shell-style tool result (call + result pair). */
function appendShellResult(session: Session, callId: string, toolName: string, text: string, turn = 1, step = 1): void {
  const callSeq = session.append('tool/call', { turn, step, callId: callId as never, name: toolName, arguments: '{}' }).seq
  session.append('tool/result', {
    turn,
    step,
    message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] } as never,
  }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
}

function folded(session: Session, state = failurePatternsProjectionDefinition.init()): ReturnType<typeof foldEvent> {
  for (const event of session.snapshotEvents()) state = foldEvent(state, event)
  return state
}

function patternsOf(state: ReturnType<typeof foldEvent>): FailurePattern[] {
  return Object.values(state.patterns)
}

describe('SIG-1 FailurePattern round-trip & stateVersion', () => {
  it('stateVersion is bumped to 3', () => {
    expect(failurePatternsProjectionDefinition.stateVersion).toBe(3)
  })

  it('projection definition apply folds events', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', 'failing\n[exit code: 3]')
    let state: FailurePatternsState = failurePatternsProjectionDefinition.init()
    for (const event of session.snapshotEvents()) state = failurePatternsProjectionDefinition.apply(state, event)
    expect(state.discoveryOrder).toHaveLength(1)
  })

  it('projection definition schema parses a folded state', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', 'failing\n[exit code: 3]')
    let state: FailurePatternsState = failurePatternsProjectionDefinition.init()
    for (const event of session.snapshotEvents()) state = foldEvent(state, event)
    expect(state.discoveryOrder).toHaveLength(1)
    const parsed = STATE_ZOD.safeParse(state)
    expect(parsed.success).toBe(true)
    const json: unknown = JSON.parse(JSON.stringify(state))
    expect(STATE_ZOD.safeParse(json).success).toBe(true)
  })

  it('definition schema parses the view output (wire payload excludes fold-internal toolCalls)', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', 'failing\n[exit code: 3]')
    let state: FailurePatternsState = failurePatternsProjectionDefinition.init()
    for (const event of session.snapshotEvents()) state = failurePatternsProjectionDefinition.apply(state, event)
    const view = failurePatternsView(state)
    expect(view).not.toHaveProperty('toolCalls')
    expect(failurePatternsViewSchema.safeParse(view).success).toBe(true)
  })

  it('FailurePattern zod strict: extra fields reject, missing required fields reject', () => {
    const base = {
      patternId: 'L1-skill:abc12345',
      verifierTier: 'subprocess-exit' as const,
      causalSignature: 'exit=1:cmd not found',
      level: 'L1-skill' as const,
      summary: 'tool bash exit=1',
      supportingSeqs: [0],
      occurrences: 2,
    }
    expect(PATTERN_ZOD.safeParse(base).success).toBe(true)
    // missing verifierTier
    const { verifierTier: _vt, ...noTier } = base
    expect(PATTERN_ZOD.safeParse(noTier).success).toBe(false)
    // extra field
    expect(PATTERN_ZOD.safeParse({ ...base, _surprise: 1 }).success).toBe(false)
  })
})

describe('SIG-2 classifyFailure → patternId stability', () => {
  it('same (level + verifierTier + causalSignature) → same patternId, independent of stdout drift', () => {
    const s1 = sessionFactory()
    const s2 = sessionFactory()
    // Same stderr prefix and exit code, different stdout lines.
    appendShellResult(s1, 'c1', 'bash', 'stdout A\n[stderr]\nfoo bar baz\n[exit code: 1]')
    appendShellResult(s2, 'c1', 'bash', 'stdout B quite different\n[stderr]\nfoo bar baz\n[exit code: 1]')
    const id1 = patternsOf(folded(s1))[0]?.patternId
    const id2 = patternsOf(folded(s2))[0]?.patternId
    expect(id1).toBeDefined()
    expect(id1).toBe(id2)
  })

  it('bash/shell same exitCode 1 but different stderr → two different patternIds (fine-grained merge)', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', '[stderr]\nENOENT /usr/bin/a\n[exit code: 1]')
    appendShellResult(session, 'c2', 'bash', '[stderr]\nENOENT /usr/bin/b\n[exit code: 1]')
    const state = folded(session)
    expect(Object.keys(state.patterns)).toHaveLength(2)
    for (const p of patternsOf(state)) {
      expect(p.verifierTier).toBe('subprocess-exit')
      expect(p.occurrences).toBe(1)
    }
  })

  it('tool name comes from the paired tool/call identity', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', '[stderr]\nboom\n[exit code: 7]')
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.summary).toBe('tool bash exit=7')
    expect(pattern?.verifierMeta.tool).toBe('bash')
  })

  it('an unknown tool (no paired call) still classifies with a placeholder name', () => {
    const session = sessionFactory()
    const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' }).seq
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'orphan', content: [{ type: 'text', text: '[stderr]\nboom\n[exit code: 7]' }] } as never,
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.summary).toBe('tool unknown-tool exit=7')
  })

  it('an isError tool/result without shell markers classifies as the tool-runtime tier', () => {
    const session = sessionFactory()
    const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'read', arguments: '{}' }).seq
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'nope' }] } as never,
      error: { name: 'ReadDenied', code: 'DENIED' },
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.verifierTier).toBe('tool-runtime')
    expect(pattern?.causalSignature).toBe('ReadDenied')
    expect(pattern?.level).toBe('L1-skill')
  })

  it('an [exit code: 0] marker is a successful exit, not a failure', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', 'all good\n[exit code: 0]')
    expect(patternsOf(folded(session))).toHaveLength(0)
  })

  it('a killed-by-signal marker classifies as subprocess-exit', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', '[stderr]\nsleep\n[killed by signal: SIGKILL]')
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.verifierTier).toBe('subprocess-exit')
    expect(pattern?.causalSignature).toContain('signal=SIGKILL')
  })

  it('agent/request-error same provider but different error.code → different patternIds', () => {
    const session = sessionFactory()
    session.append('agent/request-error', { provider: 'deepseek', model: 'v3', error: { code: 'context_length_exceeded', name: 'ProviderError' }, statusCode: 400 })
    session.append('agent/request-error', { provider: 'deepseek', model: 'v3', error: { code: 'rate_limit_exceeded', name: 'ProviderError' }, statusCode: 429 })
    const state = folded(session)
    expect(Object.keys(state.patterns)).toHaveLength(2)
    for (const p of patternsOf(state)) {
      expect(p.verifierTier).toBe('llm-provider')
      expect(p.level).toBe('L2-context')
    }
  })

  it('compaction/end with an error classifies as L2-context tool-runtime; clean compaction folds nothing', () => {
    // compaction/end's CompactionId brand lives in @deepseek-ai/dsh-compaction,
    // outside this package's dependency graph, so the id is cast.
    const clean = sessionFactory()
    clean.append('compaction/end', { compactionId: 'x' as never, turn: 1 })
    expect(patternsOf(folded(clean))).toHaveLength(0)

    const failed = sessionFactory()
    failed.append('compaction/end', { compactionId: 'x' as never, turn: 1, error: 'OverflowError: boom' })
    const pattern = patternsOf(folded(failed))[0]
    expect(pattern?.verifierTier).toBe('tool-runtime')
    expect(pattern?.level).toBe('L2-context')
    expect(pattern?.causalSignature).toBe('OverflowError')
  })

  it('self-evolve/end with different error classes → different patternIds (agent-loop tier)', () => {
    const session = sessionFactory()
    session.append('self-evolve/end', {
      runId: `r-${Math.random().toString(36).slice(2, 8)}` as never,
      committedProposalIds: [],
      error: 'TimeoutError: loop hung',
      endedAt: Date.now(),
    })
    session.append('self-evolve/end', {
      runId: `r-${Math.random().toString(36).slice(2, 8)}` as never,
      committedProposalIds: [],
      error: 'AbortError: cancelled',
      endedAt: Date.now() + 1,
    })
    const state = folded(session)
    expect(Object.keys(state.patterns)).toHaveLength(2)
    for (const p of patternsOf(state)) expect(p.verifierTier).toBe('agent-loop')
  })
})

describe('SIG-3 SHA-1 hash cross-call stability (same causal signature → identical patternId)', () => {
  it('foldEvent produces identical patternId for same causalSignature across two independent session instances', () => {
    const build = () => {
      const session = sessionFactory()
      appendShellResult(session, 'c1', 'shell', '[stderr]\nERR! line 1 invalid token xyz\n[exit code: 7]')
      return patternsOf(folded(session))[0]?.patternId
    }
    const id1 = build()
    const id2 = build()
    expect(id1).toBeDefined()
    expect(id1).toBe(id2)
  })
})

describe('FAILURE_PATTERNS_PROJECTION_KEY constant', () => {
  it('matches projection definition key', () => {
    expect(failurePatternsProjectionDefinition.key).toBe(FAILURE_PATTERNS_PROJECTION_KEY)
    expect(FAILURE_PATTERNS_PROJECTION_KEY).toBe('failure-patterns')
  })
})

describe('P3.1 reflection folding', () => {
  it('a reflection event reinforces an existing pattern (occurrences +1)', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', '[stderr]\nboom\n[exit code: 1]')
    appendShellResult(session, 'c2', 'bash', '[stderr]\nboom\n[exit code: 1]')
    const [pattern] = patternsOf(folded(session))
    const before = pattern!.occurrences
    session.append('self-evolve/reflection', {
      turn: 1,
      step: 2,
      patternId: pattern!.patternId,
      confidence: 0.9,
      suggestion: 'check cwd first',
    })
    const [after] = patternsOf(folded(session))
    expect(after!.occurrences).toBe(before + 1)
  })

  it('a reflection for an unknown pattern id is ignored (no minting)', () => {
    const session = sessionFactory()
    session.append('self-evolve/reflection', {
      turn: 1,
      step: 1,
      patternId: 'L1-skill:ghost',
      confidence: 0.9,
      suggestion: 'x',
    })
    expect(patternsOf(folded(session))).toHaveLength(0)
  })
})

describe('extractText and parseShellMarkers edge surfaces', () => {
  it('extractText returns empty for non-array content', () => {
    expect(extractText('plain string')).toBe('')
    expect(extractText(undefined)).toBe('')
    expect(extractText(null)).toBe('')
  })

  it('extractText joins text blocks and skips non-text blocks', () => {
    expect(extractText([
      { type: 'image', url: 'x.png' },
      { type: 'text', text: 'hello' },
      { type: 'text', text: 42 },
      'bare string',
    ])).toBe('hello')
  })

  it('parseShellMarkers returns null when no trailing marker exists', () => {
    expect(parseShellMarkers('no markers here')).toBeNull()
    expect(parseShellMarkers('')).toBeNull()
  })
})

describe('classifier edge surfaces', () => {
  it('a tool/result without a message payload is not classified', () => {
    const session = sessionFactory()
    session.append('tool/result', { turn: 1, step: 1, error: { name: 'LoneError' } } as never, { surfaceOp: 'append' })
    expect(patternsOf(folded(session))).toHaveLength(0)
  })

  it('a tool/result with a null or non-object message is not classified', () => {
    const session = sessionFactory()
    session.append('tool/result', { turn: 1, step: 1, message: null, error: { name: 'LoneError' } } as never, { surfaceOp: 'append' })
    session.append('tool/result', { turn: 1, step: 1, message: 'bare', error: { name: 'LoneError' } } as never, { surfaceOp: 'append' })
    expect(patternsOf(folded(session))).toHaveLength(0)
  })

  it('an empty error name degrades to generic-error', () => {
    const session = sessionFactory()
    const callSeq = session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'read', arguments: '{}' }).seq
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'nope' }] } as never,
      error: { name: '', code: 'E_EMPTY' },
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('generic-error')
  })

  it('an error tool/result without a paired call names the tool unknown-tool', () => {
    const session = sessionFactory()
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: { role: 'tool', content: [{ type: 'text', text: 'nope' }] } as never,
      error: { name: 'ReadDenied', code: 'E_DENIED' },
    }, { surfaceOp: 'append' })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.summary).toBe('tool unknown-tool error: ReadDenied')
  })

  it('agent/request-error with only a numeric status uses the status as signature', () => {
    const session = sessionFactory()
    session.append('agent/request-error', { provider: 'deepseek', model: 'v3', error: {}, statusCode: 503 })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('503')
  })

  it('agent/request-error with only an error name uses the name as signature', () => {
    const session = sessionFactory()
    session.append('agent/request-error', { provider: 'deepseek', model: 'v3', error: { name: 'TimeoutError' } })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('TimeoutError')
  })

  it('agent/request-error with no usable fields degrades to unknown-request-error', () => {
    const session = sessionFactory()
    session.append('agent/request-error', { provider: 'deepseek', model: 'v3', error: {} })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('unknown-request-error')
  })

  it('compaction/end error text without a colon keeps the whole text as signature', () => {
    const session = sessionFactory()
    session.append('compaction/end', { compactionId: 'x' as never, turn: 1, error: 'overflow' })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('overflow')
  })

  it('compaction/end whitespace-only error degrades to compaction-error', () => {
    const session = sessionFactory()
    session.append('compaction/end', { compactionId: 'x' as never, turn: 1, error: '   ' })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('compaction-error')
  })

  it('self-evolve/end with a non-string error degrades to self-evolve-error', () => {
    const session = sessionFactory()
    session.append('self-evolve/end', { runId: 'r-1' as never, committedProposalIds: [], error: { message: 'boom' } as never, endedAt: Date.now() })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('self-evolve-error')
  })

  it('self-evolve/end with whitespace-only error degrades to self-evolve-error', () => {
    const session = sessionFactory()
    session.append('self-evolve/end', { runId: 'r-2' as never, committedProposalIds: [], error: '   ', endedAt: Date.now() })
    const pattern = patternsOf(folded(session))[0]
    expect(pattern?.causalSignature).toBe('self-evolve-error')
  })
})

describe('fold stability for repeated events', () => {
  it('re-folding the same failure event keeps supportingSeqs stable and bumps occurrences', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', '[stderr]\nboom\n[exit code: 1]')
    const resultEvent = session.snapshotEvents().at(-1)!
    const state = folded(session)
    expect(patternsOf(state)[0]?.supportingSeqs).toHaveLength(1)
    const [pattern] = patternsOf(foldEvent(state, resultEvent))
    expect(pattern!.occurrences).toBe(2)
    expect(pattern!.supportingSeqs).toHaveLength(1)
  })

  it('re-folding the same reflection event keeps supportingSeqs stable', () => {
    const session = sessionFactory()
    appendShellResult(session, 'c1', 'bash', '[stderr]\nboom\n[exit code: 1]')
    const [before] = patternsOf(folded(session))
    session.append('self-evolve/reflection', {
      turn: 1,
      step: 2,
      patternId: before!.patternId,
      confidence: 0.9,
      suggestion: 'x',
    })
    const reflectionEvent = session.snapshotEvents().at(-1)!
    const state = folded(session)
    const [after] = patternsOf(foldEvent(state, reflectionEvent))
    expect(after!.occurrences).toBe(before!.occurrences + 2)
    expect(after!.supportingSeqs).toEqual([...before!.supportingSeqs, reflectionEvent.seq])
  })

  it('a reflection with a non-string patternId is ignored', () => {
    const session = sessionFactory()
    session.append('self-evolve/reflection', { turn: 1, step: 1, patternId: 123, confidence: 0.9, suggestion: 'x' } as never)
    expect(patternsOf(folded(session))).toHaveLength(0)
  })
})

describe('tool-call identity folding', () => {
  it('a tool/call without a usable callId is ignored', () => {
    const session = sessionFactory()
    session.append('tool/call', { turn: 1, step: 1, callId: '' as never, name: 'bash', arguments: '{}' })
    const state = folded(session)
    expect(Object.keys(state.toolCalls)).toHaveLength(0)
  })

  it('a tool/call with an empty name degrades to unknown-tool', () => {
    const session = sessionFactory()
    session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: '', arguments: '{}' })
    const state = folded(session)
    expect(state.toolCalls['c1']?.name).toBe('unknown-tool')
  })

  it('re-folding the identical tool/call event returns the same state', () => {
    const session = sessionFactory()
    session.append('tool/call', { turn: 1, step: 1, callId: 'dup' as never, name: 'bash', arguments: '{}' })
    const event = session.snapshotEvents()[0]!
    const state = folded(session)
    expect(foldEvent(state, event)).toBe(state)
  })

  it('a reused callId with a different tool name re-registers the identity', () => {
    const session = sessionFactory()
    session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' })
    session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'git', arguments: '{}' })
    const state = folded(session)
    expect(state.toolCalls['c1']?.name).toBe('git')
  })

  it('a reused callId with a new seq re-registers the identity', () => {
    const session = sessionFactory()
    session.append('tool/call', { turn: 1, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' })
    session.append('tool/call', { turn: 2, step: 1, callId: 'c1' as never, name: 'bash', arguments: '{}' })
    const state = folded(session)
    expect(state.toolCalls['c1']?.seq).toBe(session.snapshotEvents()[1]!.seq)
  })

  it('tool-call identity tracking prunes the oldest entry past 64 calls', () => {
    const session = sessionFactory()
    for (let i = 0; i < 65; i += 1) {
      session.append('tool/call', { turn: 1, step: 1, callId: `c-${i}` as never, name: 'bash', arguments: '{}' })
    }
    const state = folded(session)
    expect(Object.keys(state.toolCalls)).toHaveLength(64)
    expect(state.toolCalls['c-0']).toBeUndefined()
    expect(state.toolCalls['c-64']?.name).toBe('bash')
  })
})
