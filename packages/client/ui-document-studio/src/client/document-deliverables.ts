/**
 * Document-studio produced-file definition and view target. The vocabulary is
 * the mutation tools' own follow-along `locations` (the same derivation
 * `ui-deliverables` publishes per turn): a diff card, or a generic card whose
 * `kind` is `edit`, contributes its `locations` paths. The studio also folds
 * the `document_deliver` registration tool: its call arguments (logged with
 * the tool/call event) carry the delivered files, formats, gate state, and
 * brief reference, so a registered entry augments the mutation-derived entry
 * with that metadata. This package owns its own turn-scoped key so the studio
 * works whether or not `ui-deliverables` is composed in; the view target
 * folds every turn in the window into one first-seen ordered list.
 */
import type {
  ConversationNodeDefinition, ConversationTimelineSnapshot, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'

/** The `document_deliver` registration tool's name, as logged in tool/call. */
export const DOCUMENT_DELIVER_TOOL = 'document_deliver'

/** One produced file with its first-producing turn event seq and optional registration metadata. */
export interface DocumentDeliverable {
  readonly seq: number
  readonly path: string
  /** Export format announced by a `document_deliver` registration. */
  readonly format?: string
  /** Quality-gate state announced by a `document_deliver` registration. */
  readonly gate?: { readonly p0: readonly string[]; readonly p1: readonly string[] }
  /** Brief reference path announced by a `document_deliver` registration. */
  readonly briefRef?: string
}

/** Turn-scoped produced-file facts published under `documentDeliverables`. */
export interface DocumentTurnDeliverables {
  readonly produced: readonly DocumentDeliverable[]
}

/** Studio snapshot: session-wide produced files in first-seen order. */
export interface DocumentDeliverablesSnapshot {
  readonly produced: readonly DocumentDeliverable[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutations and deliverable registrations accumulated in one Turn. */
    documentDeliverables: DocumentTurnDeliverables
  }

  interface ConversationViewSnapshotMap {
    /** Session-wide produced files folded from every Turn. */
    documentDeliverables: DocumentDeliverablesSnapshot
  }
}

/** Stable target key the studio view reads from the session snapshot. */
export const DOCUMENT_DELIVERABLES_TARGET = 'documentDeliverables'

/** The registration metadata a `document_deliver` call declares. */
interface DeliverRegistration {
  readonly files: ReadonlyArray<{ readonly path: string; readonly format: string }>
  readonly gate: { readonly p0: readonly string[]; readonly p1: readonly string[] }
  readonly briefRef?: string
}

/** One tool call's stored facts: its presentation view and parsed registration, when it is one. */
interface CallViewEntry {
  readonly view: ToolResultNode['callView']
  readonly registration?: DeliverRegistration
}

interface DocumentDeliverablesState extends DocumentTurnDeliverables {
  readonly turn: number
  readonly calls: ReadonlyMap<string, CallViewEntry>
}

/**
 * Parse a `document_deliver` call's logged arguments. Invalid or
 * non-matching payloads degrade to undefined: the studio then falls back to
 * the mutation-derived list (the visible degrade path, never a crash).
 * @param callName - the logged tool name.
 * @param argumentsJson - the logged lossless-JSON arguments string.
 * @returns the declared registration, or undefined when not a deliverable registration.
 */
export function parseDeliverRegistration(
  callName: string, argumentsJson: string,
): DeliverRegistration | undefined {
  if (callName !== DOCUMENT_DELIVER_TOOL) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  return normalizeDeliverRegistration(parsed)
}

/** Narrow an unknown payload to a registration, or undefined when any part is malformed. */
function normalizeDeliverRegistration(value: unknown): DeliverRegistration | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.files)) return undefined
  const files: Array<{ path: string; format: string }> = []
  for (const entry of record.files) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const file = entry as Record<string, unknown>
    if (typeof file.path !== 'string' || typeof file.format !== 'string') return undefined
    files.push({ path: file.path, format: file.format })
  }
  const gate = record.gate
  if (typeof gate !== 'object' || gate === null) return undefined
  const gateRecord = gate as Record<string, unknown>
  if (!Array.isArray(gateRecord.p0) || !gateRecord.p0.every(item => typeof item === 'string')) return undefined
  if (gateRecord.p1 !== undefined && (!Array.isArray(gateRecord.p1) || !gateRecord.p1.every(item => typeof item === 'string'))) {
    return undefined
  }
  const p1 = Array.isArray(gateRecord.p1) ? gateRecord.p1 : []
  const briefRef = record.brief_ref !== undefined && typeof record.brief_ref === 'string'
    ? record.brief_ref
    : undefined
  return {
    files,
    gate: { p0: gateRecord.p0, p1 },
    ...briefRef !== undefined ? { briefRef } : {},
  }
}

