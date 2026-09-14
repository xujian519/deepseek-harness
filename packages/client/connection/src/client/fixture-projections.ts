// The fixture's mirrors of the host projection units. Each fold reads the whole
// session log and returns one unit's current value; `projectionFramesOf` says
// which units an appended event advances. Nothing here reads world state.

import type { ContentBlock, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'
import { deriveEventMessage, foldSurface } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'

/** One `model/selection` whole value, as the model bar writes and reads it. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One projection control frame: the key, its whole value, and the advancing seq. */
export interface FixtureProjectionFrame {
  readonly type: 'projection'
  readonly sessionId: SessionId
  readonly key: string
  readonly value: unknown
  readonly seq: number
}

/* jscpd:ignore-start -- The standalone fixture mirrors host timing without importing a target implementation. */
function isFixtureTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}
/* jscpd:ignore-end */

/**
 * Fixture parallel of the plan unit's lifecycle fold. The paired
 * `command/done` retains successful plan selections and drops failures;
 * `plan/mode` commits one. `wanted` is exposed for the prompt boundary (the
 * fixture's step/start parallel).
 * @param log - the session's full event log.
 * @returns the committed plan mode and any selection the log still leaves pending.
 */
export function foldPlan(log: readonly SessionEvent[]): { active: boolean; pending: boolean; wanted: boolean | null } {
  let active = false
  let wanted: boolean | null = null
  let running: { commandId: unknown; wanted: boolean } | null = null
  for (const event of log) {
    const item = event as unknown as { type: string; data?: Record<string, unknown> }
    if (item.type === 'command/run' && item.data?.['name'] === 'plan') {
      const args = item.data['args']
      if (typeof args !== 'string') continue
      running = { commandId: item.data['commandId'], wanted: args.trim() !== 'off' }
    } else if (item.type === 'command/done'
      && item.data !== undefined
      && running !== null
      && item.data['commandId'] === running.commandId) {
      wanted = item.data['kind'] === 'success' && running.wanted !== active ? running.wanted : null
      running = null
    } else if (item.type === 'plan/mode') {
      active = item.data?.['active'] === true
      wanted = null
    }
  }
  const selected = running?.wanted ?? wanted
  return { active, pending: selected !== null && selected !== active, wanted: selected }
}

/** The plan projection's wire view over the full log. */
function planViewOf(log: readonly SessionEvent[]): { active: boolean; pending: boolean } {
  const plan = foldPlan(log)
  return { active: plan.active, pending: plan.pending }
}

/** Fixture preset table (the host PermissionPresetService defaults). */
export const PERMISSION_PRESETS: Record<string, { sandbox: string; approval: string; description: string }> = {
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', description: 'Full file access without approval prompts.' },
}

/**
 * Host permissions-unit parallel: fold the three knob events, derive the select
 * over the fixture defaults.
 * @param log - the session's full event log.
 * @returns the preset options and the value they currently select.
 */
export function permissionSelectOf(
  log: readonly SessionEvent[],
): { options: { value: string; name: string; description?: string }[]; currentValue: string } {
  let preset: string | null = null
  let sandbox = 'workspace-write'
  let approval = 'ask'
  for (const event of log) {
    const item = event as { type: string; data: Record<string, unknown> }
    if (item.type === 'permission/preset') preset = item.data['preset'] as string
    else if (item.type === 'sandbox/mode') sandbox = item.data['mode'] as string
    else if (item.type === 'approval/policy') approval = item.data['policy'] as string
  }
  const matches = (spec: { sandbox: string; approval: string }): boolean => spec.sandbox === sandbox && spec.approval === approval
  let currentValue = 'custom'
  const folded = preset === null ? undefined : PERMISSION_PRESETS[preset]
  if (preset !== null && folded !== undefined && matches(folded)) {
    currentValue = preset
  } else {
    for (const [name, spec] of Object.entries(PERMISSION_PRESETS)) {
      if (matches(spec)) { currentValue = name; break }
    }
  }
  return {
    options: [
      ...Object.entries(PERMISSION_PRESETS).map(([value, spec]) => ({ value, name: value, description: spec.description })),
      ...currentValue === 'custom' ? [{ value: 'custom', name: 'Custom', description: 'Current sandbox and approval settings do not match a preset.' }] : [],
    ],
    currentValue,
  }
}

