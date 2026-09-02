/**
 * Package-owned invariant companion for @deepseek-ai/dsh-patent-workflow.
 *
 * The package owns the durable patent/* session events: it validates every
 * patent/plantask and patent/workflow-run payload on load and on append, so a
 * malformed snapshot cannot enter (or be restored into) the session log that
 * reconstructs the model-visible plan/run state.
 * @module @deepseek-ai/dsh-patent-workflow/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-workflow'
const PLAN_TASK_STATES = new Set(['planning', 'awaiting_approval', 'executing', 'awaiting_feedback', 'replanning', 'finished'])
const PLAN_TASK_STATUSES = new Set(['pending', 'in_progress', 'completed'])

/** Cordis companion plugin name. */
export const name = 'patent-workflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one patent/plantask payload. */
function validatePlantask(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent/plantask data must be an object')
  const { caseId, state, tasks, feedback } = value as Record<string, unknown>
  if (typeof caseId !== 'string' || caseId.trim() === '') fail('patent/plantask caseId must be a non-empty string')
  if (typeof state !== 'string' || !PLAN_TASK_STATES.has(state)) {
    fail('patent/plantask state is not a known PlanTaskState')
  }
  if (feedback !== undefined && typeof feedback !== 'string') fail('patent/plantask feedback must be a string')
  if (tasks === undefined) return
  if (!Array.isArray(tasks)) fail('patent/plantask tasks must be an array')
  for (const task of tasks) {
    if (typeof task !== 'object' || task === null) fail('patent/plantask tasks entries must be objects')
    const { id, description, hash, status, blockedBy } = task as Record<string, unknown>
    if (typeof id !== 'string' || id.trim() === '') fail('patent/plantask task id must be a non-empty string')
    if (typeof description !== 'string') fail('patent/plantask task description must be a string')
    if (typeof hash !== 'string') fail('patent/plantask task hash must be a string')
    if (typeof status !== 'string' || !PLAN_TASK_STATUSES.has(status)) {
      fail('patent/plantask task status is not a known PlanTaskStatus')
    }
    if (blockedBy !== undefined && (!Array.isArray(blockedBy) || blockedBy.some(b => typeof b !== 'string'))) {
      fail('patent/plantask task blockedBy must be an array of strings')
    }
  }
}

/** Validate one patent/workflow-run payload. */
function validateWorkflowRun(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('patent/workflow-run data must be an object')
  const { manifestId, caseType, completed, stages, degradedSteps, summary } = value as Record<string, unknown>
  if (typeof manifestId !== 'string' || manifestId.trim() === '') {
    fail('patent/workflow-run manifestId must be a non-empty string')
  }
  if (typeof caseType !== 'string' || caseType.trim() === '') fail('patent/workflow-run caseType must be a non-empty string')
  if (typeof completed !== 'boolean') fail('patent/workflow-run completed must be a boolean')
  if (typeof summary !== 'string') fail('patent/workflow-run summary must be a string')
  if (!Array.isArray(stages)) fail('patent/workflow-run stages must be an array')
  if (!Array.isArray(degradedSteps) || degradedSteps.some(d => typeof d !== 'string')) {
    fail('patent/workflow-run degradedSteps must be an array of strings')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'patent/plantask') validatePlantask(event.data, fail)
  if (event.type === 'patent/workflow-run') validateWorkflowRun(event.data, fail)
}

/** Install validation for loaded and newly appended patent/* session events. */
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
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
