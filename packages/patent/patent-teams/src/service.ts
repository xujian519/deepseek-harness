/**
 * Service Definition for the patent-team capability (ctx.patentTeams): a
 * captain-led durable team of continuable subagents with dependency-aware
 * tasks, mailbox messaging, and an event-driven shared-task scheduler.
 *
 * The service owns team state transitions (create/read/update/archive), the
 * task status machine with attempt revocation, member lifecycle (spawn,
 * interrupt, retire), mailbox persistence, and the scheduler kicks. The
 * `patent_teams_*` tools in this package are its sole Consumer; the member
 * spawn/fork provider is a configurable internal backend.
 * @module @deepseek-ai/dsh-patent-teams
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { roleContract, validateWorkerOutput, workerContract, workerDeliverables } from '@deepseek-ai/dsh-patent-workflow'
import { evaluatePatentContent } from '@deepseek-ai/dsh-patent-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import {
  acknowledgeMailbox,
  appendMailbox,
  archiveTeamDir,
  beginTaskAttempt,
  CAPTAIN_KEY,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  invalidateTaskAttempt,
  readTeam,
  readUnreadMailbox,
  recordRetiredMemberIds,
  releaseMailboxDelivery,
  sanitizeKey,
  stateRootOf,
  teamLockKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import {
  deliverToMember,
  interruptMember,
  memberActivity,
  resolveMemberLlmSelection,
  spawnMember,
  type MemberRuntimeConfig,
} from './members.ts'
import { TERMINAL_TASK_STATUSES, type TaskContractValidation, type TaskGateFeedback, type TeamMember, type TeamState, type TeamTask } from './types.ts'
import { installTeamScheduler, type TeamScheduler } from './scheduler.ts'

/** Resolved plugin config consumed by the service. */
export interface PatentTeamsConfig {
  /** State directory name under the captain's workspace. */
  stateDir: string
  /** Member subagent provider name. */
  memberProvider: string
  /** Optional member model override. */
  memberModel?: string
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Team size cap (members). */
  maxMembers: number
  /** Run the composite quality gate on contract-backed task completion. */
  qualityGate: boolean
  /** Comprehensive-eval pass score threshold (0..1). */
  passThreshold: number
}

/** The caller agent, or a loud failure for non-agent callers. */
function requireAgent(exec: ToolRunContext): Agent {
  if (!exec.agent) {
    throw new Error('patent_teams tools require a calling agent (exec.agent was undefined)')
  }
  return exec.agent
}

/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

type ParticipantIdentity =
  | { kind: 'captain'; name: typeof CAPTAIN_KEY }
  | { kind: 'member'; name: string }

/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined {
  if (team.captainSessionId === agentId) return { kind: 'captain', name: CAPTAIN_KEY }
  const member = team.members.find(candidate => candidate.id === agentId && candidate.status !== 'removed')
  return member === undefined ? undefined : { kind: 'member', name: member.name }
}

/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (fresh === undefined) throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}

/** Look up one live (non-removed) member by display name. */
function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find(candidate => candidate.name === name && candidate.status !== 'removed')
  if (member === undefined) {
    throw new Error(`no active member named "${name}" in team "${team.name}"`)
  }
  return member
}

/** Look up one task by id. */
function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find(candidate => candidate.id === taskId)
  if (task === undefined) {
    throw new Error(`no task "${taskId}" in team "${team.name}" — use patent_teams_status to list tasks`)
  }
  return task
}

/**
 * Project one task's mutation result row. The optional fields carry values on
 * every call path whose fallbacks are unreachable (v8 ignore).
 */
function taskView(task: TeamTask): { task_id: string; status: string; attempt: number; attempt_id?: string; output?: string } {
  // v8 ignore start -- every caller has already asserted the fields it relies on
  return {
    task_id: task.id,
    status: task.status,
    attempt: task.attempt ?? 0,
    ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
    ...task.output !== undefined ? { output: task.output } : {},
  }
  // v8 ignore stop
}

function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