interface FixtureTokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface FixtureUsageSample {
  turn: number
  step: number
  usage: TokenUsage
}

/** Read one provider usage sample from either durable carrier. */
function usageSampleOf(event: SessionEvent): FixtureUsageSample | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  let usage = event.type === 'assistant/message' ? event.data.usage : undefined
  for (const member of expandAssistantStream(event.data.stream)) {
    if (member.chunk.type === 'usage') usage = member.chunk.usage
  }
  return usage === undefined
    ? undefined
    : { turn: event.data.turn, step: event.data.step, usage }
}

/** Fixture parallel of token-meter's last-sample-replacing usage projection. */
function tokenUsageOf(log: readonly SessionEvent[]): FixtureTokenUsageProjection {
  const totals: FixtureTokenUsageProjection = {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  let last: {
    turn: number
    step: number
    buckets: FixtureTokenUsageProjection
  } | null = null
  for (const event of log) {
    const sample = usageSampleOf(event)
    if (sample === undefined) continue
    const buckets: FixtureTokenUsageProjection = {
      uncachedInputTokens: sample.usage.inputTokens,
      outputTokens: sample.usage.outputTokens,
      cacheReadTokens: sample.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: sample.usage.cacheWriteTokens ?? 0,
    }
    const previous = last?.turn === sample.turn && last.step === sample.step
      ? last.buckets
      : undefined
    totals.uncachedInputTokens += buckets.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0)
    totals.outputTokens += buckets.outputTokens - (previous?.outputTokens ?? 0)
    totals.cacheReadTokens += buckets.cacheReadTokens - (previous?.cacheReadTokens ?? 0)
    totals.cacheWriteTokens += buckets.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0)
    last = { turn: sample.turn, step: sample.step, buckets }
  }
  return totals
}

/** Fixture parallel of session-stats' whole-log counting and wall-time fold. */
function sessionStatsOf(log: readonly SessionEvent[]): {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
} {
  const value = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
  let lastTurn: number | null = null
  let openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null = null
  const pendingCalls = new Map<string, number>()
  for (const event of log) {
    switch (event.type) {
      case 'step/start':
        openStep = { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null }
        break
      case 'assistant/attempt': {
        if (openStep === null || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        const first = expandAssistantStream(event.data.stream)
          .find(member => isFixtureTokenDelta(member.chunk))?.time
        if (openStep.firstTokenTime === null && first !== undefined) openStep.firstTokenTime = first
        break
      }
      case 'assistant/message': {
        if (openStep === null || openStep.turn !== event.data.turn || openStep.step !== event.data.step) break
        const first = expandAssistantStream(event.data.stream)
          .find(member => isFixtureTokenDelta(member.chunk))?.time
        if (openStep.firstTokenTime === null && first !== undefined) openStep.firstTokenTime = first
        value.llmMs += Math.max(0, event.time - openStep.startTime)
        if (openStep.firstTokenTime !== null) {
          value.ttftMs += Math.max(0, openStep.firstTokenTime - openStep.startTime)
          value.ttftSteps += 1
          const outputTokens = event.data.usage?.outputTokens
          if (typeof outputTokens === 'number' && Number.isFinite(outputTokens) && outputTokens >= 0) {
            value.decodeMs += Math.max(0, event.time - openStep.firstTokenTime)
            value.decodeTokens += outputTokens
          }
        }
        openStep = null
        break
      }
      case 'tool/call':
        pendingCalls.set(event.data.callId, event.time)
        break
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const dispatched = pendingCalls.get(callId)
        if (dispatched === undefined) break
        pendingCalls.delete(callId)
        value.toolMs += Math.max(0, event.time - dispatched)
        break
      }
      case 'step/end':
        if (event.data.turn !== lastTurn) {
          value.turns += 1
          lastTurn = event.data.turn
        }
        value.steps += 1
        openStep = null
        break
      case 'turn/end':
        pendingCalls.clear()
        break
      default:
        break
    }
  }
  return value
}

interface FixtureRequestContext {
  provider: string
  model: string
  contextWindow?: number
}

