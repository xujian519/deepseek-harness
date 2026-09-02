// Session-event emission and captain-session resolution. Every record is
// written as an ignorable informational event: on-disk team state is the
// authoritative source, so builds that predate the patent-teams/* vocabulary
// may drop the records instead of refusing the log.
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { appendTeamEvent, captainSessionOf } from '../src/events.ts'
import type { PatentTeamsTeamCreatedData } from '../src/event-types.ts'

const TEAM_CREATED = 'patent-teams/team-created' as const
const data: PatentTeamsTeamCreatedData = { teamId: 'alpha', captainSessionId: 'captain-1', name: 'Alpha' }

function makeContext(): Context {
  return new Context()
}

describe('appendTeamEvent', () => {
  it('appends the event as an ignorable informational record', () => {
    const ctx = makeContext()
    const session = Session.create(SessionId('captain-1'))
    appendTeamEvent(ctx, session, TEAM_CREATED, data)
    const event = session.snapshotEvents().find(candidate => candidate.type === TEAM_CREATED)
    expect(event).toBeDefined()
    expect(event!.data).toEqual(data)
    expect(event!.ignorable).toBe(true)
  })

  it('logs a warning when the session append fails', () => {
    const ctx = makeContext()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const broken = { append: () => { throw new Error('append exploded') } } as unknown as Session
    appendTeamEvent(ctx, broken, TEAM_CREATED, data)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session record failed'))
  })
})

describe('captainSessionOf', () => {
  it('uses the live captain session when the captain agent is online', () => {
    const ctx = makeContext()
    const captainSession = Session.create(SessionId('captain-1'))
    ctx.provide('agents', {
      get: (id: string) => (id === 'captain-1' ? { id, session: captainSession } : undefined),
    })
    const fallback = Session.create(SessionId('caller'))
    expect(captainSessionOf(ctx, 'captain-1', fallback)).toBe(captainSession)
  })

  it('falls back to the calling session when the captain is offline', () => {
    const ctx = makeContext()
    ctx.provide('agents', { get: () => undefined })
    const fallback = Session.create(SessionId('caller'))
    expect(captainSessionOf(ctx, 'captain-1', fallback)).toBe(fallback)
  })
})