async function waitForMemberIdle(ctx: Context, member: TeamMember, signal: AbortSignal): Promise<void> {
  // v8 ignore next -- durable state validation rejects members with empty ids before they can be waited on
  if (member.id === '') return
  const live = ctx.get('agents')?.get(member.id as SessionId)
  if (live === undefined) return
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('task reassignment was cancelled')
  }
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('task reassignment was cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([live.whenIdle(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Deliver a durable member report at the captain's nearest model boundary.
 *
 * `Agent.steer()` targets the next step while the captain is running, wakes a
 * new turn when it is idle, and lets the Agent runtime reclassify an aborted
 * activity to `next-turn`. This prevents reports from waiting behind the
 * captain's entire orchestration turn.
 */
function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string): boolean {
  try {
    captain.steer(createUserMessage({
      content: [{ type: 'text', text: `PatentTeams message from member ${from}:\n\n${content}` }],
      source: { kind: 'plugin', plugin: 'dsh-patent-teams' },
    }))
    return true
  } catch {
    // The plugin mailbox was persisted before this best-effort live delivery.
    return false
  }
}

/**
 * The durable team capability service.
 *
 * One captain leads one active team at a time; every mutation runs inside the
 * per-team in-process lock and is persisted atomically before any notification
 * fires. Members are continuable subagents whose durable session ids are
 * recorded in the team file, so a team survives harness restarts.
 */
export class PatentTeamsService extends Service {
  private readonly config: PatentTeamsConfig
  private readonly scheduler: TeamScheduler

  constructor(ctx: Context, config: PatentTeamsConfig) {
    super(ctx, 'patentTeams')
    this.config = config
    this.scheduler = installTeamScheduler(ctx, { stateDir: config.stateDir })
  }

  /** Resolve the calling captain and the team it leads (loud when absent). */
  private async captainTeam(agent: Agent): Promise<{ workspace: string; stateRoot: string; team: TeamState }> {
    const workspace = workspaceOf(agent)
    const stateRoot = stateRootOf(workspace, this.config.stateDir)
    const team = await findTeamByCaptain(stateRoot, agent.id)
    if (team === undefined) {
      throw new Error('you are not leading any team yet — call patent_teams_create first')
    }
    return { workspace, stateRoot, team }
  }

  /** Resolve the calling participant and the team it belongs to (loud when absent). */
  private async participantTeam(
    agent: Agent,
  ): Promise<{ workspace: string; stateRoot: string; team: TeamState }> {
    const workspace = workspaceOf(agent)
    const stateRoot = stateRootOf(workspace, this.config.stateDir)
    const team = await findTeamByParticipant(stateRoot, agent.id)
    if (team === undefined) {
      throw new Error('you do not lead or belong to any active team yet')
    }
    return { workspace, stateRoot, team }
  }

  /** Fresh state with captain authorization rechecked inside the lock. */
  private async freshCaptainTeam(
    stateRoot: string,
    teamId: string,
    captainId: string,
  ): Promise<TeamState> {
    const fresh = await requireFreshTeam(stateRoot, teamId)
    /* v8 ignore next 2 -- the caller was located by captainSessionId already; this recheck is defensive */
    if (fresh.captainSessionId !== captainId) {
      throw new Error(`only the captain of team "${fresh.name}" may perform this operation`)
    }
    return fresh
  }

  /** Fresh state and caller identity rechecked inside the lock. */
  private async freshParticipant(
    stateRoot: string,
    teamId: string,
    callerId: string,
  ): Promise<{ team: TeamState; identity: ParticipantIdentity }> {
    const fresh = await requireFreshTeam(stateRoot, teamId)
    const identity = participantIdentityOf(fresh, callerId)
    if (identity === undefined) throw new Error(`you are no longer an active participant in team "${fresh.name}"`)
    return { team: fresh, identity }
  }

