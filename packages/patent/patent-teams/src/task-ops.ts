/**
 * The team task state machine: create, claim, update, and reassign.
 *
 * Every operation re-reads durable state and re-derives the caller's authority
 * inside the per-team lock, then persists atomically before any notification
 * fires. Attempt ids are the capability that binds an update to the attempt
 * that claimed the task, so reassignment revokes the old id and waits for the
 * old owner to quiesce before the new attempt opens.
 * @module dsh-patent-teams/task-ops
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { evaluatePatentContent } from '@deepseek-ai/dsh-patent-tools'
import { validateWorkerOutput, workerContract } from '@deepseek-ai/dsh-patent-workflow'
import { SessionId } from '@deepseek-ai/dsh-session'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import { PatentTeamsAttemptId, PatentTeamsTaskId, PatentTeamsTeamId } from './ids.ts'
import { interruptMember, waitForMemberIdle } from './members.ts'
import type { TeamScheduler } from './scheduler.ts'
import {
  beginTaskAttempt,
  CAPTAIN_KEY,
  invalidateTaskAttempt,
  readTeam,
  transitionError,
  unsatisfiedDependencies,
  writeTeam,
} from './state.ts'
import {
  captainTeam,
  freshCaptainTeam,
  memberOpenTask,
  participantTeam,
  requireMember,
  requireTask,
  withParticipant,
} from './team-access.ts'
import { teamLockKey, withTeamLock } from './team-lock.ts'
import {
  TERMINAL_TASK_STATUSES,
  type TaskContractValidation,
  type TaskGateFeedback,
  type TeamState,
  type TeamTask,
} from './types.ts'

/**
 * The service-side dependencies the task operations run against.
 *
 * The owning service projects its resolved configuration into these fields, so
 * this module reads only the knobs a task transition actually consults.
 */
export interface TaskOpsHost {
  /** Plugin context: event records, the rule gate, and the agent registry. */
  readonly ctx: Context
  /** State directory name under the captain's workspace. */
  readonly stateDir: string
  /** Scheduler that dispatches tasks these operations leave ready. */
  readonly scheduler: TeamScheduler
  /** Run the composite quality gate on contract-backed task completion. */
  readonly qualityGate: boolean
  /** Comprehensive-eval score below which the gate reports the composite score as advisory. */
  readonly passThreshold: number
}

/** Arguments of one `patent_teams_create_task` call. */
export interface CreateTaskArgs {
  subject: string
  description?: string
  dependencies?: string[]
  assignee?: string
  worker?: string
}

/** The created task's identity row. */
export interface CreateTaskResult {
  task_id: string
  subject: string
  status: string
  assignee?: string
  worker?: string
}

/** Arguments of one `patent_teams_reassign_task` call. */
export interface ReassignTaskArgs {
  task_id: string
  /** Target member name, or `captain` for takeover. */
  assignee: string
  reason?: string
}

/** The task's state after an accepted handoff. */
export interface ReassignTaskResult {
  task_id: string
  previous_assignee: string
  assignee: string
  status: string
  attempt: number
  attempt_id?: string
}

/** Arguments of one `patent_teams_claim_task` call. */
export interface ClaimTaskArgs {
  task_id: string
  /** Target member name; captain callers only. */
  assignee?: string
}

/** The capability a claim returns for the opened attempt. */
export interface ClaimTaskResult {
  task_id: string
  status: string
  assignee: string
  attempt: number
  attempt_id?: string
}

/** Arguments of one `patent_teams_update_task` call. */
export interface UpdateTaskArgs {
  task_id: string
  status?: string
  output?: string
  /** The current attempt capability, required from member callers. */
  attempt_id?: string
}

/** The task's state after an accepted update. */
export interface UpdateTaskResult {
  task_id: string
  status: string
  output?: string
  attempt: number
  attempt_id?: string
  /** Set when the quality gate bounced the completion back for rework. */
  gated?: boolean
  gate_feedback?: string
}

/**
 * The attempt identity a `patent-teams/task-updated` record carries.
 *
 * Every task-updated emit site states it the same way, so the record shape does
 * not depend on which transition produced it. Both fields are optional on
 * `TeamTask` because a team record written before they existed loads without
 * them, and a task that no attempt ever opened must not claim one.
 * @param task - the task whose transition is being recorded.
 * @returns the `attempt`/`attemptId` fields to spread into the payload.
 */
function attemptFields(task: TeamTask): { attempt?: number; attemptId?: PatentTeamsAttemptId } {
  return {
    ...task.attempt === undefined ? {} : { attempt: task.attempt },
    ...task.attemptId === undefined ? {} : { attemptId: PatentTeamsAttemptId(task.attemptId) },
  }
}

