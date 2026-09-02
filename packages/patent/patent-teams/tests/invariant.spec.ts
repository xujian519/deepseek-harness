// Manual-topology suite: this file owns its invariant service composition (the
// vitest setup leaves roots untouched for *invariant*.spec.ts files). The real
// InvariantRegistry is not mounted; apply() is driven against a stub that
// captures the installer, which is then executed directly against real Contexts
// with a recording failure reporter — covering every payload validator, the
// loaded-event startup pass, and the internal/dispatch append guard.
import { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

interface Capture {
  installer?: InvariantInstaller
}

function captureInstaller(ctx: Context): Capture {
  const holder: Capture = {}
  ctx.provide('invariants', {
    register: (_packageName: string, installer: InvariantInstaller): (() => void) => {
      holder.installer = installer
      return () => {}
    },
  })
  return holder
}

function event(type: string, payload: unknown): SessionEvent {
  return { type, seq: 0, time: 0, data: payload } as SessionEvent
}

describe('patent-teams invariant companion', () => {
  it('declares the companion identity and injection', () => {
    expect(name).toBe('patent-teams-invariant')
    expect(inject).toEqual(['invariants'])
  })

  it('registers the installer through the invariant service and returns a disposer', async () => {
    const ctx = new Context()
    const holder = captureInstaller(ctx)
    const disposer = await apply(ctx)
    const installer = holder.installer!
    expect(installer).toBeTypeOf('function')
    expect(installer.inject).toEqual(['sessions'])
    expect(disposer).toBeTypeOf('function')
  })

  it('validates loaded session events at install time', async () => {
    const ctx = new Context()
    const holder = captureInstaller(ctx)
    await apply(ctx)
    const installer = holder.installer!
    const good = event('patent-teams/team-created', { teamId: 'a', captainSessionId: 'c', name: 'n' })
    const bad = event('patent-teams/team-created', { teamId: '', captainSessionId: 'c', name: 'n' })
    const failures: string[] = []
    const fail: InvariantFailure = (message) => {
      failures.push(message)
      throw new Error(message)
    }
    ctx.provide('sessions', { list: () => [{ snapshotEvents: () => [good] }] })
    expect(() => installer(ctx, fail)).not.toThrow()
    expect(failures).toEqual([])

    const other = new Context()
    const otherHolder = captureInstaller(other)
    await apply(other)
    const otherInstaller = otherHolder.installer!
    other.provide('sessions', { list: () => [{ snapshotEvents: () => [bad] }] })
    expect(() => otherInstaller(other, fail)).toThrow(/team-created teamId must be a non-empty string/)
    expect(failures[0]).toContain('team-created teamId must be a non-empty string')
  })

  describe('append guard', () => {
    interface Harness {
      ctx: Context
      failures: string[]
      fail: InvariantFailure
      installer: InvariantInstaller
      emit(type: string, payload: unknown): void
    }

    function harness(): Harness {
      const ctx = new Context()
      const holder = captureInstaller(ctx)
      const failures: string[] = []
      const fail: InvariantFailure = (message) => {
        failures.push(message)
        throw new Error(message)
      }
      void apply(ctx)
      const installer = holder.installer!
      // No loaded sessions; the listener is the only active guard.
      ctx.provide('sessions', { list: () => [] })
      void installer(ctx, fail)
      const h: Harness = {
        ctx,
        failures,
        fail,
        installer,
        emit(type, payload) {
          try {
            ctx.emit('session/event', {} as Session, event(type, payload))
          } catch {
            // The validator throws through the dispatch; the caller inspects
            // the recorded failures.
          }
        },
      }
      return h
    }

    const validPayloads: Array<[string, unknown]> = [
      ['patent-teams/team-created', { teamId: 'a', captainSessionId: 'c', name: 'n' }],
      ['patent-teams/team-created', { teamId: 'a', captainSessionId: 'c', name: 'n', description: 'd' }],
      ['patent-teams/member-added', { teamId: 'a', memberId: 'm', name: 'n' }],
      ['patent-teams/member-added', { teamId: 'a', memberId: 'm', name: 'n', role: 'r' }],
      ['patent-teams/member-removed', { teamId: 'a', memberId: 'm' }],
      ['patent-teams/task-created', { teamId: 'a', taskId: 't1', subject: 's', dependencies: ['t0'] }],
      ['patent-teams/task-created', { teamId: 'a', taskId: 't1', subject: 's', dependencies: [], assignee: 'm' }],
      ['patent-teams/task-updated', { teamId: 'a', taskId: 't1', status: 'in_progress' }],
      ['patent-teams/task-updated', { teamId: 'a', taskId: 't1', status: 'completed', assignee: 'm', output: 'o', attempt: 2, attemptId: 'x' }],
      ['patent-teams/message-sent', { teamId: 'a', messageId: 'm1', from: 'm', to: 'captain', content: 'hi', ts: 1 }],
      ['patent-teams/team-deleted', { teamId: 'a' }],
    ]

    it.each(validPayloads)('accepts a valid %s payload', (type, payload) => {
      const h = harness()
      h.emit(type, payload)
      expect(h.failures).toEqual([])
    })

    it('ignores unrelated event types entirely', () => {
      const h = harness()
      h.emit('turn/start', { turn: 1 })
      h.emit('patent/plantask', { state: 'x' })
      expect(h.failures).toEqual([])
    })

    it('ignores dispatches for other event names entirely', () => {
      const h = harness()
      // Raw dispatches with non-session event names must not reach the validator.
      ;(h.ctx.emit as (name: string, ...args: unknown[]) => void)('turn/start', { turn: 1 })
      ;(h.ctx.emit as (name: string, ...args: unknown[]) => void)('patent/plantask', { state: 'x' })
      expect(h.failures).toEqual([])
    })

    const invalidCases: Array<[string, string, string]> = [
      ['patent-teams/team-created', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/team-created', 'teamId', 'teamId must be a non-empty string'],
      ['patent-teams/team-created', 'captainSessionId', 'captainSessionId must be a non-empty string'],
      ['patent-teams/team-created', 'name', 'name must be a non-empty string'],
      ['patent-teams/team-created', 'description', 'description must be a string'],
      ['patent-teams/member-added', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/member-added', 'teamId', 'teamId must be a non-empty string'],
      ['patent-teams/member-added', 'memberId', 'memberId must be a non-empty string'],
      ['patent-teams/member-added', 'name', 'name must be a non-empty string'],
      ['patent-teams/member-added', 'role', 'role must be a string'],
      ['patent-teams/member-removed', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/member-removed', 'teamId', 'teamId must be a non-empty string'],
      ['patent-teams/member-removed', 'memberId', 'memberId must be a non-empty string'],
      ['patent-teams/task-created', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/task-created', 'teamId', 'teamId must be a non-empty string'],
      ['patent-teams/task-created', 'taskId', 'taskId must be a non-empty string'],
      ['patent-teams/task-created', 'subject', 'subject must be a non-empty string'],
      ['patent-teams/task-created', 'dependencies', 'dependencies must be an array of strings'],
      ['patent-teams/task-created', 'assignee', 'assignee must be a string'],
      ['patent-teams/task-updated', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/task-updated', 'teamId', 'teamId must be a non-empty string'],
      ['patent-teams/task-updated', 'taskId', 'taskId must be a non-empty string'],
      ['patent-teams/task-updated', 'status', 'status must be a non-empty string'],
      ['patent-teams/task-updated', 'assignee', 'assignee must be a string'],
      ['patent-teams/task-updated', 'output', 'output must be a string'],
      ['patent-teams/task-updated', 'attemptId', 'attemptId must be a string'],
      ['patent-teams/task-updated', 'attempt', 'attempt must be an integer'],
      ['patent-teams/message-sent', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/message-sent', 'teamId', 'teamId must be a non-empty string'],
      ['patent-teams/message-sent', 'messageId', 'messageId must be a non-empty string'],
      ['patent-teams/message-sent', 'from', 'from must be a non-empty string'],
      ['patent-teams/message-sent', 'to', 'to must be a non-empty string'],
      ['patent-teams/message-sent', 'content', 'content must be a non-empty string'],
      ['patent-teams/message-sent', 'ts', 'ts must be a finite number'],
      ['patent-teams/team-deleted', 'data-must-be-object', 'data must be an object'],
      ['patent-teams/team-deleted', 'teamId', 'teamId must be a non-empty string'],
    ]

    it.each(invalidCases)('rejects a malformed %s payload', (type, rule, expected) => {
      const h = harness()
      const base = validPayloads.find(([candidate]) => candidate === type)?.[1]
      h.emit(type, brokenPayload(base, rule))
      expect(h.failures).toHaveLength(1)
      expect(h.failures[0]).toContain(expected)
    })
  })
})

/** Build one payload guaranteed to trip the named validator rule. */
function brokenPayload(base: unknown, rule: string): unknown {
  const record = (base ?? {}) as Record<string, unknown>
  switch (rule) {
    case 'data-must-be-object':
      return null
    case 'teamId':
      return { ...record, teamId: '' }
    case 'captainSessionId':
      return { ...record, captainSessionId: 5 }
    case 'name':
      return { ...record, name: '' }
    case 'description':
      return { ...record, description: 5 }
    case 'memberId':
      return { ...record, memberId: 5 }
    case 'role':
      return { ...record, role: 5 }
    case 'taskId':
      return { ...record, taskId: 5 }
    case 'subject':
      return { ...record, subject: '' }
    case 'dependencies':
      return { ...record, dependencies: ['t0', 5] }
    case 'assignee':
      return { ...record, assignee: 5 }
    case 'status':
      return { ...record, status: '' }
    case 'output':
      return { ...record, output: 5 }
    case 'attemptId':
      return { ...record, attemptId: 5 }
    case 'attempt':
      return { ...record, attempt: 1.5 }
    case 'messageId':
      return { ...record, messageId: '' }
    case 'from':
      return { ...record, from: '' }
    case 'to':
      return { ...record, to: 5 }
    case 'content':
      return { ...record, content: '' }
    case 'ts':
      return { ...record, ts: Number.NaN }
    default:
      throw new Error(`no fixture for rule ${rule}`)
  }
}