  /**
   * Create a team: the calling agent becomes its captain. A captain leads one
   * team at a time.
   * @param agent - the calling agent (the new captain).
   * @param name - team name, sanitized into the stable team id.
   * @param description - team purpose / goal.
   * @returns the created team's id, name, and state directory.
   */
  async create(agent: Agent, name: string, description?: string): Promise<{
    team_id: string
    team_name: string
    state_dir: string
  }> {
    const workspace = workspaceOf(agent)
    const stateRoot = stateRootOf(workspace, this.config.stateDir)
    const teamName = name.trim()
    if (teamName === '') throw new Error('team name must not be empty')
    const teamId = sanitizeKey(teamName)
    const captainLockKey = `captain:${stateRoot}:${agent.id}`
    return withTeamLock(captainLockKey, async () => {
      const current = await findTeamByCaptain(stateRoot, agent.id)
      if (current !== undefined) {
        // v8 ignore next -- findTeamByCaptain matches the caller's own id, so the team is always its own
        const relationship = current.captainSessionId === agent.id ? 'lead' : 'belong to'
        throw new Error(`you already ${relationship} team "${current.name}" — end or leave it before creating another`)
      }
      return withTeamLock(teamLockKey(stateRoot, teamId), async () => {
        const existing = await readTeam(stateRoot, teamId)
        if (existing !== undefined) {
          throw new Error(`team id "${teamId}" is taken by another captain — pick a different team name`)
        }
        const state: TeamState = {
          name: teamName,
          id: teamId,
          ...description === undefined ? {} : { description },
          captainSessionId: agent.id,
          createdAt: Date.now(),
          members: [],
          tasks: [],
          taskSeq: 0,
        }
        await createTeamDir(stateRoot, state)
        appendTeamEvent(this.ctx, agent.session, 'patent-teams/team-created', {
          teamId: state.id,
          captainSessionId: agent.id,
          name: state.name,
          ...state.description !== undefined ? { description: state.description } : {},
        })
        return { team_id: state.id, team_name: state.name, state_dir: join(stateRoot, state.id) }
      })
    })
  }