/**
 * The task identity every task-transition record carries.
 *
 * Like {@link attemptFields}, every emit site states it identically, so a
 * record names its team and task the same way whichever transition produced it.
 * @param fresh - the team the task belongs to.
 * @param task - the task the transition is about.
 * @returns the `teamId`/`taskId` fields to spread into the payload.
 */
function taskRef(fresh: TeamState, task: TeamTask): { teamId: PatentTeamsTeamId; taskId: PatentTeamsTaskId } {
  return { teamId: PatentTeamsTeamId(fresh.id), taskId: PatentTeamsTaskId(task.id) }
}

/**
 * Project one task's mutation result row for the model. `attempt` and `attempt_id`
 * are absent while the task has no live attempt (reassignment revokes the id until
 * the next claim), `output` is absent until one is recorded, so the rows the
 * mutation tools return are deliberately not uniformly shaped.
 * @param task - the task to project.
 * @returns the model-facing row for one task mutation.
 */
function taskView(task: TeamTask): { task_id: string; status: string; attempt: number; attempt_id?: string; output?: string } {
  return {
    task_id: task.id,
    status: task.status,
    attempt: task.attempt ?? 0,
    ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
    ...task.output !== undefined ? { output: task.output } : {},
  }
}

/**
 * Create a task in the team's task list. Tasks can depend on other tasks;
 * a task is only claimable once every dependency is completed.
 * @param host - the owning service's task-operation dependencies.
 * @param agent - the calling captain.
 * @param args - subject, description, dependencies, optional assignee.
 * @param signal - caller cancellation, forwarded to scheduling.
 * @returns the created task's identity.
 */
export async function createTask(
  host: TaskOpsHost,
  agent: Agent,
  args: CreateTaskArgs,
  signal?: AbortSignal,
): Promise<CreateTaskResult> {
  const { workspace, stateRoot, team } = await captainTeam(agent, host.stateDir)
  const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
    const fresh = await freshCaptainTeam(stateRoot, team.id, agent.id)
    const dependencies = args.dependencies ?? []
    for (const dependency of dependencies) {
      if (!fresh.tasks.some(task => task.id === dependency)) {
        throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
      }
    }
    if (args.assignee !== undefined) requireMember(fresh, args.assignee)
    if (args.worker !== undefined && workerContract(args.worker) === undefined) {
      throw new Error(`patent_teams_create_task: worker "${args.worker}" is not in the patent worker catalog`)
    }
    const task: TeamTask = {
      id: `t${fresh.taskSeq + 1}`,
      subject: args.subject,
      ...args.description === undefined ? {} : { description: args.description },
      status: 'pending',
      ...args.assignee === undefined ? {} : { assignee: args.assignee },
      ...args.worker === undefined ? {} : { worker: args.worker },
      dependencies,
      attempt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    fresh.taskSeq += 1
    fresh.tasks.push(task)
    await writeTeam(stateRoot, fresh)
    appendTeamEvent(host.ctx, captainSessionOf(host.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/task-created', {
      ...taskRef(fresh, task),
      subject: task.subject,
      dependencies: task.dependencies.map(dependency => PatentTeamsTaskId(dependency)),
      ...task.assignee !== undefined ? { assignee: task.assignee } : {},
      ...task.worker !== undefined ? { worker: task.worker } : {},
    })
    return {
      task_id: task.id,
      subject: task.subject,
      status: task.status,
      ...task.assignee !== undefined ? { assignee: task.assignee } : {},
      ...task.worker !== undefined ? { worker: task.worker } : {},
    }
  })
  await host.scheduler.kickTeam(workspace, team.id, agent, signal)
  return created
}

/**
 * Atomically retry, reassign, or let the captain take over any unfinished or
 * failed task. The old attempt is revoked before its member is interrupted,
 * so late updates cannot overwrite the new owner.
 * @param host - the owning service's task-operation dependencies.
 * @param agent - the calling captain.
 * @param args - task id, target assignee ("captain" for takeover), reason.
 * @param signal - caller cancellation, forwarded to quiescence waits.
 * @returns the task's post-handoff state.
 */
