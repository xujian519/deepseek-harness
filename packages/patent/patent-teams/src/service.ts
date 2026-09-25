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
import { roleContract, workerDeliverables } from '@deepseek-ai/dsh-patent-workflow'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import { PatentTeamsMessageId, PatentTeamsTeamId } from './ids.ts'
import {
  acknowledgeMailbox,
  appendMailbox,
  createMessage,
  readUnreadMailbox,
  releaseMailboxDelivery,
} from './mailbox.ts'
import * as memberOps from './member-runtime.ts'
import { deliverToMember, interruptMember, memberActivity, waitForMemberIdle } from './members.ts'
import { installTeamScheduler, type TeamScheduler } from './scheduler.ts'
import {
  archiveTeamDir,
  CAPTAIN_KEY,
  createTeamDir,
  findTeamByCaptain,
  invalidateTaskAttempt,
  listArchivedTeamIds,
  readArchivedTeam,
  readTeam,
  recordRetiredMemberIds,
  writeTeam,
} from './state.ts'
import * as taskOps from './task-ops.ts'
import {
  captainTeam,
  freshCaptainTeam,
  freshParticipant,
  participantTeam,
  requireMember,
  stateRootFor,
  withParticipant,
} from './team-access.ts'
import { sanitizeKey, teamLockKey, withTeamLock } from './team-lock.ts'
import type { TeamState } from './types.ts'

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

/**
 * Deliver a durable member report at the captain's nearest model boundary.
 *
 * `Agent.steer()` targets the next step while the captain is running, wakes a
 * new turn when it is idle, and lets the Agent runtime reclassify an aborted
 * activity to `next-turn`. This prevents reports from waiting behind the
 * captain's entire orchestration turn.
 */