interface FixtureContextBreakdownProjection {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** Fixed token-meter heuristic constants mirrored by this client-only fixture. */
const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

/** Price fixture content with token-meter's fixed-density heuristic. */
function estimateFixtureContent(blocks: readonly ContentBlock[]): number {
  const densityPrice = (value: string): number => Math.ceil(value.length / CHARS_PER_TOKEN)
  return blocks.reduce((tokens, block) => {
    if (block.type === 'text' || block.type === 'reasoning') {
      return tokens + densityPrice(block.text) + BLOCK_OVERHEAD
    }
    if (block.type === 'tool-call') {
      return tokens + densityPrice(block.name) + densityPrice(block.arguments) + BLOCK_OVERHEAD
    }
    // ContentBlockMap is merge-extensible: this client graph sees only the
    // base four members, but fixture turns do carry extended blocks at
    // runtime, so the structural JSON fallback below is live code.
    if (block.type === 'tool-result') {
      return tokens + estimateFixtureContent(block.content) + BLOCK_OVERHEAD
    }
    return tokens + densityPrice(JSON.stringify(block)) + BLOCK_OVERHEAD
  }, 0)
}

/**
 * Fixture parallel of token-meter's heuristic context-composition projection.
 * The system prompt is the system-role surface node; it prices as text plus
 * role framing with no block overhead and stays out of the message figure.
 */
function contextBreakdownOf(log: readonly SessionEvent[]): FixtureContextBreakdownProjection {
  const headerEvent = log.findLast(event => event.type === 'request/header')
  const header = headerEvent === undefined
    ? undefined
    : headerEvent.data.header
  let systemTokens = 0
  let messageTokens = 0
  for (const seq of foldSurface(log).nodes) {
    const event = log[seq]
    if (event === undefined) continue
    const message = deriveEventMessage(event)
    if (message === null) continue
    if (message.role === 'system') {
      const characters = message.content.reduce(
        (total, block) => total + (block.type === 'text' ? block.text.length : JSON.stringify(block).length),
        0,
      )
      systemTokens = Math.ceil(characters / CHARS_PER_TOKEN) + ROLE_OVERHEAD
      continue
    }
    messageTokens += estimateFixtureContent(message.content) + ROLE_OVERHEAD
  }
  return {
    systemTokens,
    toolsTokens: header?.tools === undefined || header.tools.length === 0
      ? 0
      : Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD,
    messageTokens,
  }
}

/**
 * Latest log-only route context, or undefined before any request ran.
 * @param log - the session's full event log.
 * @returns the last `request/context` payload, or undefined when none ran.
 */
export function lastRequestContext(
  log: readonly SessionEvent[],
): FixtureRequestContext | undefined {
  const event = log.findLast(item => (item as { type: string }).type === 'request/context')
  return event === undefined
    ? undefined
    : (event as unknown as { data: FixtureRequestContext }).data
}

/**
 * Fixture parallel of token-meter's request-pressure projection: the last
 * provider-reported prompt size paired with the last recorded capacity. The
 * two need not come from one request — see the token-meter README. The host's
 * `projectedTokens` is deliberately absent: reproducing it would mean
 * reimplementing the estimator client-side, and every consumer falls back to
 * the bare sample, so a fixture-driven view simply lags a compaction the way
 * the projection did before that field existed.
 */
function contextPressureOf(
  log: readonly SessionEvent[],
): { pressureTokens?: number; contextWindow?: number } {
  let pressureTokens: number | undefined
  for (const event of log) {
    const sample = usageSampleOf(event)
    if (sample === undefined) continue
    pressureTokens = sample.usage.inputTokens
      + (sample.usage.cacheReadTokens ?? 0)
      + (sample.usage.cacheWriteTokens ?? 0)
  }
  const contextWindow = lastRequestContext(log)?.contextWindow
  return {
    ...pressureTokens === undefined ? {} : { pressureTokens },
    ...contextWindow === undefined ? {} : { contextWindow },
  }
}

/**
 * Fixture parallel of the host's projection units: whole current values per key
 * over the full log.
 * @param log - the session's full event log.
 * @returns one current value per projection key the composed units carry.
 */
export function projectionValuesOf(log: readonly SessionEvent[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  values['modelSelection'] = modelSelectionProjectionOf(log)
  const titleEvent = log.findLast(item => (item as { type: string }).type === 'session/title')
  if (titleEvent !== undefined) {
    values['title'] = (titleEvent as unknown as { data: { title: string } }).data.title
  }
  // Always present (tool-todo unit composed): null when no plan stands.
  values['todos'] = backscanTodos(log) ?? null
  // Always present (tool-todo board unit composed): whole-log last-wins, never cleared.
  values['todosLatest'] = backscanTodos(log) ?? null
  // Always present (permission service composed): the whole select.
  values['permissions'] = permissionSelectOf(log)
  // Always present (plan-mode unit composed): the {active, pending} view.
  values['plan'] = planViewOf(log)
  // Always present (GoalService unit composed): null before create / after clear.
  values['goal'] = backscanGoal(log)
  // Always present (token-meter composed): full-log provider billing.
  values['tokenUsage'] = tokenUsageOf(log)
  // Always present (token-meter composed): last request pressure and capacity.
  values['contextPressure'] = contextPressureOf(log)
  // Always present (token-meter composed): heuristic request composition.
  values['contextBreakdown'] = contextBreakdownOf(log)
  // Always present (session-stats unit composed): whole-log turn/step counts.
  values['sessionStats'] = sessionStatsOf(log)
  // Always present (attachment service composed): the deployment image
  // limits, constant per boot (mirrors the attachment-local defaults).
  // Deliberate host divergence: the real gateway never pushes an imageLimits
  // change frame (constant unit), but the fixture's uniform baseline replay
  // frames every key here, incidentally exercising higher-seq-wins.
  values['imageLimits'] = {
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 20,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 2000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }
  return values
}

function modelSelectionProjectionOf(log: readonly SessionEvent[]): {
  lastUsed: ModelSelection | null
  next: ModelSelection | null
} {
  let lastUsed: ModelSelection | null = null
  let pending: ModelSelection | null = null
  for (const event of log) {
    if ((event as { type: string }).type === 'model/selection') {
      pending = (event as unknown as { data: ModelSelection }).data
      continue
    }
    if (event.type !== 'request/header') continue
    lastUsed = {
      provider: event.data.header.config.provider,
      model: event.data.header.config.model,
      ...(event.data.header.config.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: event.data.header.config.reasoningEffort }),
    }
    if (sameModelSelection(pending, lastUsed)) pending = null
  }
  return { lastUsed, next: pending ?? lastUsed }
}

/**
 * Whether two selections name the same route, treating two nulls as equal.
 * @param left - one selection, or null.
 * @param right - the other selection, or null.
 * @returns true when both are null or all three route fields match.
 */
export function sameModelSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort)
}