export async function reassignTask(
  host: TaskOpsHost,
  agent: Agent,
  args: ReassignTaskArgs,
  signal: AbortSignal,
): Promise<ReassignTaskResult> {
  const { workspace, stateRoot, team } = await captainTeam(agent, host.stateDir)
  const target = args.assignee.trim()
  if (target === '') throw new Error('reassignment assignee must not be empty')

  const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
    const fresh = await freshCaptainTeam(stateRoot, team.id, agent.id)
    const task = requireTask(fresh, args.task_id)
    if (task.status === 'completed') throw new Error(`completed task ${task.id} is immutable and cannot be reassigned`)
    if (task.reassigning === true) throw new Error(`task ${task.id} is already being reassigned`)
    const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target)
    if (targetMember !== undefined) {
      const busy = memberOpenTask(fresh, targetMember.name, task.id)
      if (busy !== undefined) {
        throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`)
      }
    }
    const previousAssignee = task.assignee ?? ''
    const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
      || task.assignee === undefined || task.assignee === CAPTAIN_KEY
      ? undefined
      : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed')
    invalidateTaskAttempt(task, target, true)
    await writeTeam(stateRoot, fresh)
    return {
      previousAssignee,
      previousMember: previousMember === undefined ? undefined : { ...previousMember },
      handoffId: task.handoffId,
    }
  })

  let quiescenceError: unknown
  if (revoked.previousMember !== undefined) {
    interruptMember(host.ctx, agent, revoked.previousMember.id)
    try {
      await waitForMemberIdle(host.ctx, revoked.previousMember, signal)
    } catch (error: unknown) {
      quiescenceError = error
    }
  }

  await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
    const fresh = await freshCaptainTeam(stateRoot, team.id, agent.id)
    const task = requireTask(fresh, args.task_id)
    if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
      throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`)
    }
    task.reassigning = false
    if (quiescenceError === undefined && target === CAPTAIN_KEY) beginTaskAttempt(task, CAPTAIN_KEY)
    await writeTeam(stateRoot, fresh)
    appendTeamEvent(host.ctx, agent.session, 'patent-teams/task-updated', {
      ...taskRef(fresh, task),
      status: task.status,
      assignee: task.assignee,
      ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
      ...attemptFields(task),
    })
  })
  if (quiescenceError !== undefined) {
    // v8 ignore next -- waitForMemberIdle only rejects with Errors, so the non-Error wrap is defensive
    throw quiescenceError instanceof Error
      ? quiescenceError
      : new Error(`task quiescence failed: ${JSON.stringify(quiescenceError)}`)
  }
  if (target !== CAPTAIN_KEY) await host.scheduler.kickMember(workspace, team.id, target, agent, signal)
  const current = await readTeam(stateRoot, team.id)
  const task = current === undefined ? undefined : requireTask(current, args.task_id)
  if (task === undefined) throw new Error(`team "${team.name}" ended during reassignment`)
  // v8 ignore start -- reassignment fixes assignee/attempt; the fallbacks are never reachable
  return {
    task_id: task.id,
    previous_assignee: revoked.previousAssignee,
    assignee: task.assignee ?? '',
    status: task.status,
    attempt: task.attempt ?? 0,
    ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
  }
  // v8 ignore stop
}

/**
 * Claim one ready task for a member (or yourself). A member cannot own a
 * second unfinished task. The returned attempt_id is required for that
 * member's updates and becomes stale after retry/reassignment.
 * @param host - the owning service's task-operation dependencies.
 * @param agent - the calling captain or member.
 * @param args - task id, optional assignee (captain only).
 * @returns the claimed task's capability.
 */
export async function claimTask(
  host: TaskOpsHost,
  agent: Agent,
  args: ClaimTaskArgs,
): Promise<ClaimTaskResult> {
  const { stateRoot, team } = await participantTeam(agent, host.stateDir)
  return withParticipant(stateRoot, team.id, agent.id, async (fresh, identity) => {
    const task = requireTask(fresh, args.task_id)
    if (task.reassigning === true) {
      throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`)
    }
    let assignee = task.assignee
    if (identity.kind === 'captain') {
      if (args.assignee !== undefined) {
        requireMember(fresh, args.assignee)
        assignee = args.assignee
      }
    } else {
      if (args.assignee !== undefined) {
        throw new Error('members cannot set assignee when claiming a task')
      }
      if (assignee !== undefined && assignee !== identity.name) {
        throw new Error(`task ${task.id} is assigned to "${assignee}", not you`)
      }
      assignee = identity.name
    }
    // Authorization must happen before the idempotent return: another
    // member must not receive a false success for somebody else's task.
    if (task.status === 'claimed' || task.status === 'in_progress') {
      if (assignee === undefined || task.assignee !== assignee) {
        // v8 ignore next -- a claimed task always has an assignee
        throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`)
      }
      // v8 ignore start -- a claimed task always carries attempt/attemptId; fallbacks are unreachable
      return {
        task_id: task.id,
        status: task.status,
        assignee,
        attempt: task.attempt ?? 0,
        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
      }
      // v8 ignore stop
    }
    const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
    if (pending.length > 0) {
      throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`)
    }
    const transition = transitionError(task.status, 'claimed')
    if (transition !== undefined) throw new Error(transition)
    if (assignee === undefined) {
      throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)')
    }
    const busy = memberOpenTask(fresh, assignee, task.id)
    if (busy !== undefined) {
      throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`)
    }
    const attemptId = beginTaskAttempt(task, assignee)
    await writeTeam(stateRoot, fresh)
    appendTeamEvent(host.ctx, captainSessionOf(host.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/task-updated', {
      ...taskRef(fresh, task),
      status: task.status,
      assignee: task.assignee,
      ...attemptFields(task),
    })
    // v8 ignore start -- the freshly claimed task always has assignee/attempt
    return {
      task_id: task.id,
      status: task.status,
      assignee: task.assignee ?? '',
      attempt: task.attempt ?? 0,
      attempt_id: attemptId,
    }
    // v8 ignore stop
  })
}

