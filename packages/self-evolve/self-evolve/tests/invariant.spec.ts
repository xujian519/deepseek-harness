import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SelfEvolveInvariant from '../src/invariant.ts'
import type { SelfEvolveRunId } from '../src/brand.ts'
import type { ProposalValidationOutcome } from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SelfEvolveInvariant)
  return ctx
}

function runId(seed: string): SelfEvolveRunId {
  return `run-${seed}` as never
}

function start(session: Session, id: SelfEvolveRunId): void {
  session.append('self-evolve/start', {
    runId: id,
    sessionId: SessionId('probe'),
    trigger: 'user-command',
    startedAt: Date.now(),
    levels: ['L1-skill', 'L2-context'],
    targeting: [],
  })
}

function propose(session: Session, id: SelfEvolveRunId, proposalId: string): void {
  session.append('self-evolve/proposed', {
    runId: id,
    proposal: { proposalId, runId: id } as never,
  })
}

function validate(session: Session, id: SelfEvolveRunId, proposalId: string, accepted = true): void {
  const outcome: ProposalValidationOutcome = accepted
    ? {
      kind: 'accepted',
      heldInPassed: 1,
      heldOutPassed: 1,
      regressions: [],
      deconstructedScores: { activatesWhenCorrect: 1, clarity: 1, noRegressionIntroduced: 1, safety: 1 },
      confidence: 1,
      replayEvidence: [],
      nextRoundSuggestion: '',
    }
    : {
      kind: 'rejected',
      reason: 'held-in-failed',
      regressions: [],
      diagnostic: 'nope',
      nextRoundSuggestion: 'again',
    }
  session.append('self-evolve/validated', { runId: id, proposalId, outcome })
}

function commit(session: Session, id: SelfEvolveRunId, proposalId: string): void {
  session.append('self-evolve/commit', {
    runId: id,
    commit: { proposal: { proposalId, runId: id } as never, validation: { kind: 'accepted' }, commitSeq: 0 } as never,
  })
}

function end(session: Session, id: SelfEvolveRunId, committedProposalIds: string[]): void {
  session.append('self-evolve/end', { runId: id, committedProposalIds, endedAt: Date.now() })
}

function fullBracket(session: Session, id: SelfEvolveRunId): void {
  start(session, id)
  session.append('self-evolve/mined', { runId: id, patterns: [], targeting: [] })
  propose(session, id, 'p1')
  validate(session, id, 'p1')
  commit(session, id, 'p1')
  end(session, id, ['p1'])
}

describe('self-evolve invariant brackets', () => {
  it('accepts a complete start → mined → proposed → validated → commit → end bracket', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => { fullBracket(session, runId('ok')) }).not.toThrow()
  })

  it('accepts a bracket that ends without commits', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    start(session, runId('empty'))
    session.append('self-evolve/mined', { runId: runId('empty'), patterns: [], targeting: [] })
    propose(session, runId('empty'), 'p1')
    validate(session, runId('empty'), 'p1', false)
    end(session, runId('empty'), [])
  })

  it('rejects mined without a matching start', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => session.append('self-evolve/mined', { runId: runId('orphan'), patterns: [], targeting: [] }))
      .toThrow(/without matching start/)
  })

  it('rejects end without a matching start', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => { end(session, runId('ghost'), []) }).toThrow(/without matching start/)
  })

  it('rejects commit of a proposal that was never validated as accepted', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    start(session, runId('skip'))
    propose(session, runId('skip'), 'p1')
    expect(() => { commit(session, runId('skip'), 'p1') }).toThrow(/was not validated as accepted/)
  })

  it('rejects validating the same proposal twice', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    start(session, runId('dup'))
    propose(session, runId('dup'), 'p1')
    validate(session, runId('dup'), 'p1')
    expect(() => { validate(session, runId('dup'), 'p1') }).toThrow(/already validated/)
  })

  it('rejects end listing a proposal that was never committed', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    start(session, runId('lie'))
    propose(session, runId('lie'), 'p1')
    validate(session, runId('lie'), 'p1')
    expect(() => { end(session, runId('lie'), ['p1']) }).toThrow(/lists uncommitted proposalId/)
  })

  it('rejects a duplicate start for an open run', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    start(session, runId('twice'))
    expect(() => { start(session, runId('twice')) }).toThrow(/already open/)
  })

  it('fails setup when a seeded session carries an unterminated bracket', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const seeded = ctx.sessions.create(SessionId('stale-self-evolve'))
    start(seeded, runId('stale'))
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(SelfEvolveInvariant)).rejects.toThrow(/has no matching end/)
  })
})
