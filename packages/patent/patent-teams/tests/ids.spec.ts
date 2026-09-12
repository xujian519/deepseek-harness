// The `patent-teams/*` payload identities are branded: the fold in
// ui-patent-teams reads team, task, and message ids from the session log, so a
// team id must not be usable where a task id is expected and none of them may
// stay assignable to a bare string.
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  PatentTeamsMessageSentData,
  PatentTeamsTaskCreatedData,
  PatentTeamsTeamCreatedData,
} from '../src/event-types.ts'
import {
  PatentTeamsAttemptId,
  PatentTeamsMessageId,
  PatentTeamsTaskId,
  PatentTeamsTeamId,
} from '../src/ids.ts'

describe('patent-teams payload identities', () => {
  it('brands the payload identities the UI folds', () => {
    expectTypeOf<PatentTeamsTeamCreatedData['teamId']>().not.toEqualTypeOf<string>()
    expectTypeOf<PatentTeamsTeamCreatedData['captainSessionId']>().toEqualTypeOf<SessionId>()
    expectTypeOf<PatentTeamsTaskCreatedData['taskId']>().not.toEqualTypeOf<string>()
    expectTypeOf<PatentTeamsTaskCreatedData['dependencies']>().not.toEqualTypeOf<readonly string[]>()
    expectTypeOf<PatentTeamsMessageSentData['messageId']>().not.toEqualTypeOf<string>()
  })

  it('keeps the identities mutually unassignable', () => {
    expectTypeOf<PatentTeamsTeamId>().not.toEqualTypeOf<ReturnType<typeof PatentTeamsTaskId>>()
    expectTypeOf<PatentTeamsTaskId>().not.toEqualTypeOf<ReturnType<typeof PatentTeamsMessageId>>()
    expectTypeOf<PatentTeamsMessageId>().not.toEqualTypeOf<ReturnType<typeof PatentTeamsAttemptId>>()
  })

  it('brands without changing the value', () => {
    expect(PatentTeamsTeamId('alpha')).toBe('alpha')
    expect(PatentTeamsTaskId('t1')).toBe('t1')
    expect(PatentTeamsMessageId('m1')).toBe('m1')
    expect(PatentTeamsAttemptId('cap-1')).toBe('cap-1')
  })
})
