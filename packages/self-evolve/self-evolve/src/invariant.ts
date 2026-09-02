/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-self-evolve`.
 *
 * The durable `self-evolve/*` bracket pair (`start` → `end`) shares the run
 * identity across every intermediate mined/proposed/validated/commit event; a
 * bracket missing its pair means the run's durable state is irreconstructable
 * from the log alone.
 *
 * @module @deepseek-ai/dsh-self-evolve/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SelfEvolveRunId } from './brand.ts'
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-self-evolve'

/** Cordis companion plugin name. */
export const name = 'self-evolve-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

interface OpenRun {
  runId: SelfEvolveRunId
  startSeq: number
  proposed: Set<string>
  validated: Set<string>
  committed: Set<string>
}

interface RunTransition {
  kind: 'start' | 'mined' | 'proposed' | 'validated' | 'commit' | 'end'
  runId: SelfEvolveRunId
  seq: number
  proposalId?: string
  committedProposalIds?: string[]
}

function validateId(value: unknown, label: string, fail: InvariantFailure): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`)
}

function validateStart(trace: Map<string, OpenRun>, event: SessionEvent, fail: InvariantFailure): RunTransition {
  const data = event.data as { runId: SelfEvolveRunId }
  const runId = data.runId
  validateId(runId, 'self-evolve/start runId', fail)
  if (trace.has(runId)) fail(`self-evolve/start runId ${runId} already open at seq ${event.seq}`)
  return { kind: 'start', runId, seq: event.seq }
}

function requireOpen(trace: Map<string, OpenRun>, runId: unknown, eventType: string, seq: number, fail: InvariantFailure): OpenRun {
  validateId(runId, `${eventType} runId`, fail)
  const open = trace.get(runId)
  if (open === undefined) fail(`${eventType} without matching start at seq ${seq}`)
  return open
}

function validateEvent(trace: Map<string, OpenRun>, event: SessionEvent, fail: InvariantFailure): RunTransition | undefined {
  switch (event.type) {
    case 'self-evolve/start':
      return validateStart(trace, event, fail)
    case 'self-evolve/mined': {
      const data = event.data as { runId: SelfEvolveRunId }
      const runId = data.runId
      requireOpen(trace, runId, 'self-evolve/mined', event.seq, fail)
      return { kind: 'mined', runId, seq: event.seq }
    }
    case 'self-evolve/proposed': {
      const data = event.data as { runId: SelfEvolveRunId; proposal: { proposalId: string } }
      const runId = data.runId
      const open = requireOpen(trace, runId, 'self-evolve/proposed', event.seq, fail)
      const proposalId = data.proposal.proposalId
      validateId(proposalId, 'self-evolve/proposed proposalId', fail)
      if (open.proposed.has(proposalId)) fail(`self-evolve/proposed proposal ${proposalId} already proposed in run ${runId}`)
      return { kind: 'proposed', runId, seq: event.seq, proposalId }
    }
    case 'self-evolve/validated': {
      const data = event.data as { runId: SelfEvolveRunId; proposalId: string }
      const runId = data.runId
      const open = requireOpen(trace, runId, 'self-evolve/validated', event.seq, fail)
      const proposalId = data.proposalId
      validateId(proposalId, 'self-evolve/validated proposalId', fail)
      if (!open.proposed.has(proposalId)) fail(`self-evolve/validated proposal ${proposalId} was never proposed`)
      if (open.validated.has(proposalId)) fail(`self-evolve/validated proposal ${proposalId} already validated`)
      return { kind: 'validated', runId, seq: event.seq, proposalId }
    }
    case 'self-evolve/commit': {
      const data = event.data as { runId: SelfEvolveRunId; commit: { proposal: { proposalId: string } } }
      const runId = data.runId
      const open = requireOpen(trace, runId, 'self-evolve/commit', event.seq, fail)
      const proposalId = data.commit.proposal.proposalId
      validateId(proposalId, 'self-evolve/commit proposalId', fail)
      if (!open.validated.has(proposalId)) fail(`self-evolve/commit proposal ${proposalId} was not validated as accepted`)
      if (open.committed.has(proposalId)) fail(`self-evolve/commit proposal ${proposalId} already committed`)
      return { kind: 'commit', runId, seq: event.seq, proposalId }
    }
    case 'self-evolve/end': {
      const data = event.data as { runId: SelfEvolveRunId; committedProposalIds: string[] }
      const runId = data.runId
      const open = requireOpen(trace, runId, 'self-evolve/end', event.seq, fail)
      const committed = data.committedProposalIds
      if (!Array.isArray(committed)) fail('self-evolve/end committedProposalIds must be an array')
      for (const id of committed) {
        validateId(id, 'self-evolve/end committedProposalIds entry', fail)
        if (!open.committed.has(id)) fail(`self-evolve/end lists uncommitted proposalId ${id}`)
      }
      return { kind: 'end', runId, seq: event.seq, committedProposalIds: committed }
    }
    default:
      return undefined
  }
}

function applyTransition(trace: Map<string, OpenRun>, transition: RunTransition): void {
  const runId = transition.runId
  switch (transition.kind) {
    case 'start':
      trace.set(runId, {
        runId: transition.runId,
        startSeq: transition.seq,
        proposed: new Set(),
        validated: new Set(),
        committed: new Set(),
      })
      break
    case 'mined':
      break
    case 'proposed':
    case 'validated':
    case 'commit': {
      // validateEvent guarantees proposalId for these kinds; skip defensively
      // so an invariant-validated transition can never throw here.
      /* v8 ignore next -- validateEvent guarantees proposalId for these kinds */
      if (transition.proposalId === undefined) break
      const entry = trace.get(runId)
      /* v8 ignore next -- requireOpen guarantees the trace entry for validated transitions */
      if (entry === undefined) break
      switch (transition.kind) {
        case 'proposed':
          entry.proposed.add(transition.proposalId)
          break
        case 'validated':
          entry.validated.add(transition.proposalId)
          break
        case 'commit':
          entry.committed.add(transition.proposalId)
          break
      }
      break
    }
    case 'end':
      trace.delete(runId)
      break
  }
}

/** Install self-evolve start/mined/proposed/validated/commit/end checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, Map<string, OpenRun>>()
  const staged = new WeakMap<SessionEvent, { session: Session; transition: RunTransition }>()

  const seed = (session: Session): Map<string, OpenRun> => {
    const trace = new Map<string, OpenRun>()
    for (const event of session.snapshotEvents()) {
      const transition = validateEvent(trace, event, fail)
      if (transition !== undefined) applyTransition(trace, transition)
    }
    if (trace.size > 0) {
      const first = trace.values().next().value as OpenRun
      fail(`self-evolve run ${first.runId} started at seq ${first.startSeq} has no matching end`)
    }
    traces.set(session, trace)
    return trace
  }

  const traceFor = (session: Session): Map<string, OpenRun> => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)

  ctx.on('session/created', (session: Session) => { seed(session) }, { global: true })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (!event.type.startsWith('self-evolve/')) return
    const candidate = staged.get(event)
    /* v8 ignore next -- internal/dispatch stages every self-evolve event */
    if (candidate === undefined || candidate.session !== session) return fail('self-evolve event published without pre-commit validation')
    staged.delete(event)
    const trace = traceFor(session)
    applyTransition(trace, candidate.transition)
  }, { global: true })

  ctx.on('internal/dispatch', (_mode: unknown, eventName: string, args: unknown[]) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!event.type.startsWith('self-evolve/')) return
    const trace = traceFor(session)
    const transition = validateEvent(trace, event, fail)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