/**
 * Host parallel: emit one Session control projection frame per key advanced by
 * the event.
 * @param id - the session whose projection advanced.
 * @param log - the session's full event log, including the appended event.
 * @param event - the event just appended.
 * @returns one frame per advanced key, in the order the units are composed.
 */
export function projectionFramesOf(
  id: SessionId,
  log: readonly SessionEvent[],
  event: SessionEvent,
): FixtureProjectionFrame[] {
  const type = (event as { type: string }).type
  const frames: FixtureProjectionFrame[] = []
  if (type === 'model/selection' || type === 'request/header') {
    frames.push({
      type: 'projection',
      sessionId: id,
      key: 'modelSelection',
      value: modelSelectionProjectionOf(log),
      seq: event.seq,
    })
  }
  // One usage sample advances both token-meter units.
  if (usageSampleOf(event) !== undefined) {
    frames.push(
      { type: 'projection', sessionId: id, key: 'tokenUsage', value: tokenUsageOf(log), seq: event.seq },
      { type: 'projection', sessionId: id, key: 'contextPressure', value: contextPressureOf(log), seq: event.seq },
    )
  }
  if (type === 'request/context') {
    frames.push({
      type: 'projection',
      sessionId: id,
      key: 'contextPressure',
      value: contextPressureOf(log),
      seq: event.seq,
    })
  }
  if (type === 'request/header'
    || type === 'system/message'
    || type === 'user/message'
    || type === 'assistant/message'
    || type === 'tool/result') {
    frames.push({
      type: 'projection',
      sessionId: id,
      key: 'contextBreakdown',
      value: contextBreakdownOf(log),
      seq: event.seq,
    })
  }
  // The stats fold's view advances on message assembly and tool settlement
  // (wall times) and on step close (counts).
  if (type === 'assistant/message' || type === 'tool/result' || type === 'step/end') {
    frames.push({
      type: 'projection',
      sessionId: id,
      key: 'sessionStats',
      value: sessionStatsOf(log),
      seq: event.seq,
    })
  }
  if (frames.length > 0) return frames
  if (type === 'session/title') {
    const values = projectionValuesOf(log)
    /* v8 ignore next -- the advancing title event is in the log, so the key is present. */
    if (!Object.hasOwn(values, 'title')) return []
    return [{ type: 'projection', sessionId: id, key: 'title', value: values['title'], seq: event.seq }]
  }
  // The goal domain's own durable change advances its projection.
  if (type === 'goal/change') {
    return [{ type: 'projection', sessionId: id, key: 'goal', value: backscanGoal(log), seq: event.seq }]
  }
  // Standing-plan fold: writes replace the list; turn/start clears it (null).
  // The board fold shares the write frame (both keys change on todo/write);
  // turn/start changes only the standing plan, so only that key re-fires.
  if (type === 'todo/write' || type === 'turn/start') {
    const latest = backscanTodos(log) ?? null
    const frames: { type: 'projection'; sessionId: SessionId; key: string; value: TodoItem[] | null; seq: number }[] = [{
      type: 'projection',
      sessionId: id,
      key: 'todos',
      value: type === 'todo/write' ? latest : null,
      seq: event.seq,
    }]
    if (type === 'todo/write') {
      frames.push({ type: 'projection', sessionId: id, key: 'todosLatest', value: latest, seq: event.seq })
    }
    return frames
  }
  // Knob fold: any of the three whole-value knob events advances the select.
  if (type === 'permission/preset' || type === 'sandbox/mode' || type === 'approval/policy') {
    return [{
      type: 'projection',
      sessionId: id,
      key: 'permissions',
      value: permissionSelectOf(log),
      seq: event.seq,
    }]
  }
  // The plan unit advances on its two folded event kinds when the command
  // lifecycle contains the input that represents a plan selection.
  const commandData = event as unknown as { data: { name?: string; args?: unknown } }
  if (type === 'plan/mode' || (type === 'command/run'
    && commandData.data.name === 'plan' && typeof commandData.data.args === 'string')) {
    return [{
      type: 'projection',
      sessionId: id,
      key: 'plan',
      value: planViewOf(log),
      seq: event.seq,
    }]
  }
  return []
}

