/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member.
 * @module dsh-patent-teams/scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { deliverToMember } from './members.ts'
import {
  acknowledgeMailbox,
  beginTaskAttempt,
  claimMailboxDelivery,
  findTeamByParticipant,
  readTeam,
  readUnreadMailbox,
  releaseMailboxDelivery,
  stateRootOf,
  teamLockKey,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import type { TeamMember, TeamTask } from './types.ts'

/** Scheduler configuration: where team state lives on disk. */
export interface SchedulerConfig {
  readonly stateDir: string
}

/** The team scheduler: serialized, ready-work dispatch to idle members. */
export interface TeamScheduler {
  /** Try to give every genuinely idle/ready member one unit of ready work. */
  kickTeam(workspace: string, teamId: string, captain?: Agent, signal?: AbortSignal): Promise<void>
  /** Try to flush fallback mail or give one member one ready task. */
  kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent, signal?: AbortSignal): Promise<void>
  /**
   * Record a freshly persisted member so its status events skip the state
   * directory scan (spawning is the only way a live agent becomes a member).
   * @param memberId - the member's durable child session id.
   * @param teamId - the member's team id.
   * @param memberName - the member's display name.
   */
  trackMember(memberId: string, teamId: string, memberName: string): void
  /**
   * Drop a member's observer fast-path entry so its next event rescans.
   * @param memberId - the member's durable child session id.
   */
  untrackMember(memberId: string): void
}

interface DispatchTicket {
  readonly taskId: string
  readonly memberName: string
  readonly memberId: string
  readonly attempt: number
  readonly attemptId: string
  readonly previousAssignee?: string
  readonly subject: string
  readonly description?: string
}

function liveCaptain(ctx: Context, captainSessionId: string, supplied?: Agent): Agent | undefined {
  if (supplied !== undefined && supplied.id === captainSessionId) return supplied
  return ctx.get('agents')?.get(captainSessionId as SessionId)
}

function isMemberAvailable(ctx: Context, member: TeamMember): boolean {
  const live = ctx.get('agents')?.get(member.id as SessionId)
  return live === undefined || live.status === 'idle'
}

function ownedOpenTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  return tasks.find(task => task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

function nextReadyTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  const ready = tasks.filter(task => task.status === 'pending'
    && task.reassigning !== true
    && unsatisfiedDependencies([...tasks], task.dependencies).length === 0)
  return ready.find(task => task.assignee === memberName)
    ?? ready.find(task => task.assignee === undefined)
}

function assignmentPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string {
  const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`
  return `PatentTeams automatic task assignment from the shared task list.

Task: ${ticket.taskId} — ${ticket.subject}${description}
Attempt: ${ticket.attempt}
Attempt id: ${ticket.attemptId}

Call patent_teams_claim_task for ${ticket.taskId}; it will return this same attempt_id. Include attempt_id=${ticket.attemptId} in every patent_teams_update_task call. If it is rejected as stale, stop work because the task was reassigned. Work only this task in this turn, report the result to the captain, then become idle so the scheduler can select your next ready task.

State policy: ${stateDir}/${teamId}/ is read-only diagnostics; mutate team state only through patent_teams_* tools.`
}

function fallbackMailboxPrompt(messages: Awaited<ReturnType<typeof readUnreadMailbox>>): string {
  return [
    'PatentTeams delivered messages that were persisted while live delivery was unavailable:',
    ...messages.map(message => `\nFrom ${message.from}:\n${message.content}`),
    '\nHandle these messages in this turn. Task assignments still require patent_teams_claim_task and the current attempt_id.',
  ].join('\n')
}

/**
 * Install one scheduler and its member activity observer.
 * @param ctx - registrant context carrying the agent registry.
 * @param config - the scheduler's state-directory configuration.
 * @returns the installed scheduler runtime.
 */
export function installTeamScheduler(ctx: Context, config: SchedulerConfig): TeamScheduler {
  const memberQueues = new Map<string, Promise<unknown>>()

  const serializeMember = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = memberQueues.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    memberQueues.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (memberQueues.get(key) === tail) memberQueues.delete(key)
    }
  }

  /**
   * Observer fast path: agent session id → the team it works for. `null`
   * marks an agent already proven to captain or lie outside every team, so
   * its status events stop rescanning the whole state directory; only
   * `addMember` turns a live agent into a member, and it tracks itself.
   * Null entries insert only when no entry exists: a scan that started
   * before `addMember` persisted must resolve without clobbering the
   * positive entry the spawn path recorded, while the positive set always
   * overwrites a transient null.
   */
  const memberIndex = new Map<string, { teamId: string; memberName: string } | null>()

  const runtime: TeamScheduler = {
    async kickTeam(workspace, teamId, suppliedCaptain, signal) {
      const stateRoot = stateRootOf(workspace, config.stateDir)
      const team = await readTeam(stateRoot, teamId)
      if (team === undefined) return
      const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
      if (captain === undefined) return
      for (const member of team.members) {
        if (member.status === 'removed') continue
        await runtime.kickMember(workspace, teamId, member.name, captain, signal)
      }
    },

    async kickMember(workspace, teamId, memberName, suppliedCaptain, signal) {
      const stateRoot = stateRootOf(workspace, config.stateDir)
      const queueKey = `${stateRoot}\u0000${teamId}\u0000${memberName}`
      await serializeMember(queueKey, async () => {
        const team = await readTeam(stateRoot, teamId)
        if (team === undefined) return
        const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
        if (captain === undefined) return
        const member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
        if (member === undefined || member.id === '' || !isMemberAvailable(ctx, member)) return

        // A mailbox-only fallback is real pending work. Deliver it before a
        // fresh task and acknowledge only after Harness accepts the follow-up.
        const unread = await readUnreadMailbox(stateRoot, team.id, member.name)
        if (unread.length > 0) {
          await withTeamLock(teamLockKey(stateRoot, team.id), () => (
            claimMailboxDelivery(stateRoot, team.id, member.name, unread.map(message => message.id))
          ))
          const accepted = await deliverToMember(
            ctx,
            captain,
            member.id,
            fallbackMailboxPrompt(unread),
            signal ?? new AbortController().signal,
          )
          if (accepted) {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              acknowledgeMailbox(stateRoot, team.id, member.name, unread.map(message => message.id))
            ))
          } else {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              releaseMailboxDelivery(stateRoot, team.id, member.name, unread.map(message => message.id))
            ))
          }
          return
        }

        const ticket = await withTeamLock(teamLockKey(stateRoot, team.id), async (): Promise<DispatchTicket | undefined> => {
          const fresh = await readTeam(stateRoot, team.id)
          if (fresh === undefined) return undefined
          const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
          if (currentMember === undefined || currentMember.id === '' || !isMemberAvailable(ctx, currentMember)) return undefined
          // An idle/ready member that still owns an open task lost the turn
          // that was executing it (model stopped early, interrupt settlement,
          // or process restart). Retry that task with a fresh capability
          // instead of permanently treating the durable claim as "busy".
          const task = ownedOpenTask(fresh.tasks, currentMember.name)
            ?? nextReadyTask(fresh.tasks, currentMember.name)
          if (task === undefined) {
            if (currentMember.status !== 'idle') {
              currentMember.status = 'idle'
              await writeTeam(stateRoot, fresh)
            }
            return undefined
          }
          const previousAssignee = task.assignee
          const attemptId = beginTaskAttempt(task, currentMember.name)
          currentMember.status = 'working'
          await writeTeam(stateRoot, fresh)
          return {
            taskId: task.id,
            memberName: currentMember.name,
            memberId: currentMember.id,
            // v8 ignore next -- beginTaskAttempt always sets attempt before the ticket is built
            attempt: task.attempt ?? 1,
            attemptId,
            ...previousAssignee === undefined ? {} : { previousAssignee },
            subject: task.subject,
            ...task.description === undefined ? {} : { description: task.description },
          }
        })
        if (ticket === undefined) return

        const accepted = await deliverToMember(
          ctx,
          captain,
          ticket.memberId,
          assignmentPrompt(ticket, config.stateDir, team.id),
          signal ?? new AbortController().signal,
        )
        if (accepted) return

        // Roll back only our exact failed dispatch. A concurrent captain
        // handoff has already changed the capability and wins.
        await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team.id)
          if (fresh === undefined) return
          const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId)
          if (task?.attemptId !== ticket.attemptId) return
          task.status = 'pending'
          if (ticket.previousAssignee === undefined) {
            delete task.assignee
          } else {
            task.assignee = ticket.previousAssignee
          }
          delete task.attemptId
          delete task.handoffId
          task.reassigning = false
          task.updatedAt = Date.now()
          const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName)
          if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
          await writeTeam(stateRoot, fresh)
        })
      })
    },

    trackMember(memberId, teamId, memberName) {
      memberIndex.set(memberId, { teamId, memberName })
    },

    untrackMember(memberId) {
      memberIndex.delete(memberId)
    },
  }

  /** Mirror one agent status edge into its member record and kick it idle. */
  const syncKnownMember = async (
    agent: Agent,
    status: AgentStatus,
    member: { teamId: string; memberName: string },
  ): Promise<void> => {
    const workspace = agent.session.header.cwd ?? process.cwd()
    const stateRoot = stateRootOf(workspace, config.stateDir)
    await withTeamLock(teamLockKey(stateRoot, member.teamId), async () => {
      const fresh = await readTeam(stateRoot, member.teamId)
      const current = fresh?.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
      if (fresh === undefined || current === undefined) return
      const next = status === 'running' ? 'working' : 'idle'
      if (current.status === next) return
      current.status = next
      await writeTeam(stateRoot, fresh)
    })
    if (status === 'idle') await runtime.kickMember(workspace, member.teamId, member.memberName)
  }

  const syncMemberStatus = async (agent: Agent, status: AgentStatus): Promise<void> => {
    const cached = memberIndex.get(agent.id)
    if (cached !== undefined) {
      if (cached !== null) await syncKnownMember(agent, status, cached)
      return
    }
    const workspace = agent.session.header.cwd ?? process.cwd()
    const stateRoot = stateRootOf(workspace, config.stateDir)
    const located = await findTeamByParticipant(stateRoot, agent.id)
    if (located === undefined || located.captainSessionId === agent.id) {
      if (!memberIndex.has(agent.id)) memberIndex.set(agent.id, null)
      return
    }
    // v8 ignore next 3 -- findTeamByParticipant only matches surviving members, so this guard is defensive
    const member = located.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
    if (member === undefined) {
      if (!memberIndex.has(agent.id)) memberIndex.set(agent.id, null)
      return
    }
    const entry = { teamId: located.id, memberName: member.name }
    memberIndex.set(agent.id, entry)
    await syncKnownMember(agent, status, entry)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    void syncMemberStatus(agent, status).catch((error: unknown) => {
      ctx.logger.warn(`patent-teams: member status scheduling failed for ${agent.id}: ${String(error)}`)
    })
  })

  return runtime
}
