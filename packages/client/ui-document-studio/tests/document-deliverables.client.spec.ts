/**
 * document-deliverables derivation and session-fold view target: the
 * turn-scoped produced-file definition, its publication, and the session-wide
 * builder that folds every turn in the window.
 */
import { describe, expect, it } from 'vitest'
import {
  ConversationNodeAssembler, type ConversationEventInput, type ConversationMatch,
  type ConversationNodeDefinition, type ConversationTimelineSnapshot, type ConversationViewDefinition,
  type ConversationViewNode, type ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  documentDeliverablesDefinition, documentDeliverablesViewDefinition,
  type DocumentDeliverablesSnapshot, type DocumentTurnDeliverables,
} from '../src/client/document-deliverables.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [documentDeliverablesDefinition] }
  fallbackEntry(): ConversationNodeDefinition | undefined { return undefined }
}

interface TimelineSnapshot { readonly timeline: ConversationTimelineSnapshot }

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [timelineViewDefinition] }
  fallbackEntry(): ConversationViewDefinition | undefined { return undefined }
}

const timelineViewDefinition: ConversationViewDefinition<ConversationViewNode, TimelineSnapshot> = {
  target: 'test',
  create: () => {
    let current: TimelineSnapshot = { timeline: { turnOrder: [], turns: new Map() } }
    return {
      empty: current,
      replace: ({ timeline }) => (current = { timeline }),
      apply: ({ timeline }) => (current = { timeline }),
    }
  },
}

function at(seq: number, type: string, data: unknown, view?: ConversationEventInput['view']): ConversationEventInput {
  return {
    event: {
      seq, time: seq * 1_000, type, data,
      ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
    } as ConversationEventInput['event'],
    view,
  }
}

function matched(input: ConversationEventInput, role: ConversationMatch['role']): ConversationMatch {
  return { ...input, role, location: { kind: 'unresolved' } }
}

function call(seq: number, callId: string, view: NonNullable<ToolResultNode['callView']>, turn = 1): ConversationEventInput {
  return at(seq, 'tool/call', { turn, step: 1, callId, name: 'fixture', arguments: '{}' }, { for: 'call', view })
}

function result(seq: number, callId: string, isError = false, turn = 1): ConversationEventInput {
  return at(seq, 'tool/result', {
    turn, step: 1,
    message: { source: { type: 'tool-result', callId }, content: [{ type: 'tool-result', content: [], isError }] },
  })
}

function diff(...paths: string[]): NonNullable<ToolResultNode['callView']> {
  return {
    card: 'diff', title: `Write ${paths[0] ?? ''}`,
    diffs: paths.map(path => ({ path, oldText: null, newText: 'x' })),
    locations: paths.map(path => ({ path })),
  }
}

function edit(path: string): NonNullable<ToolResultNode['callView']> {
  return { card: 'generic', title: `insert ${path}`, kind: 'edit', locations: [{ path }] }
}

function assembler(entries: readonly ConversationEventInput[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, false)
  value.flush()
  return value
}

function turnDataOf(value: ConversationNodeAssembler, turn = 1): Readonly<DocumentTurnDeliverables> | undefined {
  const snapshot = value.snapshot('test') as TimelineSnapshot
  return snapshot.timeline.turns.get(turn)?.data.get('documentDeliverables')
}

function timelineOf(value: ConversationNodeAssembler): ConversationTimelineSnapshot {
  return (value.snapshot('test') as TimelineSnapshot).timeline
}