  /**
   * Add a durable continuable member. By default it snapshots the captain's
   * current LLM route and effort; supply provider/model only for an explicitly
   * requested role-specific route.
   * @param agent - the calling captain.
   * @param args - member name, role, optional route/effort.
   * @param signal - caller cancellation, forwarded to the spawn.
   * @returns the created member's identity.
   */
  async addMember(
    agent: Agent,
    args: {
      name: string
      role?: string
      provider?: string
      model?: string
      reasoning_effort?: string
    },
    signal: AbortSignal,
  ): Promise<{
    member_name: string
    member_id: string
    provider: string
    model: string
    reasoning_effort?: string
    status: string
  }> {
    const { workspace, stateRoot, team } = await this.captainTeam(agent)
    const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
      const memberName = args.name.trim()
      if (memberName === '') throw new Error('member name must not be empty')
      const memberKey = sanitizeKey(memberName)
      if (memberKey === CAPTAIN_KEY) {
        throw new Error(`member name "${args.name}" is reserved for the captain`)
      }
      if (fresh.members.some(candidate => sanitizeKey(candidate.name) === memberKey)) {
        throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`)
      }
      if (fresh.members.filter(candidate => candidate.status !== 'removed').length >= this.config.maxMembers) {
        throw new Error(`team "${fresh.name}" is at its member cap (${this.config.maxMembers})`)
      }
      const selection = await resolveMemberLlmSelection(this.ctx, agent, {
        ...args.provider === undefined ? {} : { provider: args.provider },
        ...args.model === undefined ? {} : { model: args.model },
        ...this.config.memberModel === undefined ? {} : { defaultModel: this.config.memberModel },
        ...args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort },
      }, signal)
      const member: TeamMember = {
        id: '',
        name: memberName,
        ...args.role === undefined ? {} : { role: args.role },
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
        joinedAt: Date.now(),
        status: 'idle',
      }
      const memberContract = args.role === undefined ? undefined : roleContract(args.role)
      await spawnMember(
        this.ctx,
        memberRuntime(this.config),
        selection,
        agent,
        fresh,
        member,
        this.config.stateDir,
        signal,
        memberContract,
      )
      fresh.members.push(member)
      try {
        await writeTeam(stateRoot, fresh)
      } catch (error: unknown) {
        // The continuable child is already live, but the durable team record
        // never saw it. Retire the orphan so it disappears from subagent
        // listings and cannot be resumed, then surface the write failure.
        // v8 ignore next -- spawnMember fills the id before this try block can be reached
        if (member.id !== '') {
          await recordRetiredMemberIds(stateRoot, [member.id]).catch(() => undefined)
          interruptMember(this.ctx, agent, member.id)
        }
        throw error
      }
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/member-added', {
        teamId: fresh.id,
        memberId: member.id,
        name: member.name,
        ...member.role !== undefined ? { role: member.role } : {},
      })
      return {
        member_name: member.name,
        member_id: member.id,
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined
          ? {}
          : { reasoning_effort: selection.reasoningEffort },
        status: member.status,
      }
    })
    await this.scheduler.kickMember(workspace, team.id, created.member_name, agent, signal)
    return created
  }

  /**
   * Remove a member safely: revoke its current attempts, return all unfinished
   * owned tasks to the shared pending pool, interrupt its live turn, and mark
   * it removed.
   * @param agent - the calling captain.
   * @param name - member name to remove.
   * @param signal - caller cancellation, forwarded to quiescence waits.
   * @returns the removed member and requeued task ids.
   */
  async removeMember(agent: Agent, name: string, signal: AbortSignal): Promise<{
    member_name: string
    status: string
    requeued_tasks: string[]
  }> {
    const { workspace, stateRoot, team } = await this.captainTeam(agent)
    const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
      const member = requireMember(fresh, name)
      const requeued: string[] = []
      for (const task of fresh.tasks) {
        if (task.assignee !== member.name || task.status === 'completed') continue
        invalidateTaskAttempt(task)
        task.reassigning = false
        requeued.push(task.id)
      }
      member.status = 'removed'
      await writeTeam(stateRoot, fresh)
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/member-removed', {
        teamId: fresh.id,
        memberId: member.id,
      })
      return { member: { ...member }, requeued }
    })
    // v8 ignore next -- every persisted member was spawned, so the id is never empty
    if (revoked.member.id !== '') {
      await recordRetiredMemberIds(stateRoot, [revoked.member.id])
      interruptMember(this.ctx, agent, revoked.member.id)
      await waitForMemberIdle(this.ctx, revoked.member, signal)
    }
    await this.scheduler.kickTeam(workspace, team.id, agent, signal)
    return {
      member_name: revoked.member.name,
      status: revoked.member.status,
      requeued_tasks: revoked.requeued,
    }
  }

  /**
   * Create a task in the team's task list. Tasks can depend on other tasks;
   * a task is only claimable once every dependency is completed.
   * @param agent - the calling captain.
   * @param args - subject, description, dependencies, optional assignee.
   * @param signal - caller cancellation, forwarded to scheduling.
   * @returns the created task's identity.
   */
  async createTask(
    agent: Agent,
    args: {
      subject: string
      description?: string
      dependencies?: string[]
      assignee?: string
      worker?: string
    },
    signal?: AbortSignal,
  ): Promise<{ task_id: string; subject: string; status: string; assignee?: string; worker?: string }> {
    const { workspace, stateRoot, team } = await this.captainTeam(agent)
    const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
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
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/task-created', {
        teamId: fresh.id,
        taskId: task.id,
        subject: task.subject,
        dependencies: task.dependencies,
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
    await this.scheduler.kickTeam(workspace, team.id, agent, signal)
    return created
  }

  /**
   * Atomically retry, reassign, or let the captain take over any unfinished or
   * failed task. The old attempt is revoked before its member is interrupted,
   * so late updates cannot overwrite the new owner.
   * @param agent - the calling captain.
   * @param args - task id, target assignee ("captain" for takeover), reason.
   * @param signal - caller cancellation, forwarded to quiescence waits.
   * @returns the task's post-handoff state.
   */
  async reassignTask(
    agent: Agent,
    args: { task_id: string; assignee: string; reason?: string },
    signal: AbortSignal,
  ): Promise<{
    task_id: string
    previous_assignee: string
    assignee: string
    status: string
    attempt: number
    attempt_id?: string
  }> {
    const { workspace, stateRoot, team } = await this.captainTeam(agent)
    const target = args.assignee.trim()
    if (target === '') throw new Error('reassignment assignee must not be empty')

    const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
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
      interruptMember(this.ctx, agent, revoked.previousMember.id)
      try {
        await waitForMemberIdle(this.ctx, revoked.previousMember, signal)
      } catch (error: unknown) {
        quiescenceError = error
      }
    }

    await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
      const task = requireTask(fresh, args.task_id)
      if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
        throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`)
      }
      task.reassigning = false
      if (quiescenceError === undefined && target === CAPTAIN_KEY) beginTaskAttempt(task, CAPTAIN_KEY)
      await writeTeam(stateRoot, fresh)
      appendTeamEvent(this.ctx, agent.session, 'patent-teams/task-updated', {
        teamId: fresh.id,
        taskId: task.id,
        status: task.status,
        assignee: task.assignee,
        ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
      })
    })
    if (quiescenceError !== undefined) {
      // v8 ignore next -- waitForMemberIdle only rejects with Errors, so the non-Error wrap is defensive
      throw quiescenceError instanceof Error
        ? quiescenceError
        : new Error(`task quiescence failed: ${JSON.stringify(quiescenceError)}`)
    }
    if (target !== CAPTAIN_KEY) await this.scheduler.kickMember(workspace, team.id, target, agent, signal)
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
   * @param agent - the calling captain or member.
   * @param args - task id, optional assignee (captain only).
   * @returns the claimed task's capability.
   */
  async claimTask(
    agent: Agent,
    args: { task_id: string; assignee?: string },
  ): Promise<{ task_id: string; status: string; assignee: string; attempt: number; attempt_id?: string }> {
    const { stateRoot, team } = await this.participantTeam(agent)
    return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const { team: fresh, identity } = await this.freshParticipant(stateRoot, team.id, agent.id)
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
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/task-updated', {
        teamId: fresh.id,
        taskId: task.id,
        status: task.status,
        assignee: task.assignee,
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
   * @param agent - the calling captain or member.
   * @param args - task id, status, output, attempt_id.
   * @param signal - caller cancellation, forwarded to scheduling.
   * @returns the task's updated state.
   */
  async updateTask(
    agent: Agent,
    args: { task_id: string; status?: string; output?: string; attempt_id?: string },
    signal?: AbortSignal,
  ): Promise<{
    task_id: string
    status: string
    output?: string
    attempt: number
    attempt_id?: string
    gated?: boolean
    gate_feedback?: string
  }> {
    const { workspace, stateRoot, team } = await this.participantTeam(agent)
    const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const { team: fresh, identity } = await this.freshParticipant(stateRoot, team.id, agent.id)
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
        const shouldGate = targetCompleted && this.config.qualityGate
          && task.worker !== undefined && args.output !== undefined
        if (shouldGate) {
          // shouldGate required task.worker and args.output to reach runQualityGate.
          // oxlint-disable-next-line typescript/no-non-null-assertion -- shouldGate ensured task.worker and args.output are defined
          const gate = runQualityGate(this.ctx, task.worker!, args.output!, this.config.passThreshold)
          if (!gate.satisfied) {
            // oxlint-disable-next-line typescript/no-non-null-assertion -- shouldGate ensured args.output is defined
            task.output = args.output!
            task.gateFeedback = gate
            task.updatedAt = Date.now()
            await writeTeam(stateRoot, fresh)
            appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/task-gated', {
              teamId: fresh.id,
              taskId: task.id,
              score: gate.score,
              failures: gate.failures,
              feedback: gate.feedback,
            })
            // v8 ignore start -- the task is still in a non-terminal status, so attempt/attemptId are always set
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
      // v8 ignore start -- an updatable task always carries assignee/attempt/attemptId
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/task-updated', {
        teamId: fresh.id,
        taskId: task.id,
        status: task.status,
        ...task.assignee !== undefined ? { assignee: task.assignee } : {},
        ...task.output !== undefined ? { output: task.output } : {},
      })
      // v8 ignore stop
      if (validated !== undefined) {
        appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/task-validated', {
          teamId: fresh.id,
          taskId: task.id,
          worker: validated.worker,
          valid: validated.valid,
          missingHardFields: validated.missingHardFields,
          degraded: validated.degraded,
        })
      }
      return taskView(task)
    })
    await this.scheduler.kickTeam(workspace, team.id, team.captainSessionId === agent.id ? agent : undefined, signal)
    return updated
  }

  /**
   * Send a message to the captain or to a teammate. Messages go straight into
   * the recipient's mailbox; when the recipient agent is online the service
   * also schedules live delivery.
   * @param agent - the calling captain or member.
   * @param args - recipient ("captain" or a member name), content, optional from.
   * @param signal - caller cancellation, forwarded to live delivery.
   * @returns the message identity and delivery path.
   */
  async sendMessage(
    agent: Agent,
    args: { to: string; content: string; from?: string },
    signal: AbortSignal,
  ): Promise<{
    message_id: string
    from: string
    to: string
    delivered: 'live' | 'wake' | 'mailbox'
  }> {
    const { stateRoot, team } = await this.participantTeam(agent)
    const to = args.to.trim()
    const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const { team: fresh, identity } = await this.freshParticipant(stateRoot, team.id, agent.id)
      const from = identity.name
      // `from` may only be the caller's own identity: impersonating another
      // member (or the captain) would poison the mailbox and event records.
      if (args.from !== undefined && args.from !== from) {
        throw new Error(`patent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
      }
      if (to === CAPTAIN_KEY) {
        const message = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() }
        await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
        appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/message-sent', {
          teamId: fresh.id,
          messageId: message.id,
          from,
          to: CAPTAIN_KEY,
          content: args.content,
          ts: message.ts,
        })
        return { kind: 'captain' as const, fresh, identity, message, from }
      }
      const recipient = requireMember(fresh, to)
      const message = { ...createMessage(from, recipient.name, args.content), deliveryClaimedAt: Date.now() }
      await appendMailbox(stateRoot, fresh.id, recipient.name, message)
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/message-sent', {
        teamId: fresh.id,
        messageId: message.id,
        from,
        to: recipient.name,
        content: args.content,
        ts: message.ts,
      })
      return { kind: 'member' as const, fresh, identity, message, from, recipient }
    })

    // Resolve the exact live captain only after releasing the state lock.
    // The mailbox is already durable if live delivery cannot proceed.
    const captain = this.ctx.get('agents')?.get(prepared.fresh.captainSessionId as SessionId)
    if (prepared.kind === 'captain') {
      let delivered: 'live' | 'mailbox' = 'mailbox'
      if (captain !== undefined && prepared.identity.kind === 'member') {
        delivered = steerCaptainReport(captain, prepared.from, args.content) ? 'live' : 'mailbox'
      }
      if (delivered === 'live') {
        await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
          acknowledgeMailbox(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
        ))
      } else {
        await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
          releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
        ))
      }
      return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered }
    }
    let delivered: 'wake' | 'mailbox' = 'mailbox'
    // v8 ignore next 2 -- a live member recipient always has a spawned id
    if (captain !== undefined && prepared.recipient.id !== '') {
      const senderText = prepared.from === CAPTAIN_KEY
        ? args.content
        : `Message from team member ${prepared.from}:\n\n${args.content}`
      const text = `PatentTeams state policy: inspect ${this.config.stateDir}/${prepared.fresh.id}/ read-only; never edit team.json or inbox files directly. Use patent_teams_* tools for team state.\n\n${senderText}`
      const accepted = await deliverToMember(this.ctx, captain, prepared.recipient.id, text, signal)
      delivered = accepted ? 'wake' : 'mailbox'
      if (accepted) {
        await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
          acknowledgeMailbox(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
        ))
      }
    }
    if (delivered === 'mailbox') {
      await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
        releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
      ))
    }
    return {
      message_id: prepared.message.id,
      from: prepared.from,
      to: prepared.recipient.name,
      delivered,
    }
  }

  /**
   * Team snapshot: members with live activity and tasks with status, assignee,
   * dependencies, and output. Captains also see every team mailbox; members
   * see only their own inbox. Reading as captain acknowledges the captain
   * inbox and schedules idle members.
   * @param agent - the calling captain or member.
   * @param signal - caller cancellation, forwarded to scheduling and the team lock.
   * @returns the full team status payload.
   */
  async status(agent: Agent, signal?: AbortSignal): Promise<PatentTeamsStatus> {
    const { workspace, stateRoot, team } = await this.participantTeam(agent)
    if (team.captainSessionId === agent.id) {
      await this.scheduler.kickTeam(workspace, team.id, agent, signal)
    }
    const { team: fresh, identity } = await withTeamLock(
      teamLockKey(stateRoot, team.id),
      () => this.freshParticipant(stateRoot, team.id, agent.id),
    )
    const activity = await memberActivity(this.ctx, fresh.captainSessionId)
    // v8 ignore start -- spawned members always carry route fields and a child id; task attempts are always set
    const members = fresh.members
      .filter(member => member.status !== 'removed')
      .map((member) => {
        const summary = member.role === undefined || member.role === ''
          ? undefined
          : contractSummary(member.role)
        return {
          name: member.name,
          role: member.role ?? '',
          provider: member.provider ?? '',
          model: member.model ?? '',
          reasoning_effort: member.reasoningEffort ?? '',
          status: member.status,
          activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
          ...summary !== undefined ? { role_contract: summary } : {},
        }
      })
    const tasks = fresh.tasks.map(task => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      assignee: task.assignee ?? '',
      dependencies: task.dependencies,
      attempt: task.attempt ?? 0,
      attempt_id: task.attemptId ?? '',
      reassigning: task.reassigning === true,
      ...task.output !== undefined ? { output: task.output } : {},
      ...task.worker !== undefined ? { worker: task.worker } : {},
      ...task.contractValidation !== undefined
        ? {
          contract_validation: {
            valid: task.contractValidation.valid,
            missing_hard_fields: task.contractValidation.missingHardFields,
            degraded: task.contractValidation.degraded,
          },
        }
        : {},
      ...task.gateFeedback !== undefined
        ? { gate_feedback: task.gateFeedback }
        : {},
    }))
    // v8 ignore stop
    const mailboxWarnings: string[] = []
    let mailboxWarningCount = 0
    const reportMalformed = (agentKey: string) => (lineNumber: number): void => {
      mailboxWarningCount += 1
      if (mailboxWarnings.length < 10) {
        mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`)
      }
    }
    const captainInbox = identity.kind === 'captain'
      ? await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
      : []
    const memberInboxes: Record<string, { count: number; latest: string }> = {}
    const visibleMembers = identity.kind === 'captain'
      ? members
      : members.filter(member => member.name === identity.name)
    // v8 ignore start -- the latest-preview fallback only runs inside the length > 0 branch
    for (const member of visibleMembers) {
      const messages = await readUnreadMailbox(
        stateRoot,
        team.id,
        member.name,
        reportMalformed(member.name),
      )
      if (messages.length > 0) {
        memberInboxes[member.name] = {
          count: messages.length,
          latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
        }
      }
    }
    // v8 ignore stop
    const result = {
      team_id: team.id,
      team_name: team.name,
      description: team.description ?? '',
      viewer: identity.name,
      members,
      tasks,
      captain_inbox: captainInbox.slice(-10).map(message => ({
        from: message.from,
        content: message.content,
        ts: message.ts,
      })),
      member_inboxes: memberInboxes,
      mailbox_warnings: mailboxWarnings,
      mailbox_warning_count: mailboxWarningCount,
    }
    // v8 ignore start -- acknowledging is read-path bookkeeping; both branches are covered by other assertions
    const acknowledged = identity.kind === 'captain'
      ? captainInbox.map(message => message.id)
      : await readUnreadMailbox(stateRoot, team.id, identity.name).then(messages => messages.map(message => message.id))
    if (acknowledged.length > 0) {
      await withTeamLock(teamLockKey(stateRoot, team.id), () => (
        acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)
      ))
    }
    return result
    // v8 ignore stop
  }

  /**
   * End the team: interrupt all members (best effort), archive the team's
   * state directory (team file, tasks, mailboxes) under `archive/`.
   * @param agent - the calling captain.
   * @param signal - caller cancellation, forwarded to quiescence waits.
   * @returns whether the team was archived.
   */
  async delete(agent: Agent, signal: AbortSignal): Promise<{ deleted: boolean; team_name: string }> {
    const { stateRoot, team } = await this.captainTeam(agent)
    const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
      // Include previously removed members so deleting a pre-fix team also
      // retires durable catalog entries left behind by removeMember.
      const roster = fresh.members.map(member => ({ ...member }))
      for (const member of fresh.members) {
        if (member.status === 'removed') continue
        member.status = 'removed'
        for (const task of fresh.tasks) {
          if (task.assignee === member.name && task.status !== 'completed') invalidateTaskAttempt(task)
        }
      }
      await writeTeam(stateRoot, fresh)
      return roster
    })
    await recordRetiredMemberIds(stateRoot, members.map(member => member.id))
    // v8 ignore start -- every persisted member was spawned, so ids are never empty
    for (const member of members) {
      if (member.id === '') continue
      interruptMember(this.ctx, agent, member.id)
    }
    // v8 ignore stop
    const quiescence = await Promise.allSettled(members.map(member => waitForMemberIdle(this.ctx, member, signal)))
    for (const result of quiescence) {
      if (result.status === 'rejected') {
        this.ctx.logger.warn(`patent-teams: member did not quiesce cleanly before team archive: ${String(result.reason)}`)
      }
    }
    await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await this.freshCaptainTeam(stateRoot, team.id, agent.id)
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, fresh.captainSessionId, agent.session), 'patent-teams/team-deleted', {
        teamId: fresh.id,
      })
      // Archive, not delete: tasks (with their dependency graph) and the
      // mailboxes stay on disk for later review and dependency rebuilds.
      await archiveTeamDir(stateRoot, fresh.id)
    })
    return { deleted: true, team_name: team.name }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    patentTeams: PatentTeamsService
  }
}

