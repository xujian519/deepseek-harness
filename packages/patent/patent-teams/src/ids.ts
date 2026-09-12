/**
 * Cross-boundary identities of the `patent-teams/*` vocabulary.
 *
 * The durable team file keeps plain strings; a record's identity becomes
 * branded where it crosses into the session log, so a team id can never be
 * read where a task id is expected. The brands live here rather than in
 * `event-types.ts` because that module must stay free of runtime code for the
 * browser program, while the constructors are host-side.
 * @module dsh-patent-teams/ids
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one team record. */
export type PatentTeamsTeamId = Branded<'PatentTeamsTeamId'>

/**
 * Brand a durable team record identity for a `patent-teams/*` payload.
 * @param id - the team's durable directory id.
 * @returns the same string branded as a team identity.
 */
export function PatentTeamsTeamId(id: string): PatentTeamsTeamId {
  return brandString<PatentTeamsTeamId>(id)
}

/** Stable identity of one task inside a team (`t1`, `t2`, …). */
export type PatentTeamsTaskId = Branded<'PatentTeamsTaskId'>

/**
 * Brand a team-local task identity for a `patent-teams/*` payload.
 * @param id - the task's team-local id.
 * @returns the same string branded as a task identity.
 */
export function PatentTeamsTaskId(id: string): PatentTeamsTaskId {
  return brandString<PatentTeamsTaskId>(id)
}

/** Stable identity of one durable mailbox message. */
export type PatentTeamsMessageId = Branded<'PatentTeamsMessageId'>

/**
 * Brand a mailbox message identity for a `patent-teams/*` payload.
 * @param id - the message's durable id.
 * @returns the same string branded as a message identity.
 */
export function PatentTeamsMessageId(id: string): PatentTeamsMessageId {
  return brandString<PatentTeamsMessageId>(id)
}

/** Capability identity of one task attempt within a team. */
export type PatentTeamsAttemptId = Branded<'PatentTeamsAttemptId'>

/**
 * Brand a task-attempt capability identity for a `patent-teams/*` payload.
 * @param id - the attempt's durable capability id.
 * @returns the same string branded as an attempt identity.
 */
export function PatentTeamsAttemptId(id: string): PatentTeamsAttemptId {
  return brandString<PatentTeamsAttemptId>(id)
}