/**
 * Update a task status/output. Members must supply the current attempt_id
 * returned by claim_task; stale attempts are rejected after takeover or
 * reassignment. Terminal results are immutable.
 * @param host - the owning service's task-operation dependencies.
 * @param agent - the calling captain or member.
 * @param args - task id, status, output, attempt_id.
 * @param signal - caller cancellation, forwarded to scheduling.
 * @returns the task's updated state.
 */
export async function updateTask(
  host: TaskOpsHost,
  agent: Agent,
  args: UpdateTaskArgs,
  signal?: AbortSignal,
): Promise<UpdateTaskResult> {
  const { workspace, stateRoot, team } = await participantTeam(agent, host.stateDir)
  const updated = await withParticipant(stateRoot, team.id, agent.id, async (fresh, identity) => {
    const task = requireTask(fresh, args.task_id)
    if (identity.kind === 'captain'
      && task.assignee !== undefined
      && task.assignee !== CAPTAIN_KEY) {
      throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call patent_teams_reassign_task with assignee="captain" before takeover`)
    }
    if (identity.kind === 'member') {
      if (task.assignee !== identity.name) {
        throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
      }
      if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
        throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`)
      }
    }
    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      const sameStatus = args.status === undefined || args.status === task.status
      const sameOutput = args.output === undefined || args.output === task.output
      if (!sameStatus || !sameOutput) {
        throw new Error(`terminal task ${task.id} is immutable; use patent_teams_reassign_task to retry failed/cancelled work`)
      }
      return taskView(task)
    }
    if (args.status !== undefined) {
      // For a contract-backed task, do not admit `completed` until the
      // composite quality gate passes: a low score / missing contract field /
      // rule violation bounces the task back to the member for rework.
      const targetCompleted = args.status === 'completed'
      const shouldGate = targetCompleted && host.qualityGate
        && task.worker !== undefined && args.output !== undefined
      if (shouldGate) {
        // shouldGate required task.worker and args.output to reach runQualityGate.
        // oxlint-disable-next-line typescript/no-non-null-assertion -- shouldGate ensured task.worker and args.output are defined
        const gate = runQualityGate(host.ctx, task.worker!, args.output!, host.passThreshold)
        if (!gate.satisfied) {
          // A bounced submission must fall back to in_progress: leaving a
          // claimed task claimed would make the revised completed submission
          // hit the claimed->completed transition error and wedge the member.
          if (task.status === 'claimed') task.status = 'in_progress'
          // oxlint-disable-next-line typescript/no-non-null-assertion -- shouldGate ensured args.output is defined
          task.output = args.output!
          task.gateFeedback = gate
          task.updatedAt = Date.now()
          await writeTeam(stateRoot, fresh)
          appendTeamEvent(host.ctx, captainSessionOf(host.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/task-gated', {
            ...taskRef(fresh, task),
            score: gate.score,
            failures: gate.failures,
            feedback: gate.feedback,
          })
          // v8 ignore start -- the entry check bound this call to the task's current attempt, and a bounced
          // submission keeps that attempt: only the status falls back from claimed to in_progress above
          return {
            task_id: task.id,
            status: task.status,
            output: task.output,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            gated: true,
            gate_feedback: gate.feedback,
          }
          // v8 ignore stop
        }
      }
      const transition = transitionError(task.status, args.status as never)
      if (transition !== undefined) throw new Error(transition)
      task.status = args.status as never
    }
    if (args.output !== undefined) task.output = args.output
    let validated: TaskContractValidation | undefined
    if (task.status === 'completed' && task.worker !== undefined && task.output !== undefined) {
      validated = validateTaskContract(task.worker, task.output)
      task.contractValidation = validated
    }
    task.updatedAt = Date.now()
    await writeTeam(stateRoot, fresh)
    appendTeamEvent(host.ctx, captainSessionOf(host.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/task-updated', {
      ...taskRef(fresh, task),
      status: task.status,
      ...task.assignee !== undefined ? { assignee: task.assignee } : {},
      ...task.output !== undefined ? { output: task.output } : {},
      ...attemptFields(task),
    })
    if (validated !== undefined) {
      appendTeamEvent(host.ctx, captainSessionOf(host.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/task-validated', {
        ...taskRef(fresh, task),
        worker: validated.worker,
        valid: validated.valid,
        missingHardFields: validated.missingHardFields,
        degraded: validated.degraded,
      })
    }
    return taskView(task)
  })
  await host.scheduler.kickTeam(workspace, team.id, team.captainSessionId === agent.id ? agent : undefined, signal)
  return updated
}

