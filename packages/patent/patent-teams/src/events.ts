/**
 * Durable PatentTeams session events and their emitter.
 *
 * Every team-state mutation appends one informational event to the captain's
 * Session, so the web client's Conversation Node mechanism can fold the team
 * view from the session log deterministically (same mechanism as
 * `tool-workflow`'s `tool-workflow/*` record events). Events append to the
 * captain's session even when a member agent performed the mutation, so the
 * captain's conversation stream stays the single authoritative monitor
 * surface.
 *
 * Every record is marked `ignorable: true`: on-disk team state, not the log,
 * is the authoritative source, so a harness build that predates the
 * `patent-teams/*` vocabulary (for example an upstream install of the
 * published plugin) may drop these records instead of refusing the log.
 *
 * Types and the `SessionEventMap` merge live in `event-types.ts` (zero
 * imports) so the browser program can load them without host augmentations.
 * @module dsh-patent-teams/events
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEventMap, SessionId } from '@deepseek-ai/dsh-session/types'
import type { PatentTeamsEventType } from './event-types.ts'

/**
 * Append one PatentTeams event to a Session as an ignorable informational
 * record, containing failures (a broken durable record must never break team
 * tool execution).
 * @param ctx - the plugin context (for logging).
 * @param session - the session to record into (the captain's, normally).
 * @param type - the event type.
 * @param data - the event payload.
 */
export function appendTeamEvent(
  ctx: Context,
  session: Session,
  type: PatentTeamsEventType,
  data: SessionEventMap[PatentTeamsEventType],
): void {
  try {
    session.append(type, data, { ignorable: true })
  } catch (error: unknown) {
    ctx.logger.warn(`patent-teams: session record failed after ${type}: ${String(error)}`)
  }
}

/**
 * Resolve the captain's live Session for event recording. The captain agent
 * may be offline (its team outlives the session), in which case the caller's
 * own session is used as the fallback record target.
 * @param ctx - the plugin context (injects `agents`).
 * @param captainSessionId - the captain's durable session id.
 * @param fallback - the calling agent's session, used when the captain is not live.
 * @returns the session to record into.
 */
export function captainSessionOf(
  ctx: Context,
  captainSessionId: string,
  fallback: Session,
): Session {
  const captain = ctx.get('agents')?.get(captainSessionId as SessionId)
  return captain?.session ?? fallback
}