/**
 * Paths a call view reports having created or changed, by render intent
 * rather than tool name — the same vocabulary the produced-files row uses.
 */
// Intentional duplicate of ui-deliverables' producedPaths: the two packages
// own separate turn keys and must compose independently
// (packages/client/AGENTS.md forbids cross-package value imports).
/* jscpd:ignore-start */
function producedPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? []).map(location => location.path)
  }
  return []
}
/* jscpd:ignore-end */

function registeredEntries(seq: number, registration: DeliverRegistration): DocumentDeliverable[] {
  return registration.files.map(file => ({
    seq,
    path: file.path,
    format: file.format,
    gate: registration.gate,
    ...registration.briefRef !== undefined ? { briefRef: registration.briefRef } : {},
  }))
}

/** Turn-local successful mutation + registration accumulator; it publishes no view Node. */
// Intentional duplicate of ui-deliverables' deliverablesDefinition (same
// accumulator skeleton, own turn key) — keep the two packages in sync.
/* jscpd:ignore-start */
export const documentDeliverablesDefinition: ConversationNodeDefinition<DocumentDeliverablesState> = {
  kind: 'documentDeliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('documentDeliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      const registration = parseDeliverRegistration(match.event.data.name, match.event.data.arguments)
      calls.set(
        String(match.event.data.callId),
        registration === undefined
          ? { view: match.view?.for === 'call' ? match.view.view : null }
          : { view: match.view?.for === 'call' ? match.view.view : null, registration },
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const call = context.state.calls.get(callId)
    const additions = call?.registration !== undefined
      ? registeredEntries(match.event.seq, call.registration)
      : producedPaths(call?.view ?? null).map(path => ({ seq: match.event.seq, path }))
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'documentDeliverables',
      value: { produced: context.state.produced },
    },
}
/* jscpd:ignore-end */

const EMPTY: DocumentDeliverablesSnapshot = { produced: [] }

/** Upgrade one stored entry with a later entry's registration metadata, keeping its first seq. */
function augmented(previous: DocumentDeliverable, next: DocumentDeliverable): DocumentDeliverable {
  return {
    ...previous,
    ...next.format !== undefined ? { format: next.format } : {},
    ...next.gate !== undefined ? { gate: next.gate } : {},
    ...next.briefRef !== undefined ? { briefRef: next.briefRef } : {},
  }
}

function producedFromTimeline(timeline: ConversationTimelineSnapshot): DocumentDeliverablesSnapshot {
  const produced: DocumentDeliverable[] = []
  const seen = new Map<string, number>()
  for (const turn of timeline.turns.values()) {
    const data = turn.data.get('documentDeliverables')
    if (data === undefined) continue
    for (const entry of data.produced) {
      const index = seen.get(entry.path)
      if (index === undefined) {
        seen.set(entry.path, produced.length)
        produced.push(entry)
      } else {
        const previous = produced[index]
        // The map entry and the array index move together; the guard only
        // narrows the index access for the compiler.
        if (previous !== undefined) produced[index] = augmented(previous, entry)
      }
    }
  }
  return { produced }
}

class DocumentDeliverablesBuilder implements ConversationViewBuilder<ConversationViewNode, DocumentDeliverablesSnapshot> {
  readonly empty = EMPTY

  replace(input: {
    readonly nodes: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): DocumentDeliverablesSnapshot {
    return producedFromTimeline(input.timeline)
  }

  apply(input: {
    readonly upserts: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): DocumentDeliverablesSnapshot {
    return producedFromTimeline(input.timeline)
  }
}

/** Isolated per-session builder registered under {@link DOCUMENT_DELIVERABLES_TARGET}. */
export const documentDeliverablesViewDefinition: ConversationViewDefinition<ConversationViewNode, DocumentDeliverablesSnapshot> = {
  target: DOCUMENT_DELIVERABLES_TARGET,
  create: () => new DocumentDeliverablesBuilder(),
}