describe('documentDeliverables turn data', () => {
  it('folds successful diff and generic-edit calls; reads, failures, and orphan results contribute nothing', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('out/index.html', 'out/app.css')),
      result(3, 'write'),
      call(4, 'edit', edit('notes.md')),
      result(5, 'edit'),
      call(6, 'read', { card: 'generic', title: 'Read', locations: [{ path: 'input.txt' }] }),
      result(7, 'read'),
      call(8, 'failed', diff('broken.txt')),
      result(9, 'failed', true),
      call(10, 'orphan', diff('orphan.txt')),
    ])

    expect(turnDataOf(value)?.produced).toEqual([
      { seq: 3, path: 'out/index.html' },
      { seq: 3, path: 'out/app.css' },
      { seq: 5, path: 'notes.md' },
    ])
  })

  it('ignores orphan results and non-append replacement results', () => {
    const replacement = at(11, 'tool/result', {
      turn: 1, step: 1,
      message: { source: { type: 'tool-result', callId: 'repl' }, content: [{ type: 'tool-result', content: [], isError: false }] },
    })
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('out/index.html')),
      result(3, 'write'),
      // A result whose call never entered this window: no call view, nothing produced.
      result(9, 'ghost'),
      // A result without the append surface is not accepted by the definition.
      replacement,
    ])

    expect(turnDataOf(value)?.produced).toEqual([{ seq: 3, path: 'out/index.html' }])
  })

  it('keeps turn data append-only; the session fold deduplicates paths', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write1', diff('out/index.html')),
      result(3, 'write1'),
      call(4, 'write2', diff('out/index.html')),
      result(5, 'write2'),
    ])

    // The turn accumulator appends every successful mutation (same vocabulary
    // as ui-deliverables); the fold in the session view target dedupes.
    expect(turnDataOf(value)?.produced).toEqual([
      { seq: 3, path: 'out/index.html' },
      { seq: 5, path: 'out/index.html' },
    ])
    const timeline = timelineOf(value)
    const fold = documentDeliverablesViewDefinition.create().replace({ nodes: [], timeline })
    expect(fold.produced).toEqual([{ seq: 3, path: 'out/index.html' }])
  })

  it('publishes only at turn scope', () => {
    const match = matched(at(1, 'turn/start', { turn: 1 }), 'start')
    const start = documentDeliverablesDefinition.start?.({} as never, match, {} as never)
    const state = start === undefined ? undefined : { ...start, produced: [{ seq: 3, path: 'a.html' }] }
    const turn = documentDeliverablesDefinition.buildLocationData?.({ state } as never, 'turn')
    const step = documentDeliverablesDefinition.buildLocationData?.({ state } as never, 'step')
    expect(turn).toEqual({ kind: 'turn', turn: 1, key: 'documentDeliverables', value: { produced: [{ seq: 3, path: 'a.html' }] } })
    expect(step).toBeNull()
  })

  it('rejects a start without a turn/start event', () => {
    const wrong = matched(at(1, 'user', { message: { role: 'user', content: [] } }), 'start')
    expect(() => documentDeliverablesDefinition.start?.({} as never, wrong, {} as never)).toThrow(/start requires turn\/start/)
  })
})

describe('documentDeliverables session view target', () => {
  function fold(timeline: ConversationTimelineSnapshot): DocumentDeliverablesSnapshot {
    const builder = documentDeliverablesViewDefinition.create()
    return builder.replace({ nodes: [], timeline })
  }

  it('folds every turn in the window, first-seen order, deduplicating across turns', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('out/index.html')),
      result(3, 'write'),
      at(4, 'turn/start', { turn: 2 }),
      call(5, 'edit', edit('out/index.html')),
      result(6, 'edit'),
      call(7, 'write', diff('deck.html')),
      result(8, 'write'),
    ])

    expect(fold(timelineOf(value))).toEqual({
      produced: [
        { seq: 3, path: 'out/index.html' },
        { seq: 8, path: 'deck.html' },
      ],
    })
  })

  it('returns the stable empty snapshot for an empty window and skips turns without data', () => {
    const value = assembler([at(1, 'turn/start', { turn: 1 }), at(1, 'user', { message: { role: 'user', content: [] } })])
    expect(fold(timelineOf(value))).toEqual({ produced: [] })
    expect(documentDeliverablesViewDefinition.create().empty).toEqual({ produced: [] })
  })

  it('apply recomputes the same fold as replace', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('a.html')),
      result(3, 'write'),
    ])
    const builder = documentDeliverablesViewDefinition.create()
    const timeline = timelineOf(value)
    expect(builder.apply({ upserts: [], timeline })).toEqual(builder.replace({ nodes: [], timeline }))
  })
})

