/**
 * The pure cross-session board fold: workspace scoping (current session's
 * workspace, then strays), the `todosLatest` column read, and column
 * placement. No DOM — the view renders whatever this returns.
 */
import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { SessionId, type SessionId as SessionIdOf } from '@deepseek-ai/dsh-session/types'
import { boardCardCount, boardTags, filterBoard, projectBoard } from '../src/client/board-model.ts'

const sid = (id: string): SessionIdOf => SessionId(id)
const wid = (id: string): WorkspaceSnapshot['items'][number]['workspaceId'] =>
  SessionId(id) as never

const EMPTY_LIST: SessionListState = {
  ids: [],
  byId: {},
  current: undefined,
  phase: 'pending',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
}

const NO_WORKSPACES: readonly WorkspaceSnapshot['items'][number][] = []

function summary(
  id: string,
  todos: TodoItem[] | null | undefined,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id: sid(id),
    displayTitle: `session ${id}`,
    running: false,
    blank: false,
    updatedAt: 1,
    ...(todos === undefined ? {} : { projectionValues: { todosLatest: todos } }),
    ...extra,
  }
}

function list(
  entries: readonly SessionSummary[],
  current?: string,
): SessionListState {
  return {
    ...EMPTY_LIST,
    ids: entries.map(entry => entry.id),
    byId: Object.fromEntries(entries.map(entry => [entry.id, entry])),
    current: current === undefined ? undefined : sid(current),
  }
}

const TODO_A: TodoItem[] = [{ content: 'a', status: 'pending' }]
const TODO_B: TodoItem[] = [
  { content: 'b1', status: 'in_progress' },
  { content: 'b2', status: 'completed' },
]

function workspaces(
  rows: readonly { id: string; sessionIds: readonly string[] }[],
): WorkspaceSnapshot['items'] {
  return rows.map(row => ({
    workspaceId: wid(row.id),
    path: `/tmp/${row.id}`,
    title: row.id,
    sessionIds: row.sessionIds.map(sid),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
}

describe('projectBoard', () => {
  it('returns three empty columns for an empty workspace', () => {
    const columns = projectBoard(EMPTY_LIST, NO_WORKSPACES)
    expect(columns).toEqual({ pending: [], in_progress: [], completed: [] })
    expect(boardCardCount(columns)).toBe(0)
  })

  it('places each todo in its status column with the session badge title', () => {
    const state = list([
      summary('s1', TODO_A),
      summary('s2', TODO_B),
    ], 's1')
    const columns = projectBoard(state, workspaces([
      { id: 'w', sessionIds: ['s1', 's2'] },
    ]))
    expect(columns.pending.map(card => card.content)).toEqual(['a'])
    expect(columns.in_progress.map(card => card.content)).toEqual(['b1'])
    expect(columns.completed.map(card => card.content)).toEqual(['b2'])
    expect(columns.completed[0]?.sessionId).toBe(sid('s2'))
    expect(columns.completed[0]?.sessionTitle).toBe('session s2')
  })

  it('scopes to the workspace owning the current session only', () => {
    const state = list([
      summary('in', TODO_A),
      summary('out', TODO_B),
    ], 'in')
    const columns = projectBoard(state, workspaces([
      { id: 'w1', sessionIds: ['in'] },
      { id: 'w2', sessionIds: ['out'] },
    ]))
    expect(boardCardCount(columns)).toBe(1)
    expect(columns.pending.map(card => card.content)).toEqual(['a'])
  })

  it('falls back to sessions outside every workspace when the current one belongs to none', () => {
    const state = list([
      summary('stray1', TODO_A),
      summary('stray2', TODO_B),
      summary('grouped', TODO_A),
    ], 'stray1')
    const columns = projectBoard(state, workspaces([
      { id: 'w', sessionIds: ['grouped'] },
    ]))
    expect(columns.pending.map(card => card.sessionId)).toEqual([sid('stray1')])
    expect(columns.in_progress.map(card => card.sessionId)).toEqual([sid('stray2')])
  })

  it('falls back to strays when no session is selected', () => {
    const state = list([
      summary('stray', TODO_A),
      summary('grouped', TODO_B),
    ])
    const columns = projectBoard(state, workspaces([
      { id: 'w', sessionIds: ['grouped'] },
    ]))
    expect(columns.pending.map(card => card.content)).toEqual(['a'])
    expect(columns.in_progress).toEqual([])
  })

  it('skips sessions whose todosLatest column is absent or null', () => {
    const state = list([
      summary('absent', undefined),
      summary('null', null),
      summary('has', TODO_A),
    ], 'has')
    const columns = projectBoard(state, workspaces([
      { id: 'w', sessionIds: ['absent', 'null', 'has'] },
    ]))
    expect(columns.pending.map(card => card.content)).toEqual(['a'])
  })

  it('carries each todo tags onto its card, empty when untagged', () => {
    const tagged: TodoItem[] = [
      { content: 'a', status: 'pending', tags: ['docs'] },
      { content: 'b', status: 'in_progress' },
    ]
    const state = list([summary('s1', tagged)], 's1')
    const columns = projectBoard(state, NO_WORKSPACES)
    expect(columns.pending[0]?.tags).toEqual(['docs'])
    expect(columns.in_progress[0]?.tags).toEqual([])
  })
})

describe('boardTags', () => {
  it('collects the sorted unique tags across all columns', () => {
    const columns = projectBoard(list([
      summary('s1', [
        { content: 'a', status: 'pending', tags: ['release', 'docs'] },
        { content: 'b', status: 'completed', tags: ['docs'] },
        { content: 'c', status: 'in_progress' },
      ]),
    ]), NO_WORKSPACES)
    expect(boardTags(columns)).toEqual(['docs', 'release'])
  })

  it('is empty when no card carries a tag', () => {
    const columns = projectBoard(list([summary('s1', TODO_A)]), NO_WORKSPACES)
    expect(boardTags(columns)).toEqual([])
  })
})

describe('filterBoard', () => {
  it('returns the input columns unfiltered for a null tag', () => {
    const columns = projectBoard(list([summary('s1', TODO_A)]), NO_WORKSPACES)
    expect(filterBoard(columns, null)).toBe(columns)
  })

  it('keeps only the cards carrying the active tag, per column', () => {
    const columns = projectBoard(list([
      summary('s1', [
        { content: 'a', status: 'pending', tags: ['docs'] },
        { content: 'b', status: 'pending' },
        { content: 'c', status: 'completed', tags: ['docs', 'release'] },
      ]),
    ]), NO_WORKSPACES)
    const filtered = filterBoard(columns, 'docs')
    expect(filtered.pending.map(card => card.content)).toEqual(['a'])
    expect(filtered.completed.map(card => card.content)).toEqual(['c'])
    expect(boardCardCount(filtered)).toBe(2)
  })
})
