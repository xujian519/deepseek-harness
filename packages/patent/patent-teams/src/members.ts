/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * messages into its FIFO inbox, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * wakes it with {@link ctx.subagents.sendMessage}, it works through its turn
 * (updating team state through the `patent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `patent_teams_status`.
 * @module dsh-patent-teams/members
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Declaration merge only: makes ctx.subagents visible.
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { workerDeliverables, type RoleContract } from '@deepseek-ai/dsh-patent-workflow'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { readRetiredMemberIds } from './state.ts'
import type { TeamMember, TeamState } from './types.ts'

/** Captain-only PatentTeams tools hidden from newly spawned members. */
const MEMBER_DENIED_TOOLS = [
  'patent_teams_create',
  'patent_teams_add_member',
  'patent_teams_remove_member',
  'patent_teams_reassign_task',
  'patent_teams_create_task',
  'patent_teams_delete',
] as const

/**
 * Restore the SessionId brand on a value that round-tripped through the
 * durable team file. The brand is erased by JSON serialization; the value
 * originated from `startContinuable`/`agent.id`, so this cast is the boundary
 * restoration, not a new assertion.
 */
function brandedSessionId(value: string): SessionId {
  return value as SessionId
}

/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
  /** Registered `ctx.subagents` provider name (must support continuable + persona). */
  provider: string
  /** Child delegation depth cap (0 forbids delegation entirely). */
  maxDepth?: number
}

/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
  reasoningEffort?: string
}

/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
  /** Explicit LLM provider route; requires an explicit model. */
  provider?: string
  /** Explicit model id; otherwise the plugin default or captain model is used. */
  model?: string
  /** Plugin-level member model default. */
  defaultModel?: string
  /** Explicit reasoning effort; "default" selects the target model's default effort. */
  reasoningEffort?: string
}

const MEMBER_LABEL_PREFIX = 'patent-teams:'

/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. When provider or model
 * changes, effort is intentionally omitted so the target model materializes
 * its own default instead of receiving an adapter-owned id from another route.
 * An explicit effort overrides either policy; the sentinel "default" also
 * selects the target model's default. The final effort is validated against
 * the target model before a child is created.
 * @param ctx - registrant context with the llm route and model registry.
 * @param captain - the parent agent whose route and effort the member snapshots.
 * @param request - the member's requested provider/model/effort selection.
 * @param signal - optional abort signal for the selection resolution.
 * @returns the member's complete llm selection.
 */
export async function resolveMemberLlmSelection(
  ctx: Context,
  captain: Agent,
  request: MemberLlmSelectionRequest,
  signal?: AbortSignal,
): Promise<MemberLlmSelection> {
  const explicitProvider = request.provider?.trim()
  const explicitModel = request.model?.trim()
  const defaultModel = request.defaultModel?.trim()
  const explicitEffort = request.reasoningEffort?.trim()
  if (request.provider !== undefined && explicitProvider === '') {
    throw new Error('member LLM provider must not be empty')
  }
  if (request.model !== undefined && explicitModel === '') {
    throw new Error('member model must not be empty')
  }
  if (request.defaultModel !== undefined && defaultModel === '') {
    throw new Error('configured memberModel must not be empty')
  }
  if (request.reasoningEffort !== undefined && explicitEffort === '') {
    throw new Error('member reasoning effort must not be empty')
  }
  if (explicitProvider !== undefined && explicitModel === undefined) {
    throw new Error('an explicit member LLM provider requires an explicit member model')
  }

  const current = captain.session.requestHeader()?.config
  const currentProvider = current?.provider ?? captain.options.provider
  const currentModel = current?.model ?? captain.options.model
  const provider = explicitProvider ?? currentProvider
  const model = explicitModel ?? defaultModel ?? currentModel
  if (provider === undefined || model === undefined) {
    throw new Error('cannot resolve the member LLM route from the current captain session')
  }

  // Effort ids belong to one exact provider/model capability. Preserve the
  // captain's effort only on the same route; a changed route must resolve its
  // own default. Explicit effort still wins, while "default" forces that
  // target-default behavior even when the route did not change.
  const sameRoute = provider === currentProvider && model === currentModel
  const reasoningEffort = explicitEffort === undefined
    ? sameRoute
      ? current?.reasoningEffort
      : undefined
    : explicitEffort === 'default'
      ? undefined
      : ReasoningEffortId(explicitEffort)
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('patent-teams: llm service is not available; cannot resolve the member LLM route')
  }
  const resolved = await llm.resolveCallConfig({
    provider,
    model,
    ...reasoningEffort === undefined
      ? {}
      : { reasoningEffort },
  }, signal)
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(resolved.reasoningEffort) },
  }
}

/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section. When a
 * team role contract is given it is folded in as a dedicated role section
 * (the role's stance, required deliverables, forbidden actions, and HITL
 * flag), so a member knows its scope beyond the generic working rules.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - configured state directory, so the member can locate the
 *   team files with its own file tools.
 * @param roleContract - the team role's contract, when the member carries a role.
 * @returns the member's system prompt (persona).
 */
export function memberPersona(
  team: TeamState,
  member: TeamMember,
  stateDir: string,
  roleContract?: RoleContract,
): string {
  const roleLine = member.role ? ` with the role: ${member.role}` : ''
  const contractBlock = roleContract === undefined ? '' : roleSection(roleContract)
  return `You are ${member.name}, a member of the multi-agent team "${team.name}" running inside DeepSeek Harness PatentTeams. The captain leads the team; you are a worker member${roleLine}.

Team context:
- Team id: ${team.id}
- Your name inside the team (use it as \`from\`/identity): ${member.name}
- The team state lives under ${stateDir}/${team.id}/ (team.json and inbox/*.jsonl). You may inspect these files read-only for diagnostics, but never edit them directly; use the patent_teams_* tools so JSON escaping and concurrent updates stay safe.
- The captain and your teammates reach you through messages. Each message you receive is a new turn: act on it and end your turn with a concise reply.
${contractBlock}
Working rules:
1. When you receive a task assignment, call patent_teams_claim_task with the task id. Keep the returned attempt_id: include it in every patent_teams_update_task call for that execution attempt. Then mark the task in_progress.
2. Work thoroughly with your available tools; do not cut corners.
3. When finished, call patent_teams_update_task with the same attempt_id, status=completed, and a concise \`output\` summarizing what you did and the key results. A stale-attempt rejection means the captain reassigned or took over the task; stop touching that task and wait for new work.
4. Send a short report to the captain with patent_teams_send_message (to=captain) when you complete a task or hit a blocker.
5. To ask a teammate something, use patent_teams_send_message with to=<teammate name>; the message lands in their mailbox and wakes them directly — teammates talk to each other without the captain in the loop. The same applies to the captain (to=captain).
6. After your turn becomes idle, the shared task scheduler may assign your next ready task automatically. Never claim a second task while you still own unfinished work.
7. You are a worker: do not create or delete teams, reassign tasks, or add/remove members — that is the captain's job.`
}

/** Render one team role's contract as a guide section for the persona. */
function roleSection(contract: RoleContract): string {
  const deliverables = workerDeliverables(contract.role)
  const forbidden = contract.forbiddenActions.join('、')
  const hitl = contract.triggersHITL
    ? 'deliverables need human confirmation before the final output'
    : 'deliverables can be completed directly'
  return `Role contract:
- Role: ${contract.name} (${contract.role})
- Stance: [${contract.stance}] ${contract.description}
- Required deliverables: ${deliverables}
- Forbidden: ${forbidden}
- HITL: ${hitl}`
}

/**
 * The initial user message delivered when the member is created.
 * @param team - the team the member joined.
 * @returns the initial welcome message.
 */
export function memberWelcome(team: TeamState): string {
  return `You have joined the team "${team.name}" as a member. The captain will send you tasks and messages; wait for instructions. Current team status: ${team.tasks.length} task(s), none assigned to you yet.`
}

/**
 * Spawn one member as a durable continuable subagent of the captain and fill
 * `member.id` with its child session id. On failure nothing is persisted.
 * @param ctx - the plugin context (injects `subagents`).
 * @param config - member runtime knobs.
 * @param llmSelection - resolved provider/model/reasoning snapshot.
 * @param captain - the exact live captain agent (the calling agent).
 * @param team - the team record (read-only here).
 * @param member - the member draft whose `id` is filled on success.
 * @param stateDir - configured state directory (for the persona).
 * @param signal - caller cancellation, forwarded to the start.
 * @param roleContract - the team role's contract, folded into the persona when present.
 */
export async function spawnMember(
  ctx: Context,
  config: MemberRuntimeConfig,
  llmSelection: MemberLlmSelection,
  captain: Agent,
  team: TeamState,
  member: TeamMember,
  stateDir: string,
  signal: AbortSignal,
  roleContract?: RoleContract,
): Promise<void> {
  // Fail loud at the first use: provider registration is a sibling plugin's
  // effect and may settle after this plugin mounts. Capability checks here
  // mirror what startContinuable would reject, with an actionable error.
  const provider = ctx.subagents.getProvider(config.provider)
  if (provider === undefined) {
    throw new Error(
      `patent-teams: no subagent provider "${config.provider}" is registered (available: ${ctx.subagents.list().join(', ') || 'none'}) — `
      + 'check that the subagent provider row (e.g. subagent-spawn) is mounted in the composition',
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new Error(`patent-teams: provider "${config.provider}" does not support continuable members`)
  }
  if (!provider.capabilities.persona) {
    throw new Error(`patent-teams: provider "${config.provider}" cannot apply a member persona`)
  }
  if (!provider.capabilities.toolFilter) {
    throw new Error(`patent-teams: provider "${config.provider}" cannot restrict captain-only tools for members`)
  }
  const label = `${MEMBER_LABEL_PREFIX}${team.id}:${member.name}`
  // The route rides the creation request: the manager seeds it into the
  // child's durable descriptor, so fresh composition and cold resume both
  // restore provider/model without a per-child setup hook.
  const start = await ctx.subagents.startContinuable({
    provider: config.provider,
    label,
    request: {
      prompt: [{ type: 'text', text: memberWelcome(team) }],
      parent: captain,
      persona: memberPersona(team, member, stateDir, roleContract),
      toolFilter: { deny: [...MEMBER_DENIED_TOOLS] },
      agentOptions: {
        provider: llmSelection.provider,
        model: llmSelection.model,
      },
      ...config.maxDepth !== undefined ? { maxDepth: config.maxDepth } : {},
    },
    signal,
  })
  member.id = start.childId
}

/**
 * Deliver one message to a member as its next FIFO turn. Best effort: a
 * failure (member gone or not continuable) is logged and reported as `false`
 * so the caller can decide (mailbox delivery still happened).
 *
 * Any team sender can route through this helper: the captain is the direct
 * parent of every member, and the caller passes the captain's live Agent
 * (its own when the captain calls, the registry-resolved one when a member
 * sends) — mirroring the Claude Code mailbox model where the writer writes
 * the target's inbox and the target picks it up on its own.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's direct parent).
 * @param childId - the member's durable child session id.
 * @param text - the message content.
 * @param signal - caller cancellation, forwarded to the delivery.
 * @returns whether the member inbox accepted the message.
 */
export async function deliverToMember(
  ctx: Context,
  captain: Agent,
  childId: string,
  text: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await ctx.subagents.sendMessage(captain, brandedSessionId(childId), [{ type: 'text', text }], {
      signal,
    })
    return true
  } catch (error: unknown) {
    ctx.logger.warn(`patent-teams: send to member ${childId} failed: ${String(error)}`)
    return false
  }
}

/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export function interruptMember(ctx: Context, captain: Agent, childId: string): void {
  try {
    ctx.subagents.interrupt(brandedSessionId(childId), { kind: 'ancestor', agent: captain })
  } catch (error: unknown) {
    ctx.logger.warn(`patent-teams: interrupt of member ${childId} failed: ${String(error)}`)
  }
}

/** Resolve one live parent's workspace-scoped retirement index. */
async function retiredForParent(ctx: Context, parentId: SessionId, stateDir: string): Promise<Set<string>> {
  const parent = ctx.get('agents')?.get(parentId)
  return parent === undefined
    ? new Set()
    : readRetiredMemberIds(join(parent.session.header.cwd ?? process.cwd(), stateDir))
}

/**
 * Install the missing per-child retirement boundary above Harness rc.6.
 *
 * Upstream `interrupt()` deliberately preserves continuable sessions and the
 * upstream seam exposes no targeted forget/retire method. The durable
 * PatentTeams index therefore guards all three public continuation boundaries:
 * retired rows disappear from `list_agents` (children and descendants), and a
 * direct `sendMessage()` is rejected before it can cold-resume the member. Exact
 * ids keep unrelated subagents untouched; transcripts remain in persistence
 * for archived-team review.
 * @param ctx - registrant context carrying the subagent registry.
 * @param stateDir - configured state directory, where retired ids persist.
 */
export function installRetiredMemberGuard(ctx: Context, stateDir: string): void {
  const runtime = ctx.subagents
  ctx.effect(() => {
    // The saved originals are restored on dispose; the .call receivers are explicit.
    // oxlint-disable-next-line typescript/unbound-method
    const listChildren = runtime.listChildren
    // oxlint-disable-next-line typescript/unbound-method
    const listDescendants = runtime.listDescendants
    // oxlint-disable-next-line typescript/unbound-method
    const sendMessage = runtime.sendMessage

    const guardedChildren: typeof runtime.listChildren = async (parentId, signal) => {
      const [entries, retired] = await Promise.all([
        listChildren.call(runtime, parentId, signal),
        retiredForParent(ctx, parentId, stateDir),
      ])
      return entries.filter(entry => !retired.has(entry.id))
    }
    const guardedDescendants: typeof runtime.listDescendants = async (rootId, signal) => {
      const [entries, retired] = await Promise.all([
        listDescendants.call(runtime, rootId, signal),
        retiredForParent(ctx, rootId, stateDir),
      ])
      return entries.filter(entry => !retired.has(entry.id))
    }
    const guardedSend: typeof runtime.sendMessage = async (sender, targetId, content, options) => {
      const retired = await readRetiredMemberIds(join(sender.session.header.cwd ?? process.cwd(), stateDir))
      if (retired.has(targetId)) {
        throw new SubagentError(
          `PatentTeams member "${targetId}" was retired and cannot be resumed`,
          'NOT_RESUMABLE',
        )
      }
      return sendMessage.call(runtime, sender, targetId, content, options)
    }

    runtime.listChildren = guardedChildren
    runtime.listDescendants = guardedDescendants
    runtime.sendMessage = guardedSend
    return () => {
      if (runtime.listChildren === guardedChildren) runtime.listChildren = listChildren
      if (runtime.listDescendants === guardedDescendants) runtime.listDescendants = listDescendants
      if (runtime.sendMessage === guardedSend) runtime.sendMessage = sendMessage
    }
  }, 'patent-teams: retired member guard')
}

/**
 * Snapshot each direct continuable child's real driver activity under the
 * captain's session. `listChildren().activity` is only session residency, so
 * live children are refined through the Agent registry exactly like Harness's
 * shipped `list_agents` tool.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captainSessionId - the captain's session id.
 * @returns child id → activity, missing entries are unknown children.
 */
export async function memberActivity(
  ctx: Context,
  captainSessionId: string,
): Promise<Map<string, 'running' | 'idle' | 'ready'>> {
  const entries = await ctx.subagents.listChildren(brandedSessionId(captainSessionId))
  const activity = new Map<string, 'running' | 'idle' | 'ready'>()
  for (const entry of entries) {
    if (entry.kind !== 'child') continue
    const live = ctx.get('agents')?.get(entry.id)
    activity.set(entry.id, live === undefined ? 'ready' : live.status)
  }
  return activity
}
