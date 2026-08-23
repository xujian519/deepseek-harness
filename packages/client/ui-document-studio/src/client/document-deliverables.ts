/**
 * Document-studio produced-file definition and view target. The vocabulary is
 * the mutation tools' own follow-along `locations` (the same derivation
 * `ui-deliverables` publishes per turn): a diff card, or a generic card whose
 * `kind` is `edit`, contributes its `locations` paths. This package owns its
 * own turn-scoped key so the studio works whether or not `ui-deliverables`
 * is composed in; the view target folds every turn in the window into one
 * first-seen ordered list.
 */
import type {
  ConversationNodeDefinition, ConversationTimelineSnapshot, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'

/** One produced file with its first-producing turn event seq. */
export interface DocumentDeliverable {
  readonly seq: number
  readonly path: string
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
    /** Successful mutation paths accumulated in one Turn. */
    documentDeliverables: DocumentTurnDeliverables
  }

  interface ConversationViewSnapshotMap {
    /** Session-wide produced files folded from every Turn. */
    documentDeliverables: DocumentDeliverablesSnapshot
  }
}

/** Stable target key the studio view reads from the session snapshot. */
export const DOCUMENT_DELIVERABLES_TARGET = 'documentDeliverables'

interface DocumentDeliverablesState extends DocumentTurnDeliverables {
  readonly turn: number
  readonly calls: ReadonlyMap<string, ToolResultNode['callView']>
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

/** Turn-local successful mutation accumulator; it publishes no view Node. */
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
      calls.set(
        String(match.event.data.callId),
        match.view?.for === 'call' ? match.view.view : null,
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions = producedPaths(context.state.calls.get(callId) ?? null)
      .map(path => ({ seq: match.event.seq, path }))
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

function producedFromTimeline(timeline: ConversationTimelineSnapshot): DocumentDeliverablesSnapshot {
  const produced: DocumentDeliverable[] = []
  const seen = new Set<string>()
  for (const turn of timeline.turns.values()) {
    const data = turn.data.get('documentDeliverables')
    if (data === undefined) continue
    for (const entry of data.produced) {
      if (seen.has(entry.path)) continue
      seen.add(entry.path)
      produced.push({ seq: entry.seq, path: entry.path })
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
