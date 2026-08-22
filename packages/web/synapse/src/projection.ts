/**
 * Pure projection helpers for the Synapse session map: turning one committed
 * DSH session event into a canvas message card, plus the title/cwd heuristics
 * the store layers on top. No persistence and no plugin context here.
 * @module @deepseek-ai/dsh-host-synapse
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ProjectedMessage, ToolProcessEntry } from './types.ts'

/** Projected message text cap: longer replies truncate with a marker pointing
 * at the detail view instead of silently cutting mid-sentence. */
export const MAX_PROJECTION_LENGTH = 8_000
/** Marker appended to a truncated projection, pointing at the detail view. */
export const PROJECTION_TRUNCATED_SUFFIX = '\n——…（详情查看全文）'
/** Topic palette cycling per thread, mirroring the canvas card colors. */
export const TOPIC_COLORS = ['#0f766e', '#2563eb', '#be123c', '#7c3aed', '#b45309'] as const

/** The runtime-context snapshot DSH injects as a user message is internal
 * agent state, never a human question; excluding it keeps one card per turn. */
export const RUNTIME_CONTEXT_PREFIX = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'

/** Whether a text starts with DSH's pinned runtime-context snapshot.
 * @param text The candidate text.
 * @returns True when it is the runtime-context snapshot. */
export function isRuntimeContextText(text: unknown): boolean {
  return typeof text === 'string' && text.trimStart().startsWith(RUNTIME_CONTEXT_PREFIX)
}

/** Whether a stored canvas message is the runtime-context snapshot.
 * @param message The projected message, if present.
 * @returns True when it is a user message carrying the runtime-context snapshot. */
export function isRuntimeContextMessage(message: { kind?: string; text?: unknown } | undefined): boolean {
  return message?.kind === 'user' && isRuntimeContextText(message.text)
}

/** Flatten ordered content blocks into one display string. Tool-call blocks
 * carry their call name and raw arguments, so an unfolded card shows what ran
 * without reading the session log.
 * @param content The event content blocks, if present.
 * @returns The flattened display string. */
export function contentText(content: readonly ContentBlock[] | undefined): string {
  if (content === undefined) return ''
  return content.flatMap((block) => {
    if (block.type === 'text') return [block.text]
    if (block.type === 'tool-call') return [block.name, block.arguments]
    if (block.type === 'tool-result') return [contentText(block.content)]
    return []
  }).filter(value => value.trim() !== '').join('\n')
}

function noteProjection(kind: ProjectedMessage['kind'], text: string): { kind: ProjectedMessage['kind']; text: string } | null {
  const normalized = text.trim()
  if (normalized === '') return null
  if (normalized.length <= MAX_PROJECTION_LENGTH) return { kind, text: normalized }
  return { kind, text: `${normalized.slice(0, MAX_PROJECTION_LENGTH)}${PROJECTION_TRUNCATED_SUFFIX}` }
}

/** Project one event to a card payload, or null when the event is not
 * card-shaped (turn boundaries, chunks, tool process, …).
 * @param event The committed session event.
 * @returns The card-shaped { kind, text }, or null to skip it. */