/**
 * Current plan projection over the full log (host parallel: latest todo/write
 * with no later turn/start; a new turn retires the previous plan).
 */
function backscanTodos(log: readonly SessionEvent[]): TodoItem[] | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i]
    if (event === undefined) continue
    if (event.type === 'turn/start') return undefined
    if (event.type === 'todo/write') return event.data.todos
  }
  return undefined
}

/** Fixture-local mirror of the goal projection value (dsh-goal's GoalProjection shape). */
export interface FxGoalProjection {
  goal: {
    id: string
    revision: number
    objective: string
    phase: 'active' | 'paused' | 'blocked' | 'complete'
    maxGoalRounds: number
  }
  roundsStarted: number
  createdAt: number
  updatedAt: number
}

/** One durable goal change. */
export type FxGoalChange =
  | { kind: 'goal/change'; version: 1; operation: 'clear'; cleared: { id: string; revision: number }; clearedAt: number }
  | {
    kind: 'goal/change'
    version: 1
    operation: 'create' | 'edit' | 'pause' | 'resume' | 'complete'
    goal: FxGoalProjection['goal']
    roundsStarted: number
    createdAt: number
    updatedAt: number
  }

/**
 * Current goal projection over the full log (host parallel: the GoalService
 * unit's last-wins fold of goal/change whole values; clear returns null).
 * @param log - the session's full event log.
 * @returns the current goal projection, or null before create and after clear.
 */
export function backscanGoal(log: readonly SessionEvent[]): FxGoalProjection | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i] as unknown as {
      type: string
      data?: FxGoalChange
    } | undefined
    if (event === undefined || event.type !== 'goal/change' || event.data === undefined) continue
    const change = event.data
    if (change.operation === 'clear') return null
    return { goal: change.goal, roundsStarted: change.roundsStarted, createdAt: change.createdAt, updatedAt: change.updatedAt }
  }
  return null
}
