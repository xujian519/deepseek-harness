/**
 * Package-owned invariant companion for @deepseek-ai/dsh-patent-teams.
 *
 * The package owns the durable patent-teams/* session events: it validates
 * every payload on load and on append, so a malformed snapshot cannot enter
 * (or be restored into) the session log that reconstructs the model-visible
 * team state.
 * @module @deepseek-ai/dsh-patent-teams/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-teams'

/** Cordis companion plugin name. */
export const name = 'patent-teams-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Whether a payload field is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** Whether a payload field is an optional string. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

/** Validate one patent-teams/team-created payload. */
function validateTeamCreated(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/team-created data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/team-created teamId must be a non-empty string')
  if (!isNonEmptyString(record.captainSessionId)) {
    fail('patent-teams/team-created captainSessionId must be a non-empty string')
  }
  if (!isNonEmptyString(record.name)) fail('patent-teams/team-created name must be a non-empty string')
  if (!isOptionalString(record.description)) fail('patent-teams/team-created description must be a string')
}

/** Validate one patent-teams/member-added payload. */
function validateMemberAdded(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/member-added data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/member-added teamId must be a non-empty string')
  if (!isNonEmptyString(record.memberId)) fail('patent-teams/member-added memberId must be a non-empty string')
  if (!isNonEmptyString(record.name)) fail('patent-teams/member-added name must be a non-empty string')
  if (!isOptionalString(record.role)) fail('patent-teams/member-added role must be a string')
}

/** Validate one patent-teams/member-removed payload. */
function validateMemberRemoved(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/member-removed data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/member-removed teamId must be a non-empty string')
  if (!isNonEmptyString(record.memberId)) fail('patent-teams/member-removed memberId must be a non-empty string')
}

/** Validate one patent-teams/task-created payload. */
function validateTaskCreated(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/task-created data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/task-created teamId must be a non-empty string')
  if (!isNonEmptyString(record.taskId)) fail('patent-teams/task-created taskId must be a non-empty string')
  if (!isNonEmptyString(record.subject)) fail('patent-teams/task-created subject must be a non-empty string')
  if (!Array.isArray(record.dependencies) || record.dependencies.some(id => typeof id !== 'string')) {
    fail('patent-teams/task-created dependencies must be an array of strings')
  }
  if (!isOptionalString(record.assignee)) fail('patent-teams/task-created assignee must be a string')
}

/** Validate one patent-teams/task-updated payload. */
function validateTaskUpdated(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/task-updated data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/task-updated teamId must be a non-empty string')
  if (!isNonEmptyString(record.taskId)) fail('patent-teams/task-updated taskId must be a non-empty string')
  if (!isNonEmptyString(record.status)) fail('patent-teams/task-updated status must be a non-empty string')
  if (!isOptionalString(record.assignee)) fail('patent-teams/task-updated assignee must be a string')
  if (!isOptionalString(record.output)) fail('patent-teams/task-updated output must be a string')
  if (!isOptionalString(record.attemptId)) fail('patent-teams/task-updated attemptId must be a string')
  if (record.attempt !== undefined && !Number.isSafeInteger(record.attempt)) {
    fail('patent-teams/task-updated attempt must be an integer')
  }
}

/** Validate one patent-teams/message-sent payload. */
function validateMessageSent(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/message-sent data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/message-sent teamId must be a non-empty string')
  if (!isNonEmptyString(record.messageId)) fail('patent-teams/message-sent messageId must be a non-empty string')
  if (!isNonEmptyString(record.from)) fail('patent-teams/message-sent from must be a non-empty string')
  if (!isNonEmptyString(record.to)) fail('patent-teams/message-sent to must be a non-empty string')
  if (!isNonEmptyString(record.content)) fail('patent-teams/message-sent content must be a non-empty string')
  if (!Number.isFinite(record.ts)) fail('patent-teams/message-sent ts must be a finite number')
}

/** Validate one patent-teams/team-deleted payload. */
function validateTeamDeleted(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent-teams/team-deleted data must be an object')
  const record = value as Record<string, unknown>
  if (!isNonEmptyString(record.teamId)) fail('patent-teams/team-deleted teamId must be a non-empty string')
}

/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  switch (event.type) {
    case 'patent-teams/team-created':
      validateTeamCreated(event.data, fail)
      break
    case 'patent-teams/member-added':
      validateMemberAdded(event.data, fail)
      break
    case 'patent-teams/member-removed':
      validateMemberRemoved(event.data, fail)
      break
    case 'patent-teams/task-created':
      validateTaskCreated(event.data, fail)
      break
    case 'patent-teams/task-updated':
      validateTaskUpdated(event.data, fail)
      break
    case 'patent-teams/message-sent':
      validateMessageSent(event.data, fail)
      break
    case 'patent-teams/team-deleted':
      validateTeamDeleted(event.data, fail)
      break
    default:
      break
  }
}

/** Install validation for loaded and newly appended patent-teams/* session events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