describe('document_deliver registrations', () => {
  function deliver(
    seq: number, callId: string, argumentsJson: string,
    view: ConversationEventInput['view'], turn = 1,
  ): ConversationEventInput {
    return at(seq, 'tool/call', { turn, step: 1, callId, name: 'document_deliver', arguments: argumentsJson }, view)
  }

  const callView: ConversationEventInput['view'] = {
    for: 'call',
    view: { card: 'generic', title: '登记文档交付物' },
  }

  it('folds a successful registration with format, gate, and brief reference', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      deliver(2, 'reg', JSON.stringify({
        files: [{ path: 'out/report.docx', format: 'docx' }, { path: 'out/report.html', format: 'html' }],
        gate: { p0: ['命名规范', '自包含'], p1: ['可访问性'] },
        brief_ref: 'brief.md',
      }), callView),
      result(3, 'reg'),
    ])

    expect(turnDataOf(value)?.produced).toEqual([
      {
        seq: 3, path: 'out/report.docx', format: 'docx',
        gate: { p0: ['命名规范', '自包含'], p1: ['可访问性'] }, briefRef: 'brief.md',
      },
      {
        seq: 3, path: 'out/report.html', format: 'html',
        gate: { p0: ['命名规范', '自包含'], p1: ['可访问性'] }, briefRef: 'brief.md',
      },
    ])
  })

  it('folds without p1/briefRef when the registration omits them', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      deliver(2, 'reg', JSON.stringify({
        files: [{ path: 'deck.html', format: 'html' }],
        gate: { p0: ['命名规范'] },
      }), callView),
      result(3, 'reg'),
    ])
    expect(turnDataOf(value)?.produced).toEqual([
      { seq: 3, path: 'deck.html', format: 'html', gate: { p0: ['命名规范'], p1: [] } },
    ])
  })

  it('does not fold failed registrations or malformed registration arguments', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      deliver(2, 'failed-reg', JSON.stringify({
        files: [{ path: 'a.docx', format: 'docx' }], gate: { p0: ['x'] },
      }), callView),
      result(3, 'failed-reg', true),
      deliver(4, 'not-json', 'not-json', callView),
      result(5, 'not-json'),
      deliver(6, 'bad-files', JSON.stringify({ files: 'nope', gate: { p0: ['x'] } }), callView),
      result(7, 'bad-files'),
      deliver(8, 'bad-file-shape', JSON.stringify({
        files: [{ path: 1, format: 'html' }], gate: { p0: ['x'] },
      }), callView),
      result(9, 'bad-file-shape'),
      deliver(10, 'bad-gate', JSON.stringify({
        files: [{ path: 'a.html', format: 'html' }],
        gate: { p0: ['x'], p1: [2] },
      }), callView),
      result(11, 'bad-gate'),
    ])

    expect(turnDataOf(value)?.produced).toEqual([])
  })

  it('upgrades a mutation-derived entry in the session fold when a later registration covers the same path', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'write', diff('out/report.html')),
      result(3, 'write'),
      at(4, 'turn/start', { turn: 2 }),
      deliver(5, 'reg', JSON.stringify({
        files: [{ path: 'out/report.html', format: 'html' }],
        gate: { p0: ['命名规范'] },
      }), callView, 2),
      result(6, 'reg', false, 2),
    ])

    const fold = documentDeliverablesViewDefinition.create().replace({ nodes: [], timeline: timelineOf(value) })
    expect(fold.produced).toEqual([
      { seq: 3, path: 'out/report.html', format: 'html', gate: { p0: ['命名规范'], p1: [] } },
    ])
  })
})