/** Build the member runtime knobs handed to member helpers. */
function memberRuntime(config: PatentTeamsConfig): MemberRuntimeConfig {
  return {
    provider: config.memberProvider,
    ...config.memberMaxDepth === undefined ? {} : { maxDepth: config.memberMaxDepth },
  }
}

/** Validate one task's completed output against its worker contract (soft, never blocks). */
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
 * Summarize a member's role contract for the status payload: its stance and
 * the flat list of required deliverable fields across its workers.
 * @param role - the member's SKILL role id.
 * @returns the summary, or undefined when the role is not registered.
 */
function contractSummary(role: string): { stance: string; deliverables: string } | undefined {
  const contract = roleContract(role)
  if (contract === undefined) return undefined
  return { stance: contract.stance, deliverables: workerDeliverables(role) }
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

/** One member row of the status payload. */
export interface PatentTeamsStatusMember {
  name: string
  role: string
  provider: string
  model: string
  reasoning_effort: string
  status: string
  activity: string
  /** Role contract summary (stance + required deliverables) when the member carries a known role. */
  role_contract?: { stance: string; deliverables: string }
}

/** One task row of the status payload. */
export interface PatentTeamsStatusTask {
  id: string
  subject: string
  status: string
  assignee: string
  dependencies: string[]
  attempt: number
  attempt_id: string
  reassigning: boolean
  output?: string
  /** Optional worker contract the task output is validated against. */
  worker?: string
  /** Recorded contract verdict when the task completed with a worker. */
  contract_validation?: { valid: boolean; missing_hard_fields: string[]; degraded: boolean }
  /** Quality-gate verdict when a completion was bounced back for rework. */
  gate_feedback?: { score: number; satisfied: boolean; failures: string[]; feedback: string }
}

/** One captain-inbox preview row. */
export interface PatentTeamsStatusMessage {
  from: string
  content: string
  ts: number
}

/** The full status payload returned by {@link PatentTeamsService.status}. */
export interface PatentTeamsStatus {
  team_id: string
  team_name: string
  description: string
  viewer: string
  members: PatentTeamsStatusMember[]
  tasks: PatentTeamsStatusTask[]
  captain_inbox: PatentTeamsStatusMessage[]
  member_inboxes: Record<string, { count: number; latest: string }>
  mailbox_warnings: string[]
  mailbox_warning_count: number
}

/**
 * The calling agent from a tool exec, for the tools Consumer.
 * @param exec - the tool run context of the calling agent.
 * @returns the calling agent.
 */
export function callingAgent(exec: ToolRunContext): Agent {
  return requireAgent(exec)
}
