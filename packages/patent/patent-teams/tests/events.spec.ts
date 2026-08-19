// Session-event emission and captain-session resolution. The recognized-vocabulary
// gate in events.ts reads the real KNOWN_SESSION_EVENT_TYPES set, which does not
// contain the out-of-repo patent-teams/* types; tests temporarily register one
// type so both the skip path and the append path are exercised.
import { Context } from '@deepseek-ai/cordis'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendTeamEvent, captainSessionOf } from '../src/events.ts'
import type { PatentTeamsTeamCreatedData } from '../src/event-types.ts'

const TEAM_CREATED = 'patent-teams/team-created' as const
const data: PatentTeamsTeamCreatedData = { teamId: 'alpha', captainSessionId: 'captain-1', name: 'Alpha' }

function makeContext(): Context {
  return new Context()
}

afterEach(() => {
  (KNOWN_SESSION_EVENT_TYPES as Set<string>).delete(TEAM_CREATED)
  vi.restoreAllMocks()
})

describe('appendTeamEvent', () => {
  it('omits events the harness does not recognize and logs the omission once per type', () => {
    // The generated vocabulary now includes patent-teams/*; simulate a harness
    // that predates it by removing the type from the live set for this test.
    ;(KNOWN_SESSION_EVENT_TYPES as Set<string>).delete(TEAM_CREATED)
    const ctx = makeContext()
    const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
    const session = Session.create(SessionId('captain-1'))
    appendTeamEvent(ctx, session, TEAM_CREATED, data)
    appendTeamEvent(ctx, session, TEAM_CREATED, data)
    expect(session.events).toHaveLength(0)
    expect(debug).toHaveBeenCalledTimes(1)
    expect(debug).toHaveBeenCalledWith(expect.stringContaining(TEAM_CREATED))
  })

  it('appends a recognized event to the session log', () => {
    (KNOWN_SESSION_EVENT_TYPES as Set<string>).add(TEAM_CREATED)
    const ctx = makeContext()
    const session = Session.create(SessionId('captain-1'))
    appendTeamEvent(ctx, session, TEAM_CREATED, data)
    const event = session.events.find(candidate => candidate.type === TEAM_CREATED)
    expect(event).toBeDefined()
    expect(event!.data).toEqual(data)
  })

  it('logs a warning when the session append fails', () => {
    (KNOWN_SESSION_EVENT_TYPES as Set<string>).add(TEAM_CREATED)
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
