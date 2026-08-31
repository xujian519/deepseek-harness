/**
 * The `patent_teams_*` model-facing tools, the sole Consumer of
 * {@link PatentTeamsService}.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state: create team → add members → create tasks with
 * dependencies → claim/assign → work → report → status → delete.
 * @module @deepseek-ai/dsh-patent-teams/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { callingAgent, type PatentTeamsService, type PatentTeamsStatus } from './service.ts'

/** Render the status snapshot as compact text for the model. */
function renderStatus(team: PatentTeamsStatus): string {
  const lines: string[] = [
    `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}`,
    `Viewing as: ${team.viewer}`,
    `Members (${team.members.length}):`,
    ...team.members.map((member) => {
      const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : ''
      const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : ''
      const contract = member.role_contract
        ? ` · role: ${member.role_contract.stance} (交付: ${member.role_contract.deliverables})`
        : ''
      return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}${contract}`
    }),
    `Tasks (${team.tasks.length}):`,
    ...team.tasks.map((task) => {
      const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : ''
      const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : ''
      const handoff = task.reassigning ? ' (reassigning)' : ''
      const worker = task.worker ? ` · worker: ${task.worker}` : ''
      const validation = task.contract_validation
        ? ` · contract: ${task.contract_validation.valid ? 'ok' : `degraded(${task.contract_validation.missing_hard_fields.join('、')})`}`
        : ''
      const gated = task.gate_feedback && !task.gate_feedback.satisfied
        ? ` · gated: ${task.gate_feedback.score.toFixed(2)} (${task.gate_feedback.failures.join('、')})`
        : ''
      return `  - ${task.id} [${task.status}] attempt ${task.attempt}${handoff} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${worker}${validation}${gated}${output}`
    }),
    `Captain inbox (${team.captain_inbox.length}):`,
    ...team.captain_inbox.map(message => `  - [${message.from}] ${message.content.slice(0, 200)}`),
  ]
  for (const [name, inbox] of Object.entries(team.member_inboxes)) {
    lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`)
  }
  if (team.mailbox_warning_count > 0) {
    lines.push(
      `Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`,
      ...team.mailbox_warnings.map(warning => `  - ${warning}`),
    )
  }
  return lines.join('\n')
}

/**
 * Register every `patent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`); `ctx.patentTeams` must be mounted.
 */
export function registerPatentTeamsTools(ctx: Context): void {
  const teams: PatentTeamsService = ctx.patentTeams

  ctx.tools.register(defineTool({
    name: 'patent_teams_create',
    description: 'Create a new PatentTeams team: you (the calling agent) become the captain. A captain leads one team at a time; create tasks and members afterwards with patent_teams_add_member and patent_teams_create_task.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
      description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          team_name: { type: 'string', required: true },
          state_dir: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" created (id ${value.team_id}) under ${value.state_dir}. You are the captain.`,
      }],
    },
    async execute(args, exec) {
      return teams.create(callingAgent(exec), args.name, args.description)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_add_member',
    description: 'Add a durable continuable member. By default it snapshots the captain\'s current LLM route and effort. Supply provider/model only for an explicitly requested role-specific route; a changed provider or model automatically uses the target model\'s default effort. Set reasoning_effort only to request one of the target model\'s supported ids explicitly (or "default" to force its default). The member waits for messages, works on assigned tasks, and can message the team.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
      role: { type: 'string', description: 'Role of the member (e.g. case-manager, researcher, drafter, technical-expert, adversarial-reviewer, applicant-counsel, formal-examiner, invalidity-petitioner, patentee-defender, adjudicator, defendant-counsel, tech-investigator).' },
      provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
      model: { type: 'string', description: 'Optional model override. Omit for the captain\'s current model (or the configured memberModel default).' },
      reasoning_effort: { type: 'string', description: 'Optional reasoning effort override: one of the target model\'s supported effort ids, or "default" to force its default. When omitted, the captain\'s effort is inherited only for the same provider/model; a changed route uses the target default.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          member_id: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          reasoning_effort: { type: 'string' },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" added (subagent id ${value.member_id}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      return teams.addMember(callingAgent(exec), args, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_remove_member',
    description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name of the member to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
      }],
    },
    async execute(args, exec) {
      return teams.removeMember(callingAgent(exec), args.name, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_create_task',
    description: 'Create a task in your team\'s task list. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Brief title for the task.' },
      description: { type: 'string', description: 'What needs to be done, in detail.' },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task ids this task depends on (must be completed before this task can be claimed).',
      },
      assignee: { type: 'string', description: 'Optional member name this task is intended for.' },
      worker: { type: 'string', description: 'Optional worker contract the task output is validated against on completion (e.g. patent-search-commander, patent-oa-writer).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}${value.assignee ? `, assigned to ${value.assignee}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      return teams.createTask(callingAgent(exec), args, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_reassign_task',
    description: 'Atomically retry, reassign, or let the captain take over any unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" for captain takeover.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
      assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
      reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          previous_assignee: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      return teams.reassignTask(callingAgent(exec), args, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_claim_task',
    description: 'Claim one ready task for a member (or yourself). A member cannot own a second unfinished task. The returned attempt_id is required for that member\'s updates and becomes stale after retry/reassignment.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to claim.' },
      assignee: { type: 'string', description: 'Member to claim for (captain only; defaults to the task\'s assignee).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      return teams.claimTask(callingAgent(exec), args)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_update_task',
    description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable. A captain must use reassign_task(assignee="captain") before updating member-owned work.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to update.' },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed', 'cancelled'],
        description: 'New status (in_progress, completed, failed, cancelled).',
      },
      output: { type: 'string', description: 'Result summary; set when completing or failing.' },
      attempt_id: { type: 'string', description: 'Current execution capability returned by claim_task (required for members when present on the task).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          output: { type: 'string' },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
          gated: { type: 'boolean' },
          gate_feedback: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.gated === true
          ? `Task ${value.task_id} 未过质量门禁（保持 ${value.status}）:\n${value.gate_feedback ?? ''}`
          : `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}`,
      }],
    },
    async execute(args, exec) {
      return teams.updateTask(callingAgent(exec), args, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_send_message',
    description: 'Send a message to the captain or to a teammate. Messages go straight into the recipient\'s mailbox; when the captain agent is online the plugin also schedules live delivery (member recipients get the message as their next turn; a running captain sees it at the nearest model step). No relay is involved: teammates talk to each other directly.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
      content: { type: 'string', required: true, description: 'The message text.' },
      from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message_id: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), or mailbox (durable inbox only).' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
      }],
    },
    async execute(args, exec) {
      return teams.sendMessage(callingAgent(exec), args, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_status',
    description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Poll this to watch progress.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{
        type: 'text',
        text: renderStatus(value as unknown as PatentTeamsStatus),
      }],
    },
    async execute(_args, exec) {
      // The schema stays open (additionalProperties) while the service type
      // keeps every field named; the cast bridges the open-output contract.
      return (await teams.status(callingAgent(exec), exec.signal)) as unknown as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'patent_teams_delete',
    description: 'End your team: interrupts all members (best effort) and archives the team\'s state directory (team file, tasks, mailboxes). Use when the team\'s work is done or abandoned.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          team_name: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" deleted.`,
      }],
    },
    async execute(_args, exec) {
      return teams.delete(callingAgent(exec), exec.signal)
    },
  }))
}