function steerCaptainReport(
  captain: Pick<Agent, 'steer'>,
  from: string,
  senderSessionId: string,
  content: string,
): boolean {
  try {
    captain.steer(createUserMessage({
      content: [{ type: 'text', text: `PatentTeams message from member ${from}:\n\n${content}` }],
      source: { kind: 'patent-teams-report', form: 'relay', from, senderSessionId },
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
 *
 * The task state machine lives in `task-ops.ts` and the member lifecycle in
 * `member-runtime.ts`; both receive the projections built here, because the
 * resolved config is this service's to read once.
 */
export class PatentTeamsService extends Service {
  private readonly config: PatentTeamsConfig
  private readonly scheduler: TeamScheduler
  private readonly tasks: taskOps.TaskOpsHost
  private readonly members: memberOps.MemberOpsHost

  /**
   * @param ctx - the plugin context the service registers on.
   * @param config - the resolved plugin configuration.
   */
  constructor(ctx: Context, config: PatentTeamsConfig) {
    super(ctx, 'patentTeams')
    this.config = config
    this.scheduler = installTeamScheduler(ctx, { stateDir: config.stateDir })
    this.tasks = {
      ctx,
      stateDir: config.stateDir,
      scheduler: this.scheduler,
      qualityGate: config.qualityGate,
      passThreshold: config.passThreshold,
    }
    this.members = {
      ctx,
      stateDir: config.stateDir,
      memberProvider: config.memberProvider,
      ...config.memberModel === undefined ? {} : { memberModel: config.memberModel },
      ...config.memberMaxDepth === undefined ? {} : { memberMaxDepth: config.memberMaxDepth },
      maxMembers: config.maxMembers,
      scheduler: this.scheduler,
    }
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
    const stateRoot = stateRootFor(agent, this.config.stateDir)
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
          teamId: PatentTeamsTeamId(state.id),
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
   * requested role-specific route. The route resolution and the child spawn
   * run outside the team lock so one add never stalls the team's other tools;
   * admission and persistence revalidate inside the lock, and a spawn that
   * loses a concurrent race is retired before its failure surfaces.
   * @param agent - the calling captain.
   * @param args - member name, role, optional route/effort.
   * @param signal - caller cancellation, forwarded to the spawn.
   * @returns the created member's identity.
   */
  async addMember(
    agent: Agent,
    args: memberOps.AddMemberArgs,
    signal: AbortSignal,
  ): Promise<memberOps.AddMemberResult> {
    return memberOps.addMember(this.members, agent, args, signal)
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
  async removeMember(agent: Agent, name: string, signal: AbortSignal): Promise<memberOps.RemoveMemberResult> {
    return memberOps.removeMember(this.members, agent, name, signal)
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
    args: taskOps.CreateTaskArgs,
    signal?: AbortSignal,
  ): Promise<taskOps.CreateTaskResult> {
    return taskOps.createTask(this.tasks, agent, args, signal)
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
    args: taskOps.ReassignTaskArgs,
    signal: AbortSignal,
  ): Promise<taskOps.ReassignTaskResult> {
    return taskOps.reassignTask(this.tasks, agent, args, signal)
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
    args: taskOps.ClaimTaskArgs,
  ): Promise<taskOps.ClaimTaskResult> {
    return taskOps.claimTask(this.tasks, agent, args)
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
    args: taskOps.UpdateTaskArgs,
    signal?: AbortSignal,
  ): Promise<taskOps.UpdateTaskResult> {
    return taskOps.updateTask(this.tasks, agent, args, signal)
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
    const { stateRoot, team } = await participantTeam(agent, this.config.stateDir)
    const to = args.to.trim()
    const prepared = await withParticipant(stateRoot, team.id, agent.id, async (fresh, identity) => {
      const from = identity.name
      // `from` may only be the caller's own identity: impersonating another
      // member (or the captain) would poison the mailbox and event records.
      if (args.from !== undefined && args.from !== from) {
        throw new Error(`patent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
      }
      if (to === CAPTAIN_KEY) {
        const message = { ...createMessage(from, CAPTAIN_KEY, args.content), deliveryClaimedAt: Date.now() }
        await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
        appendTeamEvent(this.ctx, captainSessionOf(this.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/message-sent', {
          teamId: PatentTeamsTeamId(fresh.id),
          messageId: PatentTeamsMessageId(message.id),
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
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/message-sent', {
        teamId: PatentTeamsTeamId(fresh.id),
        messageId: PatentTeamsMessageId(message.id),
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
        delivered = steerCaptainReport(captain, prepared.from, prepared.identity.sessionId, args.content) ? 'live' : 'mailbox'
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
    const { workspace, stateRoot, team } = await participantTeam(agent, this.config.stateDir)
    if (team.captainSessionId === agent.id) {
      await this.scheduler.kickTeam(workspace, team.id, agent, signal)
    }
    const { team: fresh, identity } = await withTeamLock(
      teamLockKey(stateRoot, team.id),
      () => freshParticipant(stateRoot, team.id, agent.id),
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
    const { stateRoot, team } = await captainTeam(agent, this.config.stateDir)
    const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
      const fresh = await freshCaptainTeam(stateRoot, team.id, agent.id)
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
    for (const member of members) {
      this.scheduler.untrackMember(member.id)
    }
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
      const fresh = await freshCaptainTeam(stateRoot, team.id, agent.id)
      appendTeamEvent(this.ctx, captainSessionOf(this.ctx, SessionId(fresh.captainSessionId), agent.session), 'patent-teams/team-deleted', {
        teamId: PatentTeamsTeamId(fresh.id),
      })
      // Archive, not delete: tasks (with their dependency graph) and the
      // mailboxes stay on disk for later review and dependency rebuilds.
      await archiveTeamDir(stateRoot, fresh.id)
    })
    return { deleted: true, team_name: team.name }
  }

  /**
   * Read this workspace's archived teams: one team's full record in detail,
   * or a summary row per archived team. Archived records are immutable after
   * {@link PatentTeamsService.delete}; this method only reads them.
   * @param agent - any calling agent in the workspace (the archive is workspace-scoped).
   * @param teamId - optional archived team id to show in detail.
   * @returns the archive listing, or the one team's detail record.
   */
  async archive(agent: Agent, teamId?: string): Promise<PatentTeamsArchive> {
    const stateRoot = stateRootFor(agent, this.config.stateDir)
    if (teamId !== undefined) {
      const team = await readArchivedTeam(stateRoot, teamId)
      if (team === undefined) {
        const available = (await listArchivedTeamIds(stateRoot)).join(', ') || 'none'
        throw new Error(`no archived team "${teamId}" in this workspace — archived teams: ${available}`)
      }
      return {
        mode: 'detail',
        team: {
          team_id: team.id,
          team_name: team.name,
          created_at: team.createdAt,
          ...team.description !== undefined ? { description: team.description } : {},
          members: team.members.map(member => ({
            name: member.name,
            role: member.role ?? '',
          })),
          tasks: team.tasks.map(task => ({
            id: task.id,
            subject: task.subject,
            status: task.status,
            assignee: task.assignee ?? '',
            dependencies: task.dependencies,
            ...task.output !== undefined ? { output: task.output } : {},
          })),
        },
      }
    }
    const teams: PatentTeamsArchiveSummary[] = []
    for (const archivedId of await listArchivedTeamIds(stateRoot)) {
      const team = await readArchivedTeam(stateRoot, archivedId)
      if (team === undefined) continue
      teams.push({
        team_id: team.id,
        team_name: team.name,
        created_at: team.createdAt,
        members: team.members.length,
        tasks: team.tasks.length,
        completed_tasks: team.tasks.filter(task => task.status === 'completed').length,
      })
    }
    return { mode: 'list', teams }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    patentTeams: PatentTeamsService
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

/** One archived-team summary row. */
export interface PatentTeamsArchiveSummary {
  team_id: string
  team_name: string
  created_at: number
  members: number
  tasks: number
  completed_tasks: number
}

/** One archived team's detail record (members and tasks as archived). */
export interface PatentTeamsArchiveDetail {
  team_id: string
  team_name: string
  created_at: number
  description?: string
  members: { name: string; role: string }[]
  tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; output?: string }[]
}

/** The payload returned by {@link PatentTeamsService.archive}: the listing or one team's detail. */
export type PatentTeamsArchive =
  | { mode: 'list'; teams: PatentTeamsArchiveSummary[] }
  | { mode: 'detail'; team: PatentTeamsArchiveDetail }

/**
 * The calling agent from a tool exec, for the tools Consumer.
 * @param exec - the tool run context of the calling agent.
 * @returns the calling agent.
 */
export function callingAgent(exec: ToolRunContext): Agent {
  return requireAgent(exec)
}