/**
 * Validate one task's completed output against its worker contract (soft, never blocks).
 * @param workerName - the catalog worker the task was created with.
 * @param output - the completed output to validate.
 * @returns the recorded contract verdict.
 */
function validateTaskContract(workerName: string, output: string): TaskContractValidation {
  // v8 ignore next -- createTask rejects unknown workers, so a completing task always resolves its worker
  // oxlint-disable-next-line typescript/no-non-null-assertion -- createTask rejects unknown workers
  const worker = workerContract(workerName)!
  const validation = validateWorkerOutput(worker, output)
  return {
    worker: workerName,
    valid: validation.valid,
    missingHardFields: validation.missingHardFields,
    degraded: validation.degraded,
  }
}

/**
 * Run the composite completion gate over one contract-backed task's output.
 *
 * Bounce criteria are the signals that apply to a single work-product segment:
 * worker-contract hard fields, content sufficiency (a segment must not be an
 * empty shell), and the optional patent-rule gate. The
 * `comprehensive` score is retained as an advisory value (it is reported in the
 * feedback and the `TaskGateFeedback.score`) but is never the sole reason to
 * bounce: its structure/workflow dimensions penalize short work products that
 * the worker contract already obliges. `passThreshold` therefore lowers the
 * threshold at which the advisory composite score is called out in the feedback,
 * not the bounce decision.
 *
 * Never throws; `satisfied` is false on any failure.
 * @param ctx - the plugin context (reads the optional `patentRuleGate` service).
 * @param workerName - the catalog worker the task was created with.
 * @param output - the submitted completion to gate.
 * @param passThreshold - score below which the advisory line is appended.
 * @returns the gate verdict recorded on the task.
 */
function runQualityGate(ctx: Context, workerName: string, output: string, passThreshold: number): TaskGateFeedback {
  const failures: string[] = []
  // v8 ignore next -- createTask rejects unknown workers, so a gated task always resolves its worker
  // oxlint-disable-next-line typescript/no-non-null-assertion -- createTask rejects unknown workers
  const validation = validateWorkerOutput(workerContract(workerName)!, output)
  if (validation.missingHardFields.length > 0) {
    failures.push(`契约缺字段:${validation.missingHardFields.join('、')}（${workerName}）`)
  }
  const evaluation = evaluatePatentContent('comprehensive', output, [])
  const sufficiency = evaluation.details['内容充分性']
  if (sufficiency !== undefined && !sufficiency.passed) {
    failures.push(`内容充分性:${sufficiency.score.toFixed(2)}/1.0 未达及格线`)
  }
  // The rule gate is an optional contribution from patent-rule; without it the rule dimension is skipped.
  const ruleGate = ctx.get('patentRuleGate')
  if (ruleGate !== undefined) {
    const gateResult = ruleGate.process(output)
    if (gateResult.needsApproval) {
      const rules = [...gateResult.reviewHits, ...gateResult.blockHits].join('、')
      failures.push(`规则需要人工确认:${rules}`)
    }
  }
  const lines = failures.map(f => `- ${f}`)
  if (evaluation.score < passThreshold) {
    lines.push(`- 综合评分偏低(${evaluation.score.toFixed(2)}/1.0)，建议完善论证与引用（不以此单独打回）`)
  }
  const feedback = lines.length === 0
    ? ''
    : `未过质量门禁，请修订后重新提交 completed:\n${lines.join('\n')}`
  return { score: evaluation.score, satisfied: failures.length === 0, failures, feedback }
}
