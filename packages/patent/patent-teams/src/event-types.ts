/**
 * PatentTeams session event types — pure types only, zero imports.
 *
 * This file intentionally imports nothing: both the host program (the
 * emitter in `events.ts`) and the browser program (the Conversation Node
 * definition) must be able to load these types and the `SessionEventMap`
 * declaration merge without pulling in host-side `Context` augmentations
 * (dsh-session's index declares `Context.sessions: SessionStore`, which
 * collides with the browser runtime's `ISessions` under the same name).
 * @module dsh-patent-teams/event-types
 */

/** Opens one team record: the captain created the team. */
export interface PatentTeamsTeamCreatedData {
  readonly teamId: string
  /** The captain session that owns this team (UI follows it). */
  readonly captainSessionId: string
  readonly name: string
  readonly description?: string
}

/** Records one member after its continuable subagent is spawned. */
export interface PatentTeamsMemberAddedData {
  readonly teamId: string
  readonly memberId: string
  readonly name: string
  readonly role?: string
}

/** Marks one member removed. */
export interface PatentTeamsMemberRemovedData {
  readonly teamId: string
  readonly memberId: string
}

/** Records one task in the team's task list. */
export interface PatentTeamsTaskCreatedData {
  readonly teamId: string
  readonly taskId: string
  readonly subject: string
  readonly dependencies: readonly string[]
  readonly assignee?: string
}

/** Records one task status/assignee/output transition. */
export interface PatentTeamsTaskUpdatedData {
  readonly teamId: string
  readonly taskId: string
  readonly status: string
  readonly assignee?: string
  readonly output?: string
  readonly attempt?: number
  readonly attemptId?: string
}

/** Closes one team record: the team was deleted. */
export interface PatentTeamsTeamDeletedData {
  readonly teamId: string
}

/** Records one mailbox message sent between team agents. */
export interface PatentTeamsMessageSentData {
  readonly teamId: string
  readonly messageId: string
  /** `captain` or a member name. */
  readonly from: string
  /** `captain` or a member name. */
  readonly to: string
  readonly content: string
  readonly ts: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one team record.
     * @param data - stable team identity and display name.
     */
    'patent-teams/team-created': PatentTeamsTeamCreatedData
    /**
     * Records one team member.
     * @param data - team identity, member child session, and display identity.
     */
    'patent-teams/member-added': PatentTeamsMemberAddedData
    /**
     * Records one member removal.
     * @param data - team identity and the member's child session id.
     */
    'patent-teams/member-removed': PatentTeamsMemberRemovedData
    /**
     * Records one task creation.
     * @param data - team identity, task id, subject, dependencies, assignee.
     */
    'patent-teams/task-created': PatentTeamsTaskCreatedData
    /**
     * Records one task transition.
     * @param data - team identity, task id, and the new status/assignee/output.
     */
    'patent-teams/task-updated': PatentTeamsTaskUpdatedData
    /**
     * Records one mailbox message.
     * @param data - team identity, sender, recipient, and content.
     */
    'patent-teams/message-sent': PatentTeamsMessageSentData
    /**
     * Closes one team record after deletion.
     * @param data - stable team identity.
     */
    'patent-teams/team-deleted': PatentTeamsTeamDeletedData
  }
}

/** The full set of `patent-teams/*` event names. */
export type PatentTeamsEventType =
  | 'patent-teams/team-created'
  | 'patent-teams/member-added'
  | 'patent-teams/member-removed'
  | 'patent-teams/task-created'
  | 'patent-teams/task-updated'
  | 'patent-teams/message-sent'
  | 'patent-teams/team-deleted'