export function projectableEvent(event: SessionEvent): { kind: ProjectedMessage['kind']; text: string } | null {
  switch (event.type) {
    case 'user/message': {
      // Only human prompts become question cards. DSH injects workspace
      // instructions, skill catalogs, and the runtime-context snapshot as
      // user-role messages with explicit non-human source kinds; a canvas
      // card per injection would bury the actual conversation. The persisted
      // log is a durable boundary: older logs may predate the source field,
      // so it stays optional here.
      const source = (event.data as unknown as { source?: { kind?: string } | null }).source
      if (source !== undefined && source !== null && source.kind !== 'user') return null
      const text = contentText(event.data.content)
      return isRuntimeContextText(text) ? null : noteProjection('user', text)
    }
    case 'assistant/message':
      return noteProjection('assistant', contentText(event.data.message.content))
    case 'todo/write':
      return noteProjection('todo', event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n'))
    case 'turn/end':
      return event.data.reason.kind === 'error' ? noteProjection('error', event.data.reason.error.message) : null
    default:
      return null
  }
}


/** One full-fidelity detail-view message: the whole text, folded tool
 * process, and injected context preserved with its own kind. */
export interface DetailMessage {
  id: string
  kind: 'user' | 'assistant' | 'todo' | 'error' | 'context'
  text: string
  at: string
  sourceSeq?: number
  turn?: number
  step?: number
  process?: ToolProcessEntry[]
}

/** Fold one tool event into the closest assistant message of its turn/step. */
function foldProcessInto(messages: DetailMessage[], event: SessionEvent): void {
  if (event.type !== 'tool/call' && event.type !== 'tool/result') return
  const target = [...messages].reverse().find(message =>
    message.kind === 'assistant'
    && (message.turn === event.data.turn && message.step === event.data.step
      || message.turn === undefined && message.step === undefined))
  if (target === undefined) return
  const process = target.process ??= []
  const callId = String(event.type === 'tool/call' ? event.data.callId : event.data.message.source.callId)
  const entry = process.find(item => item.callId === callId)
  if (event.type === 'tool/call') {
    if (entry === undefined) process.push({ callId, name: event.data.name, arguments: event.data.arguments, result: null, error: null })
    else {
      entry.name = event.data.name
      entry.arguments = event.data.arguments
    }
    return
  }
  const outcome = contentText(event.data.message.content)
  const error = event.data.error === undefined ? null : `${event.data.error.name}: ${event.data.error.code}`
  if (entry === undefined) process.push({ callId, name: '工具调用', arguments: null, result: outcome, error })
  else {
    entry.result = outcome
    entry.error = error
  }
}

/** Options for paging the detail-view history. */
export interface ProjectHistoryOptions {
  /** Keep only messages whose sourceSeq is strictly below this (exclusive). */
  beforeSeq?: number
  /** Return the most recent `limit` messages after filtering. */
  limit?: number
}

/** Project one committed log into the full detail-view message list.
 * Unlike the canvas projection, injected context stays visible (kind
 * 'context') and texts are never truncated. Paging happens after the full
 * projection so tool folding completes around the boundary; a page can never
 * orphan a tool process onto a missing turn.
 * @param events The committed session events.
 * @param options Paging: `beforeSeq` keeps only messages with `sourceSeq < it`
 * (exclusive), `limit` returns the most recent messages after filtering.
 * @returns The detail-view message list, optionally paged. */
export function projectHistory(events: readonly SessionEvent[], options: ProjectHistoryOptions = {}): DetailMessage[] {
  const messages = projectDetail(events)
  const { limit, beforeSeq } = options
  let filtered = messages
  if (beforeSeq !== undefined) filtered = filtered.filter(message => message.sourceSeq === undefined || message.sourceSeq < beforeSeq)
  return limit === undefined ? filtered : filtered.slice(-limit)
}

function projectDetail(events: readonly SessionEvent[]): DetailMessage[] {
  const messages: DetailMessage[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const text = contentText(event.data.content)
      if (text.trim() === '') continue
      const source = (event.data as unknown as { source?: { kind?: string } | null }).source
      const human = source === undefined || source === null || source.kind === 'user'
      messages.push({
        id: `history-${event.seq}`,
        kind: human ? 'user' : 'context',
        text,
        at: new Date(event.time).toISOString(),
        sourceSeq: event.seq,
      })
      continue
    }
    if (event.type === 'assistant/message') {
      const text = contentText(event.data.message.content)
      if (text.trim() === '') continue
      messages.push({
        id: `history-${event.seq}`,
        kind: 'assistant',
        text,
        at: new Date(event.time).toISOString(),
        sourceSeq: event.seq,
        turn: event.data.turn,
        step: event.data.step,
        process: [],
      })
      continue
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      foldProcessInto(messages, event)
      continue
    }
    if (event.type === 'todo/write') {
      messages.push({
        id: `history-${event.seq}`,
        kind: 'todo',
        text: event.data.todos.map(todo => `[${todo.status}] ${todo.content}`).join('\n'),
        at: new Date(event.time).toISOString(),
        sourceSeq: event.seq,
      })
      continue
    }
    if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
      messages.push({
        id: `history-${event.seq}`,
        kind: 'error',
        text: event.data.reason.error.message,
        at: new Date(event.time).toISOString(),
        sourceSeq: event.seq,
      })
    }
  }
  return messages
}

/** First-line title from a user question, matching the canvas card head.
 * @param text The question text.
 * @returns A single-line title truncated to the card head width. */
export function titleFromText(text: string): string {
  const line = text.replaceAll(/\s+/g, ' ').trim()
  return (line.length > 42 ? `${line.slice(0, 42)}...` : line) || 'DSH 会话'
}

/** Read the title payload off one event when it is a session/title record.
 * @param event The session event.
 * @returns The title string, or null when the event carries none. */
export function sessionTitleOf(event: SessionEvent): string | null {
  // session/title is declared by the session-title package through declaration
  // merging; the core SessionEventMap does not know the type, so read the
  // loosely typed slot here and validate the payload at this boundary.
  if ((event.type as string) !== 'session/title') return null
  const title = (event.data as unknown as { title?: unknown }).title
  return typeof title === 'string' ? title : null
}

/** The session's current durable title: the last session/title event, or null.
 * @param events The session events.
 * @returns The most recent title, or null when none was recorded. */
export function sessionTitle(events: readonly SessionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event !== undefined && sessionTitleOf(event) !== null) return sessionTitleOf(event)
  }
  return null
}

/** A session is blank when no human question ever landed in its log.
 * @param events The session events.
 * @returns True when no user question was recorded. */
export function sessionIsBlank(events: readonly SessionEvent[]): boolean {
  return !events.some(event => event.type === 'user/message')
}

/** The first live seq of a persisted log: after the last seed-boundary marker.
 * @param events The session events.
 * @returns The seq one past the last `session/end-seed`, or 0 when none. */
export function sessionLiveStart(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'session/end-seed') return event.seq + 1
  }
  return 0
}

/** Canvas fallback label when the session carries no cwd. */
export const UNSPECIFIED_CWD = '未指定工作目录'

/** The projection workspace's cwd key: the session cwd, or a neutral sentinel.
 * @param session The session carrying a header cwd.
 * @returns The cwd string, or the unspecified-cwd sentinel when blank. */
export function sessionCwd(session: Pick<Session, 'header'>): string {
  const cwd = session.header.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : UNSPECIFIED_CWD
}

/** Workspace title from its cwd: the last path segment, or the fallback.
 * @param cwd The workspace cwd.
 * @param fallbackTitle The title when the cwd is the unspecified sentinel.
 * @returns The last path segment, or the fallback title. */
export function workspaceTitle(cwd: string, fallbackTitle: string): string {
  if (cwd === UNSPECIFIED_CWD) return fallbackTitle
  const segment = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
  return segment && segment.trim() !== '' ? segment : fallbackTitle
}
